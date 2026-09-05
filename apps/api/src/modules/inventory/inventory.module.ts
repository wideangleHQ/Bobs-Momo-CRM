import { Module } from '@nestjs/common';
import { AdminModule } from '../admin/admin.module';
import { InventoryController } from './inventory.controller';
import { InventoryRepository } from './inventory.repository';
import { InventoryService } from './inventory.service';

@Module({
  imports: [AdminModule],
  controllers: [InventoryController],
  providers: [InventoryService, InventoryRepository],
  // Purchase records stock receipts through this service, never through its
  // repository, so the lock and the low stock check cannot be bypassed.
  exports: [InventoryService],
})
export class InventoryModule {}
