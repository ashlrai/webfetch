/**
 * Cloudflare Workers observability adapter.
 *
 * Wires Sentry via `@sentry/cloudflare` (peer-dep, lazy-imported so the
 * worker bundle doesn't require it when SENTRY_DSN is absent).
 *
 * Hard rules:
 *   - No-op unless `env.SENTRY_DSN` is set.
 *   - Scrubs `Authorization`, `Cookie`, `Set-Cookie`, `x-api-key` headers.
 *   - Scrubs known-sensitive keys from JSON breadcrumbs/extras.
 *   - Request bodies NOT captured unless `env.SENTRY_CAPTURE_BODIES === "1"`.
 *   - No IP or UA captured.
 */

export interface ObservabilityEnv {
  SENTRY_DSN?: string;
  SENTRY_ENVIRONMENT?: string;
  SENTRY_RELEASE?: string;
  SENTRY_CAPTURE_BODIES?: string;
  SENTRY_SAMPLE_RATE?: string;
}

// Minimal shape from @sentry/cloudflare we depend on. Imported lazily.
interface SentryLike {
  init(options: Record<string, unknown>): void;
  captureException(err: unknown, context?: Record<string, unknown>): string;
  captureMessage(msg: string, level?: string): string;
  setTag(key: string, value: string): void;
  addBreadcrumb(crumb: Record<string, unknown>): void;
  withScope(fn: (scope: Record<string, unknown>) => void): void;
}

let sentry: SentryLike | null = null;
let initPromise: Promise<SentryLike | null> | null = null;

const SENSITIVE_HEADER_RE =
  /^(authorization|cookie|set-cookie|x-api-key|x-auth-token|proxy-authorization)$/i;
const SENSITIVE_KEY_RE =
  /(api[_-]?key|secret|token|password|passwd|pwd|bearer|authorization|session|cookie|ssn)/i;

export function scrubHeaders(
  headers: Record<string, string | string[] | undefined> | Headers | undefined,
): Record<string, string> {
  const out: Record<string, string> = {};
  if (!headers) return out;
  const entries: [string, string][] = [];
  if (headers instanceof Headers) {
    headers.forEach((v, k) => entries.push([k, v]));
  } else {
    for (const [k, v] of Object.entries(headers)) {
      if (v == null) continue;
      entries.push([k, Array.isArray(v) ? v.join(",") : String(v)]);
    }
  }
  for (const [k, v] of entries) {
    out[k] = SENSITIVE_HEADER_RE.test(k) ? "[REDACTED]" : v;
  }
  return out;
}

export function scrubValue<T>(value: T, depth = 0): T {
  if (depth > 6) return "[TRUNCATED]" as unknown as T;
  if (value == null) return value;
  if (typeof value === "string") {
    // Strip bearer tokens inline.
    return value.replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [REDACTED]") as unknown as T;
  }
  if (Array.isArray(value)) {
    return value.map((v) => scrubValue(v, depth + 1)) as unknown as T;
  }
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = SENSITIVE_KEY_RE.test(k) ? "[REDACTED]" : scrubValue(v, depth + 1);
    }
    return out as unknown as T;
  }
  return value;
}

async function loadSentry(): Promise<SentryLike | null> {
  if (sentry) return sentry;
  if (initPromise) return initPromise;
  initPromise = (async () => {
    try {
      // Lazy import; in tests this path is never taken because init() is skipped
      // without SENTRY_DSN.
      const mod = (await import(
        /* @vite-ignore */ "@sentry/cloudflare" as string
      )) as unknown as SentryLike;
      sentry = mod;
      return mod;
    } catch {
      return null;
    }
  })();
  return initPromise;
}

export interface InitOptions {
  /** Inject a Sentry implementation (tests). */
  sentry?: SentryLike;
  /** Inject env (tests). */
  env?: ObservabilityEnv;
}

let initialized = false;

export async function initObservability(opts: InitOptions = {}): Promise<SentryLike | null> {
  const env = opts.env;
  if (!env?.SENTRY_DSN) return null;
  if (initialized && sentry) return sentry;

  const client = opts.sentry ?? (await loadSentry());
  if (!client) return null;

  client.init({
    dsn: env.SENTRY_DSN,
    environment: env.SENTRY_ENVIRONMENT ?? "production",
    release: env.SENTRY_RELEASE,
    tracesSampleRate: env.SENTRY_SAMPLE_RATE ? Number(env.SENTRY_SAMPLE_RATE) : 0.1,
    sendDefaultPii: false,
    beforeSend(event: Record<string, unknown>) {
      return sanitizeEvent(event, env);
    },
    beforeBreadcrumb(crumb: Record<string, unknown>) {
      return sanitizeBreadcrumb(crumb);
    },
  });

  sentry = client;
  initialized = true;
  return client;
}

function sanitizeEvent(
  event: Record<string, unknown>,
  env: ObservabilityEnv,
): Record<string, unknown> {
  const request = event.request as Record<string, unknown> | undefined;
  if (request) {
    request.headers = scrubHeaders(request.headers as Record<string, string>);
    request.cookies = undefined;
    if (env.SENTRY_CAPTURE_BODIES !== "1") {
      request.data = undefined;
    } else {
      request.data = scrubValue(request.data);
    }
  }
  (event as Record<string, unknown>).user = undefined;
  (event as Record<string, unknown>).server_name = undefined;
  if (event.extra) event.extra = scrubValue(event.extra);
  if (event.contexts) event.contexts = scrubValue(event.contexts);
  return event;
}

function sanitizeBreadcrumb(crumb: Record<string, unknown>): Record<string, unknown> {
  if (crumb.data) crumb.data = scrubValue(crumb.data);
  return crumb;
}

/** Capture an exception. No-op when Sentry not initialized. */
export function captureError(err: unknown, context?: Record<string, unknown>): void {
  if (!sentry) return;
  sentry.withScope((scope) => {
    if (context) {
      (scope as { setExtras?: (v: unknown) => void }).setExtras?.(scrubValue(context));
    }
    sentry!.captureException(err);
  });
}

/**
 * Hono middleware factory. Use:
 *   app.use("*", sentryMiddleware())
 * Catches thrown errors, reports, rethrows so upstream error handlers still run.
 */
export function sentryMiddleware() {
  return async (c: { req: { method: string; path: string } }, next: () => Promise<void>) => {
    try {
      await next();
    } catch (err) {
      captureError(err, { method: c.req.method, path: c.req.path });
      throw err;
    }
  };
}

/** Wraps a Stripe webhook handler to capture signature/processing failures. */
export function wrapStripeWebhook<T extends (...args: unknown[]) => Promise<unknown>>(fn: T): T {
  return (async (...args: unknown[]) => {
    try {
      return await fn(...args);
    } catch (err) {
      captureError(err, { source: "stripe_webhook" });
      throw err;
    }
  }) as T;
}

/** Wraps a queue consumer; swallows nothing, reports all. */
export function wrapQueueConsumer<T extends (...args: unknown[]) => Promise<unknown>>(
  fn: T,
  queue: string,
): T {
  return (async (...args: unknown[]) => {
    try {
      return await fn(...args);
    } catch (err) {
      captureError(err, { source: "queue", queue });
      throw err;
    }
  }) as T;
}

export const __internal = { sanitizeEvent, sanitizeBreadcrumb, loadSentry };

/** Reset module state. Exported for tests only. */
export function __resetForTests(): void {
  sentry = null;
  initPromise = null;
  initialized = false;
}
