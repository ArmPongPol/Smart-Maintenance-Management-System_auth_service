import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

// Serves Swagger UI at /<DOCS_PATH> and the raw spec at /<DOCS_PATH>-json
// when DOCS_ENABLED=true (see docs.config.ts).
export function setupSwagger(app: INestApplication): void {
  const config = app.get(ConfigService);
  if (!config.get<boolean>('docs.enable')) {
    return;
  }

  const document = SwaggerModule.createDocument(
    app,
    new DocumentBuilder()
      .setTitle(config.get<string>('docs.title', 'API'))
      .setDescription(config.get<string>('docs.description', ''))
      .addBearerAuth()
      .build(),
  );

  SwaggerModule.setup(config.get<string>('docs.path', 'docs'), app, document, {
    // Keep the token entered in "Authorize" across page reloads.
    swaggerOptions: { persistAuthorization: true },
  });
}
