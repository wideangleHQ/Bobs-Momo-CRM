import { Global, Module } from '@nestjs/common';
import { OutletCacheService } from './outlet-cache.service';

@Global()
@Module({ providers: [OutletCacheService], exports: [OutletCacheService] })
export class OutletCacheModule {}
