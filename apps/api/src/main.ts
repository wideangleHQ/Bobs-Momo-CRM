import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { assertSecretsDiffer, corsOrigins, env } from './config/env';

async function bootstrap(): Promise<void> {
  const cfg = env();
  assertSecretsDiffer();
  process.env.TZ = cfg.TZ;

  const app = await NestFactory.create(AppModule, {
    logger: cfg.NODE_ENV === 'production' ? ['log', 'warn', 'error'] : ['debug', 'log', 'warn', 'error'],
  });

  app.setGlobalPrefix(cfg.API_PREFIX);
  app.useGlobalFilters(new AllExceptionsFilter());
  app.enableCors({ origin: corsOrigins(), credentials: true });
  app.enableShutdownHooks();

  await app.listen(cfg.PORT);
  new Logger('bootstrap').log(`api listening on :${cfg.PORT}/${cfg.API_PREFIX}`);
}

void bootstrap();
