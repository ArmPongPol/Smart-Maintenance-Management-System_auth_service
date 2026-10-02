import { SetMetadata } from '@nestjs/common';
import { UserRoleEnum } from '../constants/enum';

export const ROLES_KEY = 'requiredRoles';

/** Allows the request when the user has any one of the given roles. */
export const RequiredRoles = (...roles: UserRoleEnum[]) =>
  SetMetadata(ROLES_KEY, roles);
