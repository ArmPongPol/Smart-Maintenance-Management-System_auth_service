import { UserRoleEnum } from '../constants/enum';

/**
 * The minimum every consumer of request.user may rely on. JwtStrategy actually
 * puts the whole User entity there (never with its password hash).
 */
export interface AuthenticatedUser {
  id: string;
  email: string;
  role: UserRoleEnum;
}

/** Claims added by jsonwebtoken from the sign options. */
export interface JwtRegisteredClaims {
  iat: number;
  exp: number;
  iss: string;
  aud: string;
}

export interface JwtAccessPayload extends JwtRegisteredClaims {
  /** user id */
  sub: string;
  email: string;
  role: UserRoleEnum;
  type: 'access';
}

export interface JwtRefreshPayload extends JwtRegisteredClaims {
  /** user id */
  sub: string;
  /** refresh session id (refresh_sessions.id) */
  sid: string;
  /** session generation this token was issued for */
  gen: number;
  type: 'refresh';
}
