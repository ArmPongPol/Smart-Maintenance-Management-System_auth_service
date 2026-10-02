import { ConfigService } from '@nestjs/config';
import { IsNull, Repository } from 'typeorm';
import { RefreshSession } from './entities/refresh-session.entity';
import { SessionsService } from './sessions.service';

const DAY_MS = 24 * 60 * 60 * 1000;

describe('SessionsService', () => {
  let service: SessionsService;

  const repo = {
    create: jest.fn((entity: Partial<RefreshSession>) => entity),
    save: jest.fn((entity: Partial<RefreshSession>) =>
      Promise.resolve({ ...entity, id: 's1' }),
    ),
    delete: jest.fn().mockResolvedValue({ affected: 0 }),
    update: jest.fn<Promise<{ affected?: number }>, [unknown, unknown]>(),
    findOne: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    service = new SessionsService(
      repo as unknown as Repository<RefreshSession>,
      new ConfigService({ jwt: { refreshSessionMaxDays: 30 } }),
    );
  });

  it('creates generation 0 with an absolute expiry of login + max days', async () => {
    const now = new Date('2026-01-01T00:00:00.123Z');

    const session = await service.create('u1', now);

    expect(session).toMatchObject({
      id: 's1',
      userId: 'u1',
      generation: 0,
      rotatedAt: now,
      revokedAt: null,
    });
    expect(session.expiresAt.getTime()).toBe(now.getTime() + 30 * DAY_MS);
  });

  it('rotates with a single UPDATE conditional on generation and not revoked', async () => {
    repo.update.mockResolvedValue({ affected: 1 });
    const now = new Date();
    const session = { id: 's1', generation: 3 } as RefreshSession;

    const rotated = await service.rotate(session, now);

    expect(repo.update).toHaveBeenCalledWith(
      { id: 's1', generation: 3, revokedAt: IsNull() },
      { generation: 4, rotatedAt: now },
    );
    expect(rotated).toMatchObject({ id: 's1', generation: 4, rotatedAt: now });
  });

  it('returns null when another request rotated first', async () => {
    repo.update.mockResolvedValue({ affected: 0 });

    await expect(
      service.rotate({ id: 's1', generation: 3 } as RefreshSession),
    ).resolves.toBeNull();
  });

  it('revokes all live sessions of a user inside the given transaction', async () => {
    const txRepo = { update: jest.fn().mockResolvedValue({ affected: 2 }) };
    const manager = { getRepository: jest.fn(() => txRepo) };
    const now = new Date();

    await service.revokeAllForUser('u1', manager as never, now);

    expect(manager.getRepository).toHaveBeenCalledWith(RefreshSession);
    expect(txRepo.update).toHaveBeenCalledWith(
      { userId: 'u1', revokedAt: IsNull() },
      { revokedAt: now },
    );
    expect(repo.update).not.toHaveBeenCalled();
  });
});
