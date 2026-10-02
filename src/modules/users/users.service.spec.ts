import { ConflictException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import * as argon2 from 'argon2';
import { QueryFailedError } from 'typeorm';
import { UserRoleEnum, UserStatusEnum } from '@/common/constants/enum';
import { SessionsService } from '../sessions/sessions.service';
import { CreateUserDto } from './dto/create-user.dto';
import { User } from './entities/user.entity';
import { PasswordService } from './password.service';
import { UserCacheService } from './user-cache.service';
import { LAST_ADMIN_MESSAGE, UsersService } from './users.service';

const dto: CreateUserDto = {
  email: 'user@example.com',
  password: 'Str0ng!Passw0rd',
  firstName: 'Test',
  lastName: 'User',
};

const uniqueViolation = () =>
  new QueryFailedError(
    'INSERT',
    [],
    Object.assign(new Error('duplicate key'), { code: '23505' }),
  );

const admin = (overrides: Partial<User> = {}) =>
  ({
    id: 'a1',
    email: 'admin@example.com',
    role: UserRoleEnum.ADMIN,
    status: UserStatusEnum.ACTIVE,
    ...overrides,
  }) as User;

describe('UsersService', () => {
  let service: UsersService;

  const repo = {
    exists: jest.fn<Promise<boolean>, []>(),
    create: jest.fn((entity: Partial<User>) => entity as User),
    save: jest.fn<Promise<User>, [User]>(),
    findOne: jest.fn<Promise<User | null>, []>(),
    preload: jest.fn<Promise<User | undefined>, [Partial<User>]>(),
    update: jest.fn<Promise<{ affected?: number }>, [unknown, Partial<User>]>(),
    find: jest.fn<Promise<User[]>, [Record<string, unknown>]>(),
    manager: {
      // Runs the callback with a manager whose repository is this mock.
      transaction: jest.fn(
        (work: (manager: { getRepository: () => unknown }) => unknown) =>
          work(transactionManager),
      ),
    },
  };
  const transactionManager = { getRepository: () => repo };

  const sessions = { revokeAllForUser: jest.fn() };
  const userCache = { invalidate: jest.fn() };

  beforeEach(async () => {
    jest.clearAllMocks();
    repo.exists.mockResolvedValue(false);
    repo.save.mockImplementation((user) =>
      Promise.resolve({ ...user, id: 'u1' }),
    );
    repo.findOne.mockResolvedValue({ id: 'u1', email: dto.email } as User);
    repo.preload.mockImplementation((changes) =>
      Promise.resolve(changes as User),
    );
    repo.update.mockResolvedValue({ affected: 1 });
    repo.find.mockResolvedValue([]);
    sessions.revokeAllForUser.mockResolvedValue(undefined);

    const config = new ConfigService({
      cache: { directoryTtlMs: 30_000 },
      hashing: { concurrency: 2, queueMax: 10 },
    });
    const module = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: getRepositoryToken(User), useValue: repo },
        { provide: ConfigService, useValue: config },
        { provide: PasswordService, useValue: new PasswordService(config) },
        { provide: SessionsService, useValue: sessions },
        { provide: UserCacheService, useValue: userCache },
      ],
    }).compile();

    service = module.get(UsersService);
  });

  describe('create', () => {
    it('stores an argon2 hash, not the plain password', async () => {
      await service.create(dto);

      const saved = repo.save.mock.calls[0][0];
      expect(saved.password).not.toBe(dto.password);
      expect(saved.password).toMatch(/^\$argon2id\$v=19\$m=19456,p=1,t=2\$/);
      await expect(argon2.verify(saved.password, dto.password)).resolves.toBe(
        true,
      );
    });

    it('returns the re-read user, which has no password field', async () => {
      const result = await service.create(dto);

      expect(result).toEqual({ id: 'u1', email: dto.email });
    });

    it('rejects an email that already exists', async () => {
      repo.exists.mockResolvedValue(true);

      await expect(service.create(dto)).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(repo.save).not.toHaveBeenCalled();
    });

    it('maps a unique violation on save to ConflictException', async () => {
      repo.save.mockRejectedValue(uniqueViolation());

      await expect(service.create(dto)).rejects.toBeInstanceOf(
        ConflictException,
      );
    });
  });

  describe('update', () => {
    it('hashes a new password', async () => {
      await service.update('u1', { password: 'N3w!Passw0rd123' });

      const changes = repo.preload.mock.calls[0][0];
      await expect(
        argon2.verify(changes.password!, 'N3w!Passw0rd123'),
      ).resolves.toBe(true);
    });

    it('throws NotFoundException for an unknown id', async () => {
      repo.preload.mockResolvedValue(undefined);

      await expect(
        service.update('missing', { firstName: 'X' }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('throws NotFoundException when the user does not exist', async () => {
      repo.findOne.mockResolvedValueOnce(null);

      await expect(
        service.update('missing', { firstName: 'X' }),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(repo.save).not.toHaveBeenCalled();
    });

    describe('revoking refresh sessions', () => {
      it('revokes all sessions when the password changes', async () => {
        await service.update('u1', { password: 'N3w!Passw0rd123' });

        expect(sessions.revokeAllForUser).toHaveBeenCalledWith(
          'u1',
          transactionManager,
        );
      });

      it('revokes all sessions when the account is deactivated', async () => {
        await service.update('u1', { status: UserStatusEnum.INACTIVE });

        expect(sessions.revokeAllForUser).toHaveBeenCalledWith(
          'u1',
          transactionManager,
        );
      });

      it('revokes all sessions when the role changes', async () => {
        repo.findOne.mockResolvedValueOnce({
          id: 'u1',
          role: UserRoleEnum.OPERATOR,
          status: UserStatusEnum.ACTIVE,
        } as User);

        await service.update('u1', { role: UserRoleEnum.TECHNICIAN });

        expect(sessions.revokeAllForUser).toHaveBeenCalledTimes(1);
      });

      it('keeps sessions for a same-role or name-only update', async () => {
        repo.findOne.mockResolvedValueOnce({
          id: 'u1',
          role: UserRoleEnum.OPERATOR,
          status: UserStatusEnum.ACTIVE,
        } as User);

        await service.update('u1', {
          firstName: 'New',
          role: UserRoleEnum.OPERATOR,
        });

        expect(sessions.revokeAllForUser).not.toHaveBeenCalled();
      });
    });

    it('invalidates the cached user', async () => {
      await service.update('u1', { firstName: 'New' });

      expect(userCache.invalidate).toHaveBeenCalledWith('u1');
    });

    describe('last administrator', () => {
      it('refuses to demote the last active administrator', async () => {
        repo.findOne.mockResolvedValueOnce(admin());
        repo.find.mockResolvedValueOnce([admin()]);

        await expect(
          service.update('a1', { role: UserRoleEnum.LEADER }),
        ).rejects.toThrow(new ConflictException(LAST_ADMIN_MESSAGE));
        expect(repo.save).not.toHaveBeenCalled();
        expect(sessions.revokeAllForUser).not.toHaveBeenCalled();
      });

      it('refuses to deactivate the last active administrator', async () => {
        repo.findOne.mockResolvedValueOnce(admin());
        repo.find.mockResolvedValueOnce([admin()]);

        await expect(
          service.update('a1', { status: UserStatusEnum.INACTIVE }),
        ).rejects.toThrow(new ConflictException(LAST_ADMIN_MESSAGE));
      });

      it('locks the active administrator rows while checking', async () => {
        repo.findOne.mockResolvedValueOnce(admin());
        repo.find.mockResolvedValueOnce([admin(), admin({ id: 'a2' })]);

        await service.update('a1', { role: UserRoleEnum.LEADER });

        expect(repo.find.mock.calls[0][0]).toMatchObject({
          where: { role: UserRoleEnum.ADMIN, status: UserStatusEnum.ACTIVE },
          lock: { mode: 'pessimistic_write' },
        });
        expect(repo.save).toHaveBeenCalled();
      });

      it('allows other updates to the last administrator', async () => {
        repo.findOne.mockResolvedValueOnce(admin());

        await service.update('a1', {
          firstName: 'Still',
          role: UserRoleEnum.ADMIN,
        });

        expect(repo.find).not.toHaveBeenCalled();
        expect(repo.save).toHaveBeenCalled();
      });

      it('refuses to remove the last active administrator', async () => {
        repo.findOne.mockResolvedValueOnce(admin());
        repo.find.mockResolvedValueOnce([admin()]);

        await expect(service.remove('a1')).rejects.toThrow(
          new ConflictException(LAST_ADMIN_MESSAGE),
        );
        expect(repo.update).not.toHaveBeenCalled();
      });

      it('removes an administrator when another one remains', async () => {
        repo.findOne.mockResolvedValueOnce(admin());
        repo.find.mockResolvedValueOnce([admin(), admin({ id: 'a2' })]);

        await service.remove('a1');

        expect(repo.update).toHaveBeenCalledWith('a1', {
          status: UserStatusEnum.INACTIVE,
        });
      });
    });
  });

  describe('remove', () => {
    it('deactivates the user instead of deleting the row', async () => {
      repo.update.mockResolvedValue({ affected: 1 });

      await service.remove('u1');

      expect(repo.update).toHaveBeenCalledWith('u1', {
        status: UserStatusEnum.INACTIVE,
      });
    });

    it('throws NotFoundException for an unknown id', async () => {
      repo.update.mockResolvedValue({ affected: 0 });

      await expect(service.remove('missing')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('revokes all sessions and invalidates the cached user', async () => {
      await service.remove('u1');

      expect(sessions.revokeAllForUser).toHaveBeenCalledWith(
        'u1',
        transactionManager,
      );
      expect(userCache.invalidate).toHaveBeenCalledWith('u1');
    });
  });

  describe('replacePasswordHash', () => {
    it('only replaces the hash it was given', async () => {
      await expect(
        service.replacePasswordHash('u1', 'old', 'new'),
      ).resolves.toBe(true);

      expect(repo.update).toHaveBeenCalledWith(
        { id: 'u1', password: 'old' },
        { password: 'new' },
      );
    });
  });

  describe('directory', () => {
    it('never selects email or password', async () => {
      repo.find.mockResolvedValue([]);

      await service.directory({});

      const { select } = repo.find.mock.calls[0][0] as {
        select: Record<string, boolean>;
      };
      expect(select).not.toHaveProperty('email');
      expect(select).not.toHaveProperty('password');
    });

    it('filters by role when given', async () => {
      repo.find.mockResolvedValue([]);

      await service.directory({ role: UserRoleEnum.TECHNICIAN });

      expect(repo.find.mock.calls[0][0]).toMatchObject({
        where: { role: UserRoleEnum.TECHNICIAN },
      });
    });

    it('serves repeat calls for the same role from the cache', async () => {
      const entries = [{ id: 'u1' } as User];
      repo.find.mockResolvedValue(entries);

      await service.directory({ role: UserRoleEnum.TECHNICIAN });
      const second = await service.directory({ role: UserRoleEnum.TECHNICIAN });

      expect(second).toBe(entries);
      expect(repo.find).toHaveBeenCalledTimes(1);
    });

    it('caches each role filter separately', async () => {
      await service.directory({});
      await service.directory({ role: UserRoleEnum.OPERATOR });
      await service.directory({});

      expect(repo.find).toHaveBeenCalledTimes(2);
    });

    it.each([
      ['create', (s: UsersService) => s.create(dto)],
      ['update', (s: UsersService) => s.update('u1', { firstName: 'X' })],
      ['remove', (s: UsersService) => s.remove('u1')],
    ])('is invalidated by %s', async (_name, change) => {
      await service.directory({});

      await change(service);
      await service.directory({});

      expect(repo.find).toHaveBeenCalledTimes(2);
    });
  });
});
