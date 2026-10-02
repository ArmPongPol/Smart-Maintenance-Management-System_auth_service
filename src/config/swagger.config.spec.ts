import { INestApplication } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { setupSwagger } from './swagger.config';

interface SwaggerDocument {
  info: { title: string; description: string };
  components: { securitySchemes: Record<string, { scheme: string }> };
}

describe('setupSwagger', () => {
  let app: INestApplication<App>;

  const createApp = async (docs: Record<string, unknown>) => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ ignoreEnvFile: true, load: [() => ({ docs })] }),
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    setupSwagger(app);
    await app.init();
  };

  afterEach(async () => {
    await app.close();
  });

  it('serves the UI and the spec when enabled', async () => {
    await createApp({
      enable: true,
      path: 'docs',
      title: 'Test API',
      description: 'Test description',
    });

    const spec = await request(app.getHttpServer())
      .get('/docs-json')
      .expect(200);
    const document = spec.body as SwaggerDocument;

    expect(document.info).toMatchObject({
      title: 'Test API',
      description: 'Test description',
    });
    expect(document.components.securitySchemes.bearer.scheme).toBe('bearer');

    const ui = await request(app.getHttpServer()).get('/docs').expect(200);
    expect(ui.text).toContain('swagger-ui');
  });

  it('uses the configured path', async () => {
    await createApp({ enable: true, path: 'api-docs', title: 'Test API' });

    await request(app.getHttpServer()).get('/api-docs-json').expect(200);
    await request(app.getHttpServer()).get('/docs-json').expect(404);
  });

  it('does not serve docs when disabled', async () => {
    await createApp({ enable: false, path: 'docs', title: 'Test API' });

    await request(app.getHttpServer()).get('/docs').expect(404);
    await request(app.getHttpServer()).get('/docs-json').expect(404);
  });
});
