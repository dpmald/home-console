import crypto from 'node:crypto';

export function safeEqual(a: string, b: string): boolean {
  const A = Buffer.from(a);
  const B = Buffer.from(b);
  return A.length === B.length && crypto.timingSafeEqual(A, B);
}

export function hasBearer(req: Request, secret: string | undefined): boolean {
  if (!secret) return false;
  return safeEqual(req.headers.get('authorization') ?? '', `Bearer ${secret}`);
}

export const unauthorized = () => Response.json({ error: 'unauthorized' }, { status: 401 });
