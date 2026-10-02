import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { Observable, tap } from 'rxjs';
import { getRequestId } from '../middleware/request-id.middleware';

// Probes hit these every few seconds; logging them would drown real traffic.
// Matches with or without an API prefix, e.g. /health/live, /api/health/ready.
const HEALTH_PATH = /(^|\/)health(\/|$)/;

// Logs successful requests only; errors are logged by AllExceptionsFilter,
// which also sees failures that never reach interceptors (guards, 404 routes).
// Logged at 'log' level, so LOG_LEVEL=warn (or higher) silences it: main.ts
// applies LOG_LEVEL to every Nest Logger with app.useLogger().
@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger('HTTP');

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') {
      return next.handle();
    }

    const http = context.switchToHttp();
    const request = http.getRequest<Request>();
    const { method, originalUrl } = request;
    if (HEALTH_PATH.test(originalUrl.split('?')[0])) {
      return next.handle();
    }

    const response = http.getResponse<Response>();
    const requestId = getRequestId(request) ?? '-';
    const startedAt = Date.now();

    return next
      .handle()
      .pipe(
        tap(() =>
          this.logger.log(
            `[${requestId}] ${method} ${originalUrl} ${response.statusCode} - ${Date.now() - startedAt}ms`,
          ),
        ),
      );
  }
}
