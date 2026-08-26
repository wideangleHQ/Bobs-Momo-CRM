import { Module } from '@nestjs/common';
import { InventoryModule } from '../inventory/inventory.module';
import { PurchaseController } from './purchase.controller';
import { PurchaseRequestService } from './purchase-request.service';
import { PurchaseService } from './purchase.service';

@Module({
  imports: [InventoryModule],
  controllers: [PurchaseController],
  providers: [PurchaseService, PurchaseRequestService],
})
export class PurchaseModule {}
