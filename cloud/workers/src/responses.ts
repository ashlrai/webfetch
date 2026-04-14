/**
 * Shared JSON response helpers — keep the envelope consistent across all
 * endpoints so clients only parse one shape.
 */

import type { Context } from "hono";
import { z } from "zod";

export function ok<T>(c: Context, data: T, status = 200) {
  return c.json({ ok: true, data }, status as 200);
}

export function err(c: Context, error: string, status = 400, extra?: Record<string, unknown>) {
  return c.json({ ok: false, error, ...(extra ?? {}) }, status as 400);
}

/** Parse + validate a JSON body. Returns `{ data }` or sends a 422. */
export async function parseJson<S extends z.ZodTypeAny>(
  c: Context,
  schema: S,
): Promise<{ ok: true; data: z.infer<S> } | { ok: false; response: Response }> {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    body = {};
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    const msg = parsed.error.issues
      .map((i) => `${i.path.join(".") || "<root>"}: ${i.message}`)
      .join("; ");
    return { ok: false, response: err(c, msg, 422) };
  }
  return { ok: true, data: parsed.data };
}
