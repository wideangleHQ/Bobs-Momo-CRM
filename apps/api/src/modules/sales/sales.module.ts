import { Module } from '@nestjs/common';
import { SalesController } from './sales.controller';
import { SalesService } from './sales.service';

@Module({
  controllers: [SalesController],
  providers: [SalesService],
  // The 23:30 IST missing entry job reads findMissingEntries through this.
  exports: [SalesService],
})
export class SalesModule {}
