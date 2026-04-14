/**
 * Build a stub `fetch` that routes by URL matcher.
 * Tests pass this into SearchOptions.fetcher — no real network calls ever.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

type Handler = (url: string, init?: RequestInit) => Promise<Response>;
type Route = { match: (url: string) => boolean; handler: Handler };

const FIX = join(import.meta.dir, "fixtures");

export function fixture(name: string): any {
  return JSON.parse(readFileSync(join(FIX, name), "utf8"));
}

export function fixtureText(name: string): string {
  return readFileSync(join(FIX, name), "utf8");
}

export function jsonResponse(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
    ...init,
  });
}

export function textResponse(body: string, contentType = "text/html"): Response {
  return new Response(body, {
    status: 200,
    headers: { "content-type": contentType },
  });
}

export function bytesResponse(body: Uint8Array, mime = "image/jpeg"): Response {
  return new Response(body as unknown as BodyInit, {
    status: 200,
    headers: { "content-type": mime, "content-length": String(body.byteLength) },
  });
}

export function stubFetcher(routes: Route[]): typeof fetch {
  return (async (input: any, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.url;
    for (const r of routes) if (r.match(url)) return r.handler(url, init);
    throw new Error(`stubFetcher: no route for ${url}`);
  }) as unknown as typeof fetch;
}
