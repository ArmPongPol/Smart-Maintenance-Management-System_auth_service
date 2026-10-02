import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TtlCache } from '@/common/utils/ttl-cache';
import { User } from './entities/user.entity';

const MAX_ENTRIES = 10_000;

// Short-lived cache of users for JwtStrategy, which otherwise reads the users
// table on every authenticated request. UsersService invalidates an entry when
// it changes that user, so in a single process changes apply immediately; in
// cluster mode other workers see them after at most USER_CACHE_TTL_MS.
@Injectable()
export class UserCacheService {
  private readonly cache: TtlCache<string, User | null>;

  constructor(config: ConfigService) {
    this.cache = new TtlCache(
      config.get<number>('cache.userTtlMs') ?? 5000,
      MAX_ENTRIES,
    );
  }

  /** Unknown ids are not cached. */
  getOrLoad(
    id: string,
    load: () => Promise<User | null>,
  ): Promise<User | null> {
    return this.cache.getOrLoad(id, load, (user) => user !== null);
  }

  invalidate(id: string): void {
    this.cache.delete(id);
  }
}
