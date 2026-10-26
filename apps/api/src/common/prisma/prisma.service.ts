import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import { env } from '../../config/env';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  constructor() {
    super({ log: [{ emit: 'event', level: 'query' }] });
    const slowMs = env().SLOW_QUERY_MS;
    // The SQL carries $n placeholders only. Parameters are never logged: they
    // hold password hashes, token hashes and personal data.
    (this as unknown as PrismaClient<Prisma.PrismaClientOptions, 'query'>).$on('query', (e) => {
      if (e.duration >= slowMs) this.logger.warn(`slow query ${e.duration}ms ${e.query.slice(0, 400)}`);
    });
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
    this.logger.log('database connected');
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }

  async ping(): Promise<boolean> {
    try {
      await this.$queryRaw`SELECT 1`;
      return true;
    } catch {
      return false;
    }
  }
}
