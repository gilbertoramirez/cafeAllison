/**
 * Actualizaciones en tiempo real con Server-Sent Events (funciona en Vercel, que no admite WebSockets).
 * El servidor revisa cada pocos segundos una "versión" barata en la base de datos y avisa a las
 * pantallas abiertas cuando cambia. El navegador (EventSource) se reconecta solo cuando la función termina.
 */

const encoder = new TextEncoder();

export function liveResponse(
  req: Request,
  getVersion: () => Promise<Record<string, unknown> & { v: string | number }>,
  { intervalMs = 2000, maxMs = 50_000 } = {},
) {
  let closed = false;
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (chunk: string) => {
        if (!closed) controller.enqueue(encoder.encode(chunk));
      };
      const close = () => {
        if (closed) return;
        closed = true;
        try {
          controller.close();
        } catch {}
      };
      req.signal.addEventListener("abort", close);

      // Reconexión del navegador a los 2 s cuando cerramos la conexión
      send("retry: 2000\n\n");
      const started = Date.now();
      let last: string | number | null = null;
      let lastBeat = Date.now();
      while (!closed && Date.now() - started < maxMs) {
        try {
          const data = await getVersion();
          if (data.v !== last) {
            last = data.v;
            send(`data: ${JSON.stringify(data)}\n\n`);
          } else if (Date.now() - lastBeat > 15_000) {
            send(": ping\n\n"); // mantiene viva la conexión
            lastBeat = Date.now();
          }
        } catch (e) {
          console.error("live", e);
        }
        await new Promise((r) => setTimeout(r, intervalMs));
      }
      close();
    },
    cancel() {
      closed = true;
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
