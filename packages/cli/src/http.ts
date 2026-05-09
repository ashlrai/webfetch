import { DEFAULT_BASE_URL, type ResolvedConfig } from "./config.ts";

export interface CloudRequestOptions {
  method?: "GET" | "POST";
  body?: unknown;
}

export async function cloudRequest<T>(
  cfg: ResolvedConfig,
  path: string,
  opts: CloudRequestOptions = {},
): Promise<T> {
  const base = (cfg.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
  const apiKey = cfg.apiKey;
  if (!apiKey) throw new Error("cloud mode requires WEBFETCH_API_KEY or config set apiKey <key>");

  const method = opts.method ?? "POST";
  const resp = await fetch(`${base}/v1${path}`, {
    method,
    headers: {
      accept: "application/json",
      authorization: `Bearer ${apiKey}`,
      ...(method === "POST" ? { "content-type": "application/json" } : {}),
    },
    body: method === "POST" ? JSON.stringify(opts.body ?? {}) : undefined,
  });

  let payload: any;
  try {
    payload = await resp.json();
  } catch {
    payload = undefined;
  }

  if (!resp.ok || payload?.ok === false) {
    throw new Error(payload?.error ?? payload?.message ?? `cloud http ${resp.status}`);
  }

  return (payload && typeof payload === "object" && "data" in payload ? payload.data : payload) as T;
}
