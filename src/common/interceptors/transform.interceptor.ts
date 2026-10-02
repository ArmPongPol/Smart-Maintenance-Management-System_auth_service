import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
  StreamableFile,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Response } from 'express';
import { Observable, map } from 'rxjs';
import { RESPONSE_MESSAGE_KEY } from '../decorators/response-message.decorator';
import { SKIP_TRANSFORM_KEY } from '../decorators/skip-transform.decorator';
import { StandardResponse } from '../interfaces/standard-response.interface';

const DEFAULT_MESSAGE = 'Success';

@Injectable()
export class TransformInterceptor<T> implements NestInterceptor<
  T,
  StandardResponse<T> | T
> {
  constructor(private readonly reflector: Reflector) {}

  intercept(
    context: ExecutionContext,
    next: CallHandler<T>,
  ): Observable<StandardResponse<T> | T> {
    const targets = [context.getHandler(), context.getClass()];

    const skip = this.reflector.getAllAndOverride<boolean>(
      SKIP_TRANSFORM_KEY,
      targets,
    );
    if (skip || context.getType() !== 'http') {
      return next.handle();
    }

    const response = context.switchToHttp().getResponse<Response>();
    const message =
      this.reflector.getAllAndOverride<string>(RESPONSE_MESSAGE_KEY, targets) ??
      DEFAULT_MESSAGE;

    return next.handle().pipe(
      map((data) => {
        if (data instanceof StreamableFile) {
          return data;
        }

        return {
          status: response.statusCode,
          message,
          data: data ?? null,
        };
      }),
    );
  }
}
