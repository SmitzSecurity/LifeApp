export type BoundedText = { ok: true; text: string } | { ok: false; status: 400 | 413 };

/** Enforce byte limits while reading, including chunked requests without a length. */
export async function readBoundedText(request: Request, limit: number): Promise<BoundedText> {
  if (Number(request.headers.get('content-length') || 0) > limit) {
    void request.body?.cancel().catch(() => {});
    return { ok: false, status: 413 };
  }
  if (!request.body) return { ok: true, text: '' };
  const reader = request.body.getReader(), chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > limit) {
        // Do not await a sender-controlled stream's cancellation acknowledgement.
        void reader.cancel().catch(() => {});
        return { ok: false, status: 413 };
      }
      chunks.push(part.value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return { ok: true, text: new TextDecoder().decode(bytes) };
  } catch {
    return { ok: false, status: 400 };
  } finally {
    reader.releaseLock();
  }
}
