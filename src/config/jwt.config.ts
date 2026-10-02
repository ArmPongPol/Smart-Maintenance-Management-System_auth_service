import { registerAs } from '@nestjs/config';
import { intFromEnv } from './env.utils';

export default registerAs('jwt', () => ({
  accessSecret: process.env.JWT_ACCESS_SECRET as string,
  refreshSecret: process.env.JWT_REFRESH_SECRET as string,
  accessTtl: process.env.JWT_ACCESS_TTL ?? '15m',
  // Lifetime of one refresh token; every refresh issues a new one.
  refreshTtl: process.env.JWT_REFRESH_TTL ?? '7d',
  issuer: process.env.JWT_ISSUER ?? 'auth-service',
  audience: process.env.JWT_AUDIENCE ?? 'auth-service-clients',
  // Absolute session lifetime from login, however often it is refreshed.
  refreshSessionMaxDays: intFromEnv('REFRESH_SESSION_MAX_DAYS', 30),
  // How long the previous refresh token stays usable after a rotation, so
  // two tabs/requests refreshing at once don't trip reuse detection.
  refreshReuseGraceSeconds: intFromEnv('REFRESH_REUSE_GRACE_SECONDS', 30),
  // Per-account login lockout: wrong passwords allowed per window (0 = off).
  loginMaxFailures: intFromEnv('LOGIN_MAX_FAILURES', 5),
  loginFailureWindowSeconds: intFromEnv('LOGIN_FAILURE_WINDOW_SECONDS', 900),
}));
