import { Module } from '@nestjs/common';
import { CrmController } from './crm.controller';
import { CrmService } from './crm.service';
import { GameService } from './game.service';
import { PublicCrmController } from './public-crm.controller';

@Module({
  controllers: [CrmController, PublicCrmController],
  providers: [CrmService, GameService],
})
export class CrmModule {}
