export class RequestBodyError extends Error {
  readonly status = 413;
  constructor() { super('The request is too large.'); }
}
export async function readBoundedBody(req: Request, limit: number): Promise<string> {
  if (Number(req.headers.get('content-length')) > limit) throw new RequestBodyError();
  if (!req.body) return '';
  const reader = req.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0, text = '';
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > limit) { await reader.cancel(); throw new RequestBodyError(); }
      text += decoder.decode(value, { stream: true });
    }
    return text + decoder.decode();
  } finally { reader.releaseLock(); }
}
