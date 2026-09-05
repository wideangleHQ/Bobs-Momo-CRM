import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { assertSecretsDiffer, corsOrigins, env } from './config/env';

async function bootstrap(): Promise<void> {
  // Load .env before schema validation. Node ≥ 20.12 built-in; no-op in
  // production where vars are injected by the platform (missing file is ignored).
  try {
    (process as NodeJS.Process & { loadEnvFile?(p: string): void }).loadEnvFile?.('.env');
  } catch {
    // file absent in production — env vars must be injected externally
  }

  const cfg = env();
  assertSecretsDiffer();
  process.env.TZ = cfg.TZ;

  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    logger: cfg.NODE_ENV === 'production' ? ['log', 'warn', 'error'] : ['debug', 'log', 'warn', 'error'],
  });

  // One proxy hop, so req.ip is the client rather than Railway's load balancer.
  // Without this the public game rate limiter keys every visitor on the same
  // address and 20 requests a minute becomes one bucket for the whole internet.
  // Not `true`: that would trust a spoofed X-Forwarded-For end to end.
  app.set('trust proxy', 1);
  app.setGlobalPrefix(cfg.API_PREFIX);
  app.useGlobalFilters(new AllExceptionsFilter());
  app.enableCors({ origin: corsOrigins(), credentials: true });
  app.enableShutdownHooks();

  await app.listen(cfg.PORT);
  new Logger('bootstrap').log(`api listening on :${cfg.PORT}/${cfg.API_PREFIX}`);
}

void bootstrap();
