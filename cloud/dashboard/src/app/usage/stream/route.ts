/**
 * SSE: live per-request usage stream for the dashboard's LiveUsage widget.
 *
 * In production we subscribe to the Worker-published queue via a long-poll
 * upstream. Until the backend exists we emit a synthetic tick every 2-4s so
 * the UI's pulse + list visibly update during dev. Set
 * `NEXT_PUBLIC_USE_FIXTURES=0` + deploy the Worker to wire the real feed.
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const ENDPOINTS = ["/v1/search", "/v1/download", "/v1/probe", "/v1/artist", "/v1/license"];

export async function GET(req: Request) {
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      let closed = false;

      const send = (data: unknown, event: string) => {
        if (closed) return;
        try {
          controller.enqueue(
            encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
          );
        } catch {
          // controller closed between checks
        }
      };

      const tick = () => {
        if (closed) return;
        const endpoint = ENDPOINTS[Math.floor(Math.random() * ENDPOINTS.length)];
        const roll = Math.random();
        const status = roll > 0.96 ? 429 : roll > 0.92 ? 402 : roll > 0.88 ? 500 : 200;
        send({ ts: Date.now(), endpoint, status }, "tick");
      };

      const interval = setInterval(tick, 2500 + Math.random() * 1500);
      const heartbeat = setInterval(() => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`: ping\n\n`));
        } catch {
          // ignore
        }
      }, 15_000);

      // send an initial hello event so the client flips "connected" immediately
      send({ ready: true }, "ready");

      const abort = () => {
        if (closed) return;
        closed = true;
        clearInterval(interval);
        clearInterval(heartbeat);
        try {
          controller.close();
        } catch {
          // ignore
        }
      };

      req.signal.addEventListener("abort", abort);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
