import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as argon2 from 'argon2';
import { availableParallelism } from 'node:os';
import { ARGON2_OPTIONS } from '@/common/constants/argon2';
import { Semaphore } from '@/common/utils/semaphore';

// All argon2 work goes through here so it is bounded process-wide: each
// operation holds ~19 MiB and a libuv thread for tens of milliseconds, and an
// unbounded login burst would otherwise exhaust memory and the thread pool.
// When too many callers are queued, hash/verify throw 503.
@Injectable()
export class PasswordService {
  private readonly semaphore: Semaphore;

  constructor(config: ConfigService) {
    this.semaphore = new Semaphore(
      Math.max(
        1,
        config.get<number>('hashing.concurrency') ?? availableParallelism(),
      ),
      Math.max(0, config.get<number>('hashing.queueMax') ?? 200),
    );
  }

  hash(plain: string): Promise<string> {
    return this.semaphore.run(() => argon2.hash(plain, ARGON2_OPTIONS));
  }

  verify(hash: string, plain: string): Promise<boolean> {
    return this.semaphore.run(() => argon2.verify(hash, plain));
  }

  /** True when the hash was made with other parameters (or another variant). */
  needsRehash(hash: string): boolean {
    return (
      !hash.startsWith('$argon2id$') ||
      argon2.needsRehash(hash, {
        memoryCost: ARGON2_OPTIONS.memoryCost,
        timeCost: ARGON2_OPTIONS.timeCost,
        parallelism: ARGON2_OPTIONS.parallelism,
      })
    );
  }
}
