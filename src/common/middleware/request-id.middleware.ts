import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

export const REQUEST_ID_HEADER = 'X-Request-Id';

// Reuse an id sent by a client or proxy only if it is safe to write into logs.
const VALID_REQUEST_ID = /^[\w-]{1,128}$/;

const requestIds = new WeakMap<Request, string>();

// Functional middleware so it can be registered with app.use() in main.ts,
// where it runs before Nest's body parser (see main.ts).
export function requestIdMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const incoming = req.header(REQUEST_ID_HEADER);
  const requestId =
    incoming && VALID_REQUEST_ID.test(incoming) ? incoming : randomUUID();

  requestIds.set(req, requestId);
  res.setHeader(REQUEST_ID_HEADER, requestId);
  next();
}

export function getRequestId(req: Request): string | undefined {
  return requestIds.get(req);
}
