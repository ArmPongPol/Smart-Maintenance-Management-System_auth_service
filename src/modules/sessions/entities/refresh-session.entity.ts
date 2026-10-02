import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { User } from '@/modules/users/entities/user.entity';

// One row per login. The refresh token carries (sid, gen); each refresh bumps
// `generation`, so a token whose gen is behind the row is a replay.
@Entity({ name: 'refresh_sessions' })
export class RefreshSession {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user?: User;

  @Column({ name: 'generation', type: 'int', default: 0 })
  generation: number;

  // When the current generation was issued; the refresh token's iat.
  @Column({ name: 'rotated_at', type: 'timestamptz' })
  rotatedAt: Date;

  // Absolute end of the session (login + REFRESH_SESSION_MAX_DAYS).
  @Column({ name: 'expires_at', type: 'timestamptz' })
  expiresAt: Date;

  @Column({ name: 'revoked_at', type: 'timestamptz', nullable: true })
  revokedAt: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
