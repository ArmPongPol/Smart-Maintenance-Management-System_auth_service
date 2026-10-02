import {
  ArgumentsHost,
  BadRequestException,
  HttpException,
  HttpStatus,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { QueryFailedError } from 'typeorm';
import { requestIdMiddleware } from '../middleware/request-id.middleware';
import { AllExceptionsFilter } from './all-exceptions.filter';

const createHost = ({ requestId }: { requestId?: string } = {}) => {
  const request = {
    method: 'GET',
    originalUrl: '/users/1',
    header: () => requestId,
  } as unknown as Request;
  if (requestId) {
    const res = { setHeader: jest.fn() } as unknown as Response;
    requestIdMiddleware(request, res, jest.fn());
  }

  const response = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
  };
  const host = {
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => response,
    }),
  } as unknown as ArgumentsHost;

  return { host, response };
};

describe('AllExceptionsFilter', () => {
  let filter: AllExceptionsFilter;
  let warnSpy: jest.SpyInstance;
  let errorSpy: jest.SpyInstance;

  beforeEach(() => {
    filter = new AllExceptionsFilter();
    warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('returns the HttpException status and message', () => {
    const { host, response } = createHost();

    filter.catch(new NotFoundException('User not found'), host);

    expect(response.status).toHaveBeenCalledWith(404);
    expect(response.json).toHaveBeenCalledWith({
      status: 404,
      message: 'User not found',
      data: null,
    });
  });

  it('uses a string exception response as the message', () => {
    const { host, response } = createHost();

    filter.catch(new HttpException('Teapot', HttpStatus.I_AM_A_TEAPOT), host);

    expect(response.json).toHaveBeenCalledWith({
      status: 418,
      message: 'Teapot',
      data: null,
    });
  });

  it('joins validation message arrays into one string', () => {
    const { host, response } = createHost();

    filter.catch(
      new BadRequestException([
        'email must be an email',
        'password should not be empty',
      ]),
      host,
    );

    expect(response.json).toHaveBeenCalledWith({
      status: 400,
      message: 'email must be an email, password should not be empty',
      data: null,
    });
  });

  it('falls back to exception.message when the response object has none', () => {
    const { host, response } = createHost();
    const exception = new HttpException({ code: 'X' }, HttpStatus.CONFLICT);

    filter.catch(exception, host);

    expect(response.json).toHaveBeenCalledWith({
      status: 409,
      message: exception.message,
      data: null,
    });
  });

  it('hides unknown errors behind a generic 500', () => {
    const { host, response } = createHost();

    filter.catch(new Error('db password is wrong'), host);

    expect(response.status).toHaveBeenCalledWith(500);
    expect(response.json).toHaveBeenCalledWith({
      status: 500,
      message: 'Internal server error',
      data: null,
    });
  });

  it('logs 4xx as a warning', () => {
    const { host } = createHost();

    filter.catch(new NotFoundException('User not found'), host);

    expect(warnSpy).toHaveBeenCalledWith(
      '[-] GET /users/1 404 - User not found',
    );
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('includes the request id in the log', () => {
    const { host } = createHost({ requestId: 'req-123' });

    filter.catch(new NotFoundException('User not found'), host);

    expect(warnSpy).toHaveBeenCalledWith(
      '[req-123] GET /users/1 404 - User not found',
    );
  });

  it('logs 5xx as an error with the stack', () => {
    const { host } = createHost();
    const error = new Error('boom');

    filter.catch(error, host);

    expect(errorSpy).toHaveBeenCalledWith(
      '[-] GET /users/1 500 - Internal server error',
      error.stack,
    );
    expect(warnSpy).not.toHaveBeenCalled();
  });

  describe('Postgres errors', () => {
    const pgError = (code: string) =>
      new QueryFailedError(
        'SELECT 1',
        [],
        Object.assign(new Error(`pg says ${code}`), { code }),
      );

    it.each([
      ['23502', 400, 'Invalid request data'],
      ['22P02', 400, 'Invalid request data'],
      ['23514', 400, 'Invalid request data'],
      ['23505', 409, 'Resource already exists'],
      ['55P03', 503, 'Service temporarily unavailable, please retry'],
      ['57014', 503, 'Service temporarily unavailable, please retry'],
    ])('maps %s to %i', (code, status, message) => {
      const { host, response } = createHost();

      filter.catch(pgError(code), host);

      expect(response.status).toHaveBeenCalledWith(status);
      expect(response.json).toHaveBeenCalledWith({
        status,
        message,
        data: null,
      });
    });

    it('logs the code but never sends the driver message', () => {
      const { host, response } = createHost();

      filter.catch(pgError('23505'), host);

      expect(warnSpy).toHaveBeenCalledWith(
        '[-] GET /users/1 409 - Resource already exists (pg 23505)',
      );
      expect(JSON.stringify(response.json.mock.calls)).not.toContain('pg says');
    });

    it('keeps other database errors a generic 500', () => {
      const { host, response } = createHost();

      filter.catch(pgError('XX000'), host);

      expect(response.status).toHaveBeenCalledWith(500);
      expect(response.json).toHaveBeenCalledWith({
        status: 500,
        message: 'Internal server error',
        data: null,
      });
    });
  });

  it('logs an exception cause without sending it', () => {
    const { host, response } = createHost();

    filter.catch(
      new UnauthorizedException('Unauthorized', { cause: 'jwt expired' }),
      host,
    );

    expect(warnSpy).toHaveBeenCalledWith(
      '[-] GET /users/1 401 - Unauthorized (jwt expired)',
    );
    expect(response.json).toHaveBeenCalledWith({
      status: 401,
      message: 'Unauthorized',
      data: null,
    });
  });

  it('only logs when the response headers were already sent', () => {
    const { host, response } = createHost();
    Object.assign(response, { headersSent: true });

    filter.catch(new Error('stream broke'), host);

    expect(errorSpy).toHaveBeenCalled();
    expect(response.status).not.toHaveBeenCalled();
    expect(response.json).not.toHaveBeenCalled();
  });
});
