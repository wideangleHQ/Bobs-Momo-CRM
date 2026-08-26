import { Module } from '@nestjs/common';
import { MessagingController } from './messaging.controller';
import { MessagingService } from './messaging.service';

@Module({
  controllers: [MessagingController],
  providers: [MessagingService],
  // The outbox dispatcher calls resolveRecipients() to expand a BROADCAST
  // event into notification rows.
  exports: [MessagingService],
})
export class MessagingModule {}
