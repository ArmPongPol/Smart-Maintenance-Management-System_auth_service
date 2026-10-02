import { registerAs } from '@nestjs/config';

export default registerAs('docs', () => ({
  // Off by default in production; set DOCS_ENABLED=true to expose it anyway.
  enable:
    String(
      process.env.DOCS_ENABLED ??
        (process.env.NODE_ENV === 'production' ? 'false' : 'true'),
    ) === 'true',
  path: process.env.DOCS_PATH || 'docs',
  title: process.env.APP_NAME || 'API',
  description: process.env.DOCS_DESCRIPTION,
}));
