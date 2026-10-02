import { registerAs } from '@nestjs/config';
import { intFromEnv } from './env.utils';

export default registerAs('database', () => ({
  // DATABASE_HOST is preferred; HOST is the older name, still read as a fallback.
  host: process.env.DATABASE_HOST || process.env.HOST,
  port: parseInt(process.env.DATABASE_PORT || '5432', 10),
  username: process.env.DATABASE_USERNAME,
  password: process.env.DATABASE_PASSWORD,
  database: process.env.DATABASE_DATABASE,
  // Connections per process: with N cluster workers the service opens up to
  // N x poolSize connections, which must fit Postgres max_connections.
  poolSize: intFromEnv('DATABASE_POOL_SIZE', 10),
  synchronize: String(process.env.DATABASE_SYNCHRONIZE || 'false') === 'true',
  logging: String(process.env.DB_LOGGING || 'false') === 'true',
  ssl: String(process.env.DATABASE_SSL || 'false') === 'true',
  sslRejectUnauthorized:
    String(process.env.DATABASE_SSL_REJECT_UNAUTHORIZED || 'true') === 'true',
}));
