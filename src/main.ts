import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';
import type { Server } from 'node:http';
import { AppModule } from './app.module';
import { requestIdMiddleware } from './common/middleware/request-id.middleware';
import { resolveLogLevels } from './config/log-level';
import { setupSwagger } from './config/swagger.config';

// Longer than the idle timeout of typical proxies/load balancers in front
// (60 s), so they close idle keep-alive connections first and never send a
// request on a socket Node is closing. headersTimeout must exceed it.
const KEEP_ALIVE_TIMEOUT_MS = 65_000;
const HEADERS_TIMEOUT_MS = 66_000;

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  const config = app.get(ConfigService);

  app.useLogger(resolveLogLevels(config.get<string>('app.logLevel')));
  app.disable('x-powered-by');

  // Default security headers. upgrade-insecure-requests is dropped so the
  // Swagger UI still loads its assets when served over plain HTTP.
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: { 'upgrade-insecure-requests': null },
      },
    }),
  );

  // Registered here instead of in a module so it runs before Nest's body parser;
  // otherwise body-parser errors (bad JSON, payload too large) would have no request id.
  app.use(requestIdMiddleware);

  const apiPrefix = config.get<string>('app.apiPrefix');
  if (apiPrefix) {
    app.setGlobalPrefix(apiPrefix);
  }

  // An empty CORS_ORIGINS allows no cross-origin requests.
  app.enableCors({
    origin: config.get<string[]>('app.corsOrigins'),
    credentials: config.get<boolean>('app.corsCredential'),
  });

  // whitelist + forbidNonWhitelisted: unknown fields (e.g. `role` on register)
  // are rejected with 400 instead of being passed through to the service.
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  // SIGTERM/SIGINT: stop accepting connections, finish in-flight requests and
  // close the database pool before exiting.
  app.enableShutdownHooks();

  setupSwagger(app);

  const server: Server = app.getHttpServer();
  server.keepAliveTimeout = KEEP_ALIVE_TIMEOUT_MS;
  server.headersTimeout = HEADERS_TIMEOUT_MS;

  await app.listen(
    config.getOrThrow<number>('app.port'),
    config.getOrThrow<string>('app.host'),
  );
}

bootstrap().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
