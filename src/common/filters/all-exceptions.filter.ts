import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { QueryFailedError } from 'typeorm';
import { StandardResponse } from '../interfaces/standard-response.interface';
import { getRequestId } from '../middleware/request-id.middleware';

const INTERNAL_ERROR_MESSAGE = 'Internal server error';
const INVALID_DATA = 'Invalid request data';
const RETRY_LATER = 'Service temporarily unavailable, please retry';

// Postgres errors caused by the request or by transient load, rather than by
// a bug. https://www.postgresql.org/docs/current/errcodes-appendix.html
const PG_ERRORS: Record<string, { status: number; message: string }> = {
  // not_null_violation, invalid_text_representation, check_violation
  '23502': { status: HttpStatus.BAD_REQUEST, message: INVALID_DATA },
  '22P02': { status: HttpStatus.BAD_REQUEST, message: INVALID_DATA },
  '23514': { status: HttpStatus.BAD_REQUEST, message: INVALID_DATA },
  // unique_violation
  '23505': { status: HttpStatus.CONFLICT, message: 'Resource already exists' },
  // lock_not_available, query_canceled (statement_timeout)
  '55P03': { status: HttpStatus.SERVICE_UNAVAILABLE, message: RETRY_LATER },
  '57014': { status: HttpStatus.SERVICE_UNAVAILABLE, message: RETRY_LATER },
};

interface ResolvedError {
  status: number;
  message: string;
  /** Extra detail for the log only, never sent to the client. */
  detail?: string;
}

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('HTTP');

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const request = http.getRequest<Request>();
    const response = http.getResponse<Response>();
    const { method, originalUrl } = request;
    const requestId = getRequestId(request) ?? '-';

    const { status, message, detail } = this.resolve(exception);

    const suffix = detail ? ` (${detail})` : '';
    const line = `[${requestId}] ${method} ${originalUrl} ${status} - ${message}${suffix}`;
    if (status >= 500) {
      this.logger.error(
        line,
        exception instanceof Error ? exception.stack : undefined,
      );
    } else {
      this.logger.warn(line);
    }

    // Part of the response is already out (e.g. a failing stream); writing
    // again would throw "headers already sent".
    if (response.headersSent) return;

    const body: StandardResponse<null> = { status, message, data: null };
    response.status(status).json(body);
  }

  private resolve(exception: unknown): ResolvedError {
    if (exception instanceof HttpException) {
      return {
        status: exception.getStatus(),
        message: this.getHttpMessage(exception),
        detail: this.describeCause(exception.cause),
      };
    }

    if (exception instanceof QueryFailedError) {
      const driverError = exception.driverError as
        { code?: string } | undefined;
      const code = driverError?.code;
      const mapped = code ? PG_ERRORS[code] : undefined;
      if (mapped) return { ...mapped, detail: `pg ${code}` };
    }

    // Never leak internals of unexpected errors to the client.
    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      message: INTERNAL_ERROR_MESSAGE,
    };
  }

  private describeCause(cause: unknown): string | undefined {
    if (cause instanceof Error) return cause.message;
    if (typeof cause === 'string') return cause;
    return undefined;
  }

  private getHttpMessage(exception: HttpException): string {
    const exceptionResponse = exception.getResponse();
    if (typeof exceptionResponse === 'string') {
      return exceptionResponse;
    }

    // ValidationPipe puts an array of messages here.
    const { message } = exceptionResponse as { message?: string | string[] };
    if (Array.isArray(message)) {
      return message.join(', ');
    }

    return message ?? exception.message;
  }
}
