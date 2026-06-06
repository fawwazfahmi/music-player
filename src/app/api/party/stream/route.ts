import { getActiveParty, subscribeToParty } from "@/server/services/party-service";

// Server-Sent Events stream for live party updates. The receiver opens this
// once and gets a push every time the broadcaster's state changes — so
// instead of polling every 750ms, fawwaz sees ainul's play/pause/skip/seek
// within the SSE flush window (single-digit ms on a healthy network).
//
// Auth: gated by the global proxy middleware just like every other /api
// route, so this only opens for logged-in sessions.

// Force Node runtime — Edge can't hold a long-lived stream without batching
// and we need module-level state for the in-memory subscriber registry.
export const runtime = "nodejs";
// Don't let Next or Cloudflare cache the stream.
export const dynamic = "force-dynamic";

const encoder = new TextEncoder();

function sse(payload: unknown): string {
  return `data: ${JSON.stringify(payload)}\n\n`;
}

export async function GET(req: Request) {
  let unsub: (() => void) | null = null;
  let heartbeat: ReturnType<typeof setInterval> | null = null;
  let closed = false;

  const stream = new ReadableStream({
    async start(controller) {
      function write(chunk: string) {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          closed = true;
        }
      }

      // 1. Send the current state immediately so the receiver doesn't wait
      //    a tick for the first push.
      try {
        const initial = await getActiveParty();
        write(sse(initial));
      } catch (err) {
        console.error("[mu] party stream initial state failed", err);
      }

      // 2. Subscribe to future updates.
      unsub = subscribeToParty((view) => write(sse(view)));

      // 3. Keepalive comment every 25s so neither the Cloudflare tunnel
      //    (90s keepAliveTimeout in our config) nor proxies along the way
      //    treat the stream as idle and close it.
      heartbeat = setInterval(() => write(": keepalive\n\n"), 25_000);

      // 4. Close cleanly when the client navigates away or refreshes.
      req.signal.addEventListener("abort", () => {
        closed = true;
        unsub?.();
        if (heartbeat) clearInterval(heartbeat);
        try {
          controller.close();
        } catch {}
      });
    },
    cancel() {
      closed = true;
      unsub?.();
      if (heartbeat) clearInterval(heartbeat);
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-cache, no-transform",
      // Disables nginx/cloudflared buffering of the stream body.
      "x-accel-buffering": "no",
      connection: "keep-alive",
    },
  });
}
