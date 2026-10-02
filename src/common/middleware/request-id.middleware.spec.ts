import type { Request, Response } from 'express';
import {
  REQUEST_ID_HEADER,
  getRequestId,
  requestIdMiddleware,
} from './request-id.middleware';

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const run = (incoming?: string) => {
  const req = {
    header: jest.fn().mockReturnValue(incoming),
  } as unknown as Request;
  const res = { setHeader: jest.fn() };
  const next = jest.fn();

  requestIdMiddleware(req, res as unknown as Response, next);

  return { res, next, requestId: getRequestId(req) };
};

describe('requestIdMiddleware', () => {
  it('generates a uuid, sets the response header and calls next', () => {
    const { requestId, res, next } = run();

    expect(requestId).toMatch(UUID);
    expect(res.setHeader).toHaveBeenCalledWith(REQUEST_ID_HEADER, requestId);
    expect(next).toHaveBeenCalled();
  });

  it('reuses a valid incoming id', () => {
    const { requestId, res } = run('abc-123_XYZ');

    expect(requestId).toBe('abc-123_XYZ');
    expect(res.setHeader).toHaveBeenCalledWith(
      REQUEST_ID_HEADER,
      'abc-123_XYZ',
    );
  });

  it.each([
    ['contains unsafe characters', 'abc\n[HTTP] fake log line'],
    ['is too long', 'a'.repeat(129)],
    ['is empty', ''],
  ])('generates a new id when the incoming one %s', (_, incoming) => {
    expect(run(incoming).requestId).toMatch(UUID);
  });

  it('returns undefined for requests that skipped the middleware', () => {
    expect(getRequestId({} as Request)).toBeUndefined();
  });
});
