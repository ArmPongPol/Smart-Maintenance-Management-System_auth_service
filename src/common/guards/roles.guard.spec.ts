import {
  ExecutionContext,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { UserRoleEnum } from '../constants/enum';
import { Public } from '../decorators/public.decorator';
import { RequiredRoles } from '../decorators/roles.decorator';
import { AuthenticatedUser } from '../interfaces/jwt-payload.interface';
import { RolesGuard } from './roles.guard';

class TestController {
  open(this: void) {}

  @RequiredRoles(UserRoleEnum.ADMIN, UserRoleEnum.LEADER)
  restricted(this: void) {}

  @Public()
  @RequiredRoles(UserRoleEnum.ADMIN)
  publicRoute(this: void) {}
}

@RequiredRoles(UserRoleEnum.ADMIN)
class AdminController {
  handler(this: void) {}
}

type Handler = () => void;

const userWith = (role: UserRoleEnum): AuthenticatedUser => ({
  id: 'u1',
  email: 'user@example.com',
  role,
});

const createContext = ({
  handler = TestController.prototype.open,
  controller = TestController,
  user,
}: {
  handler?: Handler;
  controller?: new () => unknown;
  user?: AuthenticatedUser;
} = {}) =>
  ({
    getHandler: () => handler,
    getClass: () => controller,
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  }) as unknown as ExecutionContext;

describe('RolesGuard', () => {
  const guard = new RolesGuard(new Reflector());

  it('allows routes without @RequiredRoles', () => {
    expect(guard.canActivate(createContext())).toBe(true);
  });

  it('allows a user with any one of the required roles', () => {
    const context = createContext({
      handler: TestController.prototype.restricted,
      user: userWith(UserRoleEnum.LEADER),
    });

    expect(guard.canActivate(context)).toBe(true);
  });

  it('rejects a user without a required role', () => {
    const context = createContext({
      handler: TestController.prototype.restricted,
      user: userWith(UserRoleEnum.OPERATOR),
    });

    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
  });

  it('applies @RequiredRoles on the controller class', () => {
    const context = createContext({
      handler: AdminController.prototype.handler,
      controller: AdminController,
      user: userWith(UserRoleEnum.TECHNICIAN),
    });

    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
  });

  it('rejects with 401 when no user is on the request', () => {
    const context = createContext({
      handler: TestController.prototype.restricted,
    });

    expect(() => guard.canActivate(context)).toThrow(UnauthorizedException);
  });

  it('skips the check on @Public routes', () => {
    const context = createContext({
      handler: TestController.prototype.publicRoute,
    });

    expect(guard.canActivate(context)).toBe(true);
  });
});
