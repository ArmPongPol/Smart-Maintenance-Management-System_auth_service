import { registerAs } from '@nestjs/config';
import { availableParallelism } from 'node:os';
import { intFromEnv } from './env.utils';

export default registerAs('hashing', () => ({
  // argon2 hashes/verifies running at once in this process (each uses ~19 MiB
  // and a libuv thread). scripts/cluster.mjs lowers the default per worker.
  concurrency: intFromEnv('HASH_CONCURRENCY', availableParallelism()),
  // Callers allowed to wait for a slot; beyond that requests get 503.
  queueMax: intFromEnv('HASH_QUEUE_MAX', 200),
}));
