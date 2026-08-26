import { Controller, Get, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import {
  consumptionQuery,
  exportQuery,
  reportQuerySchema,
  salesReportQuery,
  wasteQuery,
  type ConsumptionQuery,
  type ExportQuery,
  type ReportQuery,
  type SalesReportQuery,
  type WasteQuery,
} from '@bobs-momo/shared';
import { CurrentUser, Scope } from '../../common/decorators/current-user.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import type { AuthedUser, RequestScope } from '../../common/types/request';
import { AnalyticsService, CONSUMPTION_TOP_N } from './analytics.service';

@Controller('analytics')
export class AnalyticsController {
  constructor(private readonly service: AnalyticsService) {}

  // No parameters at all. The variant comes from the caller's role and the
  // outlet set from the guard, so a staff member cannot request the owner view.
  @Get('dashboard')
  @Permissions('analytics.dashboard.read')
  dashboard(@CurrentUser() user: AuthedUser, @Scope() scope: RequestScope) {
    return this.service.dashboard(user, scope);
  }

  @Get('sales')
  @Permissions('analytics.sales.read')
  sales(
    @Query(new ZodValidationPipe(salesReportQuery)) query: SalesReportQuery,
    @Scope() scope: RequestScope,
  ) {
    return this.service.sales(query, scope);
  }

  @Get('consumption')
  @Permissions('analytics.consumption.read')
  consumption(
    @Query(new ZodValidationPipe(consumptionQuery)) query: ConsumptionQuery,
    @Scope() scope: RequestScope,
  ) {
    // The screen shows a top-N; the CSV export deliberately does not.
    return this.service.consumption(query, scope, CONSUMPTION_TOP_N);
  }

  @Get('waste')
  @Permissions('analytics.waste.read')
  waste(
    @Query(new ZodValidationPipe(wasteQuery)) query: WasteQuery,
    @Scope() scope: RequestScope,
  ) {
    return this.service.waste(query, scope);
  }

  @Get('performance')
  @Permissions('analytics.performance.read')
  performance(
    @Query(new ZodValidationPipe(reportQuerySchema)) query: ReportQuery,
    @Scope() scope: RequestScope,
  ) {
    return this.service.performance(query, scope);
  }

  // Named gross-margin rather than pnl because that is what it is. There is no
  // recipe, no bill of materials and no expense ledger, so a true P&L is not
  // possible in Phase 1 and the response says so on every call.
  @Get('gross-margin')
  @Permissions('analytics.pnl.read')
  grossMargin(
    @Query(new ZodValidationPipe(reportQuerySchema)) query: ReportQuery,
    @Scope() scope: RequestScope,
  ) {
    return this.service.grossMargin(query, scope);
  }

  @Get('export')
  @Permissions('analytics.export.create')
  async export(
    @Query(new ZodValidationPipe(exportQuery)) query: ExportQuery,
    @CurrentUser() user: AuthedUser,
    @Scope() scope: RequestScope,
    @Res() res: Response,
  ): Promise<void> {
    const { filename, csv } = await this.service.exportCsv(query, user, scope);
    res.setHeader('content-type', 'text/csv; charset=utf-8');
    res.setHeader('content-disposition', `attachment; filename="${filename}"`);
    res.send(csv);
  }
}
