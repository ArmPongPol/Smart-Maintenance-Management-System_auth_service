import { registerAs } from '@nestjs/config';

export default registerAs('app', () => ({
  name: process.env.APP_NAME,
  env: process.env.NODE_ENV,
  // Loopback by default so the service is only reachable through the
  // api-gateway on the same host. Containers set APP_HOST=0.0.0.0.
  host: process.env.APP_HOST || '127.0.0.1',
  port: parseInt(process.env.PORT || '3001', 10),
  logLevel: process.env.LOG_LEVEL || 'log',
  apiPrefix: process.env.API_PREFIX,
  apiVersion: process.env.API_VERSION,
  corsOrigins: (process.env.CORS_ORIGINS || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean),
  corsCredential: String(process.env.CORS_CREDENTIALS || 'true') === 'true',
}));
