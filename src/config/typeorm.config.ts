import { ConfigService } from '@nestjs/config';
import { TypeOrmModuleOptions } from '@nestjs/typeorm';
import { join } from 'path';

// Server-side limits applied to every pooled connection. A runaway query or a
// transaction left open by a bug is cut off instead of holding a connection
// (and its locks) indefinitely.
export const STATEMENT_TIMEOUT_MS = 5000;
export const IDLE_IN_TRANSACTION_TIMEOUT_MS = 10000;
// Queries slower than this are logged by TypeORM as "query is slow".
export const SLOW_QUERY_MS = 500;

export function buildTypeOrmOptions(
  config: ConfigService,
): TypeOrmModuleOptions {
  const synchronize = config.get<boolean>('database.synchronize') ?? false;

  if (synchronize && config.get<string>('app.env') === 'production') {
    throw new Error(
      `DB_SYNCHRONIZE must never be enabled in production. Use migrations`,
    );
  }

  return {
    type: 'postgres',
    host: config.get<string>('database.host'),
    port: config.get<number>('database.port'),
    username: config.get<string>('database.username'),
    password: config.get<string>('database.password'),
    database: config.get<string>('database.database'),
    // rejectUnauthorized: false accepts any certificate (MITM-able); only turn
    // it off for providers with self-signed certs you can't supply a CA for.
    ssl: config.get<boolean>('database.ssl')
      ? {
          rejectUnauthorized:
            config.get<boolean>('database.sslRejectUnauthorized') ?? true,
        }
      : false,
    poolSize: config.get<number>('database.poolSize') ?? 10,
    // Fail fast when the pool is exhausted or the server is unreachable.
    connectTimeoutMS: 3000,
    extra: {
      statement_timeout: STATEMENT_TIMEOUT_MS,
      idle_in_transaction_session_timeout: IDLE_IN_TRANSACTION_TIMEOUT_MS,
      application_name: 'my-project',
    },
    maxQueryExecutionTime: SLOW_QUERY_MS,
    autoLoadEntities: true,
    synchronize,
    logging: config.get<boolean>('database.logging'),
    migrations: [join(__dirname, '..', 'database', 'migrations', '*.{ts,js}')],
    migrationsRun: false,
  };
}
