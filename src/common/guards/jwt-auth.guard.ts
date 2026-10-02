import {
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { Observable } from 'rxjs';
import { IS_PUBLIC } from '../decorators/public.decorator';
import { AuthenticatedUser } from '../interfaces/jwt-payload.interface';

export const UNAUTHORIZED_MESSAGE = 'Unauthorized';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private readonly reflector: Reflector) {
    super();
  }

  canActivate(
    context: ExecutionContext,
  ): boolean | Promise<boolean> | Observable<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [
      context.getHandler(),
      context.getClass(),
    ]);

    return isPublic ? true : super.canActivate(context);
  }

  // `info` is passport-jwt's reason when the token itself is rejected (e.g.
  // TokenExpiredError "jwt expired", "No auth token"); `err` is what
  // JwtStrategy.validate threw. Clients only ever see a generic 401; the
  // detailed reason travels as the exception's `cause`, which
  // AllExceptionsFilter writes to the log.
  handleRequest<TUser = AuthenticatedUser>(
    err: unknown,
    user: TUser | false,
    info?: Error,
  ): TUser {
    // Not an auth failure (e.g. the database is down): let it surface as such.
    if (err && !(err instanceof UnauthorizedException)) {
      throw err instanceof Error ? err : new UnauthorizedException();
    }

    if (err || !user) {
      const reason =
        (err instanceof Error ? err.message : undefined) ??
        info?.message ??
        'Invalid or expired access token';
      throw new UnauthorizedException(UNAUTHORIZED_MESSAGE, { cause: reason });
    }

    return user;
  }
}
