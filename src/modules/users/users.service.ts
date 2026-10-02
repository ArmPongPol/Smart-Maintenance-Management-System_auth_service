import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { DeepPartial, QueryFailedError, Repository } from 'typeorm';
import { UserRoleEnum, UserStatusEnum } from '@/common/constants/enum';
import { TtlCache } from '@/common/utils/ttl-cache';
import { SessionsService } from '../sessions/sessions.service';
import { CreateUserDto } from './dto/create-user.dto';
import { DirectoryQueryDto } from './dto/directory-query.dto';
import { FindUsersQueryDto } from './dto/find-users-query.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { User } from './entities/user.entity';
import { PasswordService } from './password.service';
import { UserCacheService } from './user-cache.service';

export type UserDirectoryEntry = Pick<
  User,
  'id' | 'firstName' | 'lastName' | 'role' | 'status'
>;

const PG_UNIQUE_VIOLATION = '23505';
const EMAIL_TAKEN = 'An account with that email already exists.';
export const LAST_ADMIN_MESSAGE = 'Cannot remove the last administrator';

// One entry per role filter plus "all roles".
const DIRECTORY_CACHE_MAX_ENTRIES = 16;
const ALL_ROLES = '*';

@Injectable()
export class UsersService {
  private readonly directoryCache: TtlCache<string, UserDirectoryEntry[]>;

  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    private readonly passwords: PasswordService,
    private readonly sessions: SessionsService,
    private readonly userCache: UserCacheService,
    config: ConfigService,
  ) {
    this.directoryCache = new TtlCache(
      config.get<number>('cache.directoryTtlMs') ?? 30_000,
      DIRECTORY_CACHE_MAX_ENTRIES,
    );
  }

  async create(dto: CreateUserDto): Promise<User> {
    // Checked up front for a clear error; saveUnique still covers the race
    // where two requests pass this check at the same time.
    if (await this.userRepository.exists({ where: { email: dto.email } })) {
      throw new ConflictException(EMAIL_TAKEN);
    }

    const saved = await this.saveUnique(
      this.userRepository,
      this.userRepository.create({
        ...dto,
        password: await this.passwords.hash(dto.password),
      }),
    );
    this.directoryCache.clear();

    // Re-read so the response comes from a `select: false` query and never
    // carries the password hash.
    return this.findOneOrFail(saved.id);
  }

  async findAll({ page, limit }: FindUsersQueryDto) {
    const [items, total] = await this.userRepository.findAndCount({
      order: { createdAt: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });

    return { items, total, page, limit };
  }

  // Inactive users stay listed so their past activity still shows a name.
  // Cached per role filter for DIRECTORY_CACHE_TTL_MS (other services call
  // this a lot); any user create/update/remove in this process clears it.
  directory({ role }: DirectoryQueryDto): Promise<UserDirectoryEntry[]> {
    return this.directoryCache.getOrLoad(role ?? ALL_ROLES, () =>
      this.userRepository.find({
        select: {
          id: true,
          firstName: true,
          lastName: true,
          role: true,
          status: true,
        },
        where: role ? { role } : {},
        order: { firstName: 'ASC', lastName: 'ASC' },
      }),
    );
  }

  findOne(id: string): Promise<User | null> {
    return this.userRepository.findOne({ where: { id } });
  }

  async findOneOrFail(id: string): Promise<User> {
    const user = await this.findOne(id);
    if (!user) throw new NotFoundException('User not found');

    return user;
  }

  // The only lookup that returns the password hash; used by login.
  findByEmailWithPassword(email: string): Promise<User | null> {
    return this.userRepository
      .createQueryBuilder('user')
      .addSelect('user.password')
      .where('user.email = :email', { email })
      .getOne();
  }

  /**
   * Replaces a password hash with a re-hash of the same password (login
   * upgrading old argon2 parameters). Conditional on the old hash, so it never
   * overwrites a password that was changed in the meantime.
   */
  async replacePasswordHash(
    id: string,
    currentHash: string,
    newHash: string,
  ): Promise<boolean> {
    const { affected } = await this.userRepository.update(
      { id, password: currentHash },
      { password: newHash },
    );
    return Boolean(affected);
  }

  async update(id: string, dto: UpdateUserDto): Promise<User> {
    const { password, ...rest } = dto;
    const changes: DeepPartial<User> = { ...rest };
    if (password) {
      changes.password = await this.passwords.hash(password);
    }

    await this.userRepository.manager.transaction(async (manager) => {
      const repository = manager.getRepository(User);

      const before = await repository.findOne({ where: { id } });
      if (!before) throw new NotFoundException('User not found');

      const losesAdmin =
        (rest.role !== undefined && rest.role !== UserRoleEnum.ADMIN) ||
        (rest.status !== undefined && rest.status !== UserStatusEnum.ACTIVE);
      if (losesAdmin && this.isActiveAdmin(before)) {
        await this.assertNotLastActiveAdmin(repository, id);
      }

      const user = await repository.preload({ id, ...changes });
      if (!user) throw new NotFoundException('User not found');

      await this.saveUnique(repository, user);

      // Existing refresh sessions must not outlive a credential or
      // privilege change. Same transaction, so both happen or neither does.
      const revokeSessions =
        Boolean(password) ||
        rest.status === UserStatusEnum.INACTIVE ||
        (rest.role !== undefined && rest.role !== before.role);
      if (revokeSessions) {
        await this.sessions.revokeAllForUser(id, manager);
      }
    });
    this.invalidateCaches(id);

    return this.findOneOrFail(id);
  }

  // Soft delete: the row stays for history, JwtStrategy rejects the account's
  // access tokens from the next request on, and its refresh sessions are revoked.
  async remove(id: string): Promise<void> {
    await this.userRepository.manager.transaction(async (manager) => {
      const repository = manager.getRepository(User);

      const user = await repository.findOne({ where: { id } });
      if (!user) throw new NotFoundException('User not found');

      if (this.isActiveAdmin(user)) {
        await this.assertNotLastActiveAdmin(repository, id);
      }

      const { affected } = await repository.update(id, {
        status: UserStatusEnum.INACTIVE,
      });
      if (!affected) throw new NotFoundException('User not found');

      await this.sessions.revokeAllForUser(id, manager);
    });
    this.invalidateCaches(id);
  }

  private isActiveAdmin(user: User): boolean {
    return (
      user.role === UserRoleEnum.ADMIN && user.status === UserStatusEnum.ACTIVE
    );
  }

  // Locks every active administrator row (FOR UPDATE) before counting, so two
  // concurrent requests demoting the last two admins are serialized: the
  // second one waits, re-reads, and sees it would leave none.
  private async assertNotLastActiveAdmin(
    repository: Repository<User>,
    id: string,
  ): Promise<void> {
    const admins = await repository.find({
      select: { id: true },
      where: { role: UserRoleEnum.ADMIN, status: UserStatusEnum.ACTIVE },
      lock: { mode: 'pessimistic_write' },
    });

    const others = admins.filter((admin) => admin.id !== id);
    if (others.length === 0) {
      throw new ConflictException(LAST_ADMIN_MESSAGE);
    }
  }

  private invalidateCaches(id: string): void {
    this.userCache.invalidate(id);
    this.directoryCache.clear();
  }

  private async saveUnique(
    repository: Repository<User>,
    user: User,
  ): Promise<User> {
    try {
      return await repository.save(user);
    } catch (error) {
      if (
        error instanceof QueryFailedError &&
        (error.driverError as { code?: string }).code === PG_UNIQUE_VIOLATION
      ) {
        throw new ConflictException(EMAIL_TAKEN);
      }
      throw error;
    }
  }
}
