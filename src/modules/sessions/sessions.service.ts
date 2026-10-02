import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, IsNull, LessThan, Repository } from 'typeorm';
import { RefreshSession } from './entities/refresh-session.entity';

const DAY_MS = 24 * 60 * 60 * 1000;

@Injectable()
export class SessionsService {
  private readonly maxAgeMs: number;

  constructor(
    @InjectRepository(RefreshSession)
    private readonly sessionRepository: Repository<RefreshSession>,
    config: ConfigService,
  ) {
    this.maxAgeMs =
      (config.get<number>('jwt.refreshSessionMaxDays') ?? 30) * DAY_MS;
  }

  async create(userId: string, now = new Date()): Promise<RefreshSession> {
    // Housekeeping: drop this user's sessions that can no longer be used
    // (cheap thanks to the user_id index), so rows don't pile up forever.
    await this.sessionRepository.delete({ userId, expiresAt: LessThan(now) });

    return this.sessionRepository.save(
      this.sessionRepository.create({
        userId,
        generation: 0,
        // Set here rather than by the database so the token signed from this
        // object has exactly the iat a later reload will compute.
        rotatedAt: now,
        expiresAt: new Date(now.getTime() + this.maxAgeMs),
        revokedAt: null,
      }),
    );
  }

  findById(id: string): Promise<RefreshSession | null> {
    return this.sessionRepository.findOne({ where: { id } });
  }

  /**
   * Moves the session to the next generation if it is still at
   * `session.generation` and not revoked. A single conditional UPDATE, so of
   * two concurrent refreshes with the same token exactly one wins; the loser
   * gets null and should reload the session.
   */
  async rotate(
    session: RefreshSession,
    now = new Date(),
  ): Promise<RefreshSession | null> {
    const { affected } = await this.sessionRepository.update(
      { id: session.id, generation: session.generation, revokedAt: IsNull() },
      { generation: session.generation + 1, rotatedAt: now },
    );
    if (!affected) return null;

    return { ...session, generation: session.generation + 1, rotatedAt: now };
  }

  async revoke(id: string, now = new Date()): Promise<void> {
    await this.sessionRepository.update(
      { id, revokedAt: IsNull() },
      { revokedAt: now },
    );
  }

  /** Pass `manager` to revoke inside the caller's transaction. */
  async revokeAllForUser(
    userId: string,
    manager?: EntityManager,
    now = new Date(),
  ): Promise<void> {
    const repository = manager
      ? manager.getRepository(RefreshSession)
      : this.sessionRepository;

    await repository.update(
      { userId, revokedAt: IsNull() },
      { revokedAt: now },
    );
  }
}
