import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import {
  createRewardSchema,
  issueRewardSchema,
  listCustomersQuery,
  publishGameSchema,
  redeemCouponSchema,
  updateRewardSchema,
  upsertGameConfigSchema,
  type CreateRewardDto,
  type IssueRewardDto,
  type ListCustomersQuery,
  type PublishGameDto,
  type RedeemCouponDto,
  type UpdateRewardDto,
  type UpsertGameConfigDto,
} from '@bobs-momo/shared';
import { CurrentUser, Scope } from '../../common/decorators/current-user.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import type { AuthedUser, RequestScope } from '../../common/types/request';
import { CrmService } from './crm.service';
import { GameService } from './game.service';

@Controller('crm')
export class CrmController {
  constructor(
    private readonly crm: CrmService,
    private readonly games: GameService,
  ) {}

  @Get('customers')
  @Permissions('crm.customer.read')
  listCustomers(
    @Query(new ZodValidationPipe(listCustomersQuery)) query: ListCustomersQuery,
    @Scope() scope: RequestScope,
  ) {
    return this.crm.listCustomers(query, scope);
  }

  @Get('customers/:id')
  @Permissions('crm.customer.read')
  getCustomer(@Param('id', ParseUUIDPipe) id: string, @Scope() scope: RequestScope) {
    return this.crm.getCustomer(id, scope);
  }

  @Get('game-config')
  @Permissions('crm.game.configure')
  listGameConfigs() {
    return this.games.listConfigs();
  }

  @Put('game-config')
  @Permissions('crm.game.configure')
  upsertGameConfig(
    @Body(new ZodValidationPipe(upsertGameConfigSchema)) dto: UpsertGameConfigDto,
    @CurrentUser() user: AuthedUser,
  ) {
    return this.games.upsertConfig(dto, user);
  }

  // Publish is the only thing that changes what the website serves.
  @Post('game-config/publish')
  @Permissions('crm.game.publish')
  @HttpCode(HttpStatus.OK)
  publishGame(
    @Body(new ZodValidationPipe(publishGameSchema)) dto: PublishGameDto,
    @CurrentUser() user: AuthedUser,
  ) {
    return this.games.publish(dto.slug, user);
  }

  @Get('rewards')
  @Permissions('crm.reward.define')
  listRewards() {
    return this.crm.listRewards();
  }

  @Post('rewards')
  @Permissions('crm.reward.define')
  @HttpCode(HttpStatus.CREATED)
  createReward(@Body(new ZodValidationPipe(createRewardSchema)) dto: CreateRewardDto) {
    return this.crm.createReward(dto);
  }

  @Patch('rewards/:id')
  @Permissions('crm.reward.define')
  updateReward(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(updateRewardSchema)) dto: UpdateRewardDto,
  ) {
    return this.crm.updateReward(id, dto);
  }

  @Post('rewards/issue')
  @Permissions('crm.reward.issue')
  @HttpCode(HttpStatus.CREATED)
  issueReward(
    @Body(new ZodValidationPipe(issueRewardSchema)) dto: IssueRewardDto,
    @CurrentUser() user: AuthedUser,
  ) {
    return this.crm.issueReward(dto, user);
  }

  @Post('rewards/:id/redeem')
  @Permissions('crm.reward.redeem')
  @HttpCode(HttpStatus.OK)
  redeemCoupon(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(redeemCouponSchema)) dto: RedeemCouponDto,
    @CurrentUser() user: AuthedUser,
    @Scope() scope: RequestScope,
  ) {
    return this.crm.redeemCoupon(id, dto, user, scope);
  }

  @Get('analytics')
  @Permissions('crm.analytics.read')
  analytics() {
    return this.crm.analytics();
  }
}
