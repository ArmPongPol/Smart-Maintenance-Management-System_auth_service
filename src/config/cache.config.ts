import { registerAs } from '@nestjs/config';
import { intFromEnv } from './env.utils';

// In-process caches (per worker). 0 disables a cache.
export default registerAs('cache', () => ({
  // Users looked up by JwtStrategy on every authenticated request.
  userTtlMs: intFromEnv('USER_CACHE_TTL_MS', 5000),
  // GET /users/directory results, per role filter.
  directoryTtlMs: intFromEnv('DIRECTORY_CACHE_TTL_MS', 30000),
}));
