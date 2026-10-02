import {
  CallHandler,
  ExecutionContext,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { firstValueFrom, of, throwError } from 'rxjs';
import { requestIdMiddleware } from '../middleware/request-id.middleware';
import { LoggingInterceptor } from './logging.interceptor';

const createContext = (statusCode = 200, type = 'http', requestId?: string) => {
  const request = {
    method: 'GET',
    originalUrl: '/users',
    header: () => requestId,
  } as unknown as Request;
  if (requestId) {
    const res = { setHeader: jest.fn() } as unknown as Response;
    requestIdMiddleware(request, res, jest.fn());
  }

  return {
    getType: () => type,
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => ({ statusCode }),
    }),
  } as unknown as ExecutionContext;
};

const handlerOf = (data: unknown): CallHandler => ({ handle: () => of(data) });

describe('LoggingInterceptor', () => {
  let interceptor: LoggingInterceptor;
  let logSpy: jest.SpyInstance;

  beforeEach(() => {
    interceptor = new LoggingInterceptor();
    logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('logs method, url, status and duration on success', async () => {
    const result = await firstValueFrom(
      interceptor.intercept(createContext(200), handlerOf('ok')),
    );

    expect(result).toBe('ok');
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringMatching(/^\[-\] GET \/users 200 - \d+ms$/),
    );
  });

  it('includes the request id in the log', async () => {
    await firstValueFrom(
      interceptor.intercept(
        createContext(200, 'http', 'req-123'),
        handlerOf('ok'),
      ),
    );

    expect(logSpy).toHaveBeenCalledWith(
      expect.stringMatching(/^\[req-123\] GET \/users 200 - \d+ms$/),
    );
  });

  it('rethrows errors without logging them (the exception filter does)', async () => {
    const error = new NotFoundException();
    const failing: CallHandler = { handle: () => throwError(() => error) };

    await expect(
      firstValueFrom(interceptor.intercept(createContext(), failing)),
    ).rejects.toBe(error);

    expect(logSpy).not.toHaveBeenCalled();
  });

  it.each(['/health/live', '/health/ready', '/api/health/live?x=1'])(
    'does not log health probes (%s)',
    async (url) => {
      const context = createContext(200);
      context.switchToHttp().getRequest<Request>().originalUrl = url;

      await firstValueFrom(interceptor.intercept(context, handlerOf('ok')));

      expect(logSpy).not.toHaveBeenCalled();
    },
  );

  it('does not log non-http contexts', async () => {
    await firstValueFrom(
      interceptor.intercept(createContext(200, 'rpc'), handlerOf('ok')),
    );

    expect(logSpy).not.toHaveBeenCalled();
  });
});
