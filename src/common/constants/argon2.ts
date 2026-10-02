import * as argon2 from 'argon2';

// OWASP's argon2id baseline (19 MiB, 2 iterations, 1 lane). Every hash in the
// app and the seed uses these, and login rehashes anything weaker or stronger.
export const ARGON2_OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
} as const;
