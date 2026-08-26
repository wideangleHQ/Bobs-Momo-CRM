import { HttpStatus, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { CronExpressionParser } from 'cron-parser';
import {
  TASK_ERRORS,
  type CreateRecurrenceDto,
  type CreateTemplateDto,
  type ListRecurrencesQuery,
  type ListTemplatesQuery,
  type UpdateRecurrenceDto,
  type UpdateTemplateDto,
} from '@bobs-momo/shared';
import { DomainError } from '../../common/errors/domain.error';
import { PrismaService } from '../../common/prisma/prisma.service';
import type { RequestScope } from '../../common/types/request';

const IST = 'Asia/Kolkata';
const NEXT_FIRE_PREVIEW = 3;

const TEMPLATE_INCLUDE = {
  items: { orderBy: { sortOrder: 'asc' } },
} satisfies Prisma.ChecklistTemplateInclude;

type TemplateRow = Prisma.ChecklistTemplateGetPayload<{ include: typeof TEMPLATE_INCLUDE }>;

function flag(v: 'true' | 'false' | undefined): boolean | undefined {
  return v === undefined ? undefined : v === 'true';
}

@Injectable()
export class TemplatesService {
  constructor(private readonly prisma: PrismaService) {}

  // ---- checklist templates -----------------------------------------------

  async listTemplates(query: ListTemplatesQuery) {
    const isAudit = flag(query.isAudit);
    const isActive = flag(query.isActive);
    const rows = await this.prisma.checklistTemplate.findMany({
      where: {
        ...(query.code ? { code: query.code.toUpperCase() } : {}),
        ...(isAudit === undefined ? {} : { isAudit }),
        ...(isActive === undefined ? {} : { isActive }),
        // A null outletId is the global template. Asking for one outlet has to
        // return the global ones too or KITCHEN_OPEN disappears from the list.
        ...(query.outletId ? { OR: [{ outletId: query.outletId }, { outletId: null }] } : {}),
      },
      include: TEMPLATE_INCLUDE,
      orderBy: { code: 'asc' },
    });
    return { data: rows.map(toTemplateView) };
  }

  async getTemplate(id: string) {
    const row = await this.prisma.checklistTemplate.findUnique({
      where: { id },
      include: TEMPLATE_INCLUDE,
    });
    if (!row) throw this.templateNotFound();
    return toTemplateView(row);
  }

  async createTemplate(dto: CreateTemplateDto) {
    const existing = await this.prisma.checklistTemplate.findUnique({ where: { code: dto.code } });
    if (existing) {
      throw DomainError.conflict(
        TASK_ERRORS.DUPLICATE_TEMPLATE_CODE,
        'That template code is already in use',
        { code: dto.code },
      );
    }
    const row = await this.prisma.checklistTemplate.create({
      data: {
        code: dto.code,
        name: dto.name,
        description: dto.description ?? null,
        isAudit: dto.isAudit,
        outletId: dto.outletId ?? null,
        items: { create: dto.items },
      },
      include: TEMPLATE_INCLUDE,
    });
    return toTemplateView(row);
  }

  /**
   * ponytail: an item the caller drops is deleted only when no run has recorded
   * a result against it, because TaskChecklistResult points at templateItemId
   * and deleting the row would orphan history. An item with history stays on
   * the template. The upgrade path is an `isActive` column on
   * ChecklistTemplateItem so a used item can be retired without vanishing.
   */
  async updateTemplate(id: string, dto: UpdateTemplateDto) {
    const template = await this.prisma.checklistTemplate.findUnique({
      where: { id },
      include: TEMPLATE_INCLUDE,
    });
    if (!template) throw this.templateNotFound();

    const row = await this.prisma.$transaction(async (tx) => {
      await tx.checklistTemplate.update({
        where: { id },
        data: {
          ...(dto.name === undefined ? {} : { name: dto.name }),
          ...(dto.description === undefined ? {} : { description: dto.description }),
          ...(dto.isActive === undefined ? {} : { isActive: dto.isActive }),
        },
      });

      if (dto.items) {
        const keep = new Set(dto.items.map((i) => i.sortOrder));
        const doomed = template.items.filter((i) => !keep.has(i.sortOrder));
        if (doomed.length > 0) {
          const used = await tx.taskChecklistResult.findMany({
            where: { templateItemId: { in: doomed.map((i) => i.id) } },
            select: { templateItemId: true },
            distinct: ['templateItemId'],
          });
          const usedIds = new Set(used.map((u) => u.templateItemId));
          const removable = doomed.filter((i) => !usedIds.has(i.id)).map((i) => i.id);
          if (removable.length > 0) {
            await tx.checklistTemplateItem.deleteMany({ where: { id: { in: removable } } });
          }
        }
        for (const item of dto.items) {
          await tx.checklistTemplateItem.upsert({
            where: { templateId_sortOrder: { templateId: id, sortOrder: item.sortOrder } },
            create: { templateId: id, ...item },
            update: {
              label: item.label,
              requiresPhoto: item.requiresPhoto,
              requiresNote: item.requiresNote,
              failCreatesTask: item.failCreatesTask,
            },
          });
        }
      }

      return tx.checklistTemplate.findUniqueOrThrow({
        where: { id },
        include: TEMPLATE_INCLUDE,
      });
    });

    return toTemplateView(row);
  }

  // ---- recurrences -------------------------------------------------------

  async listRecurrences(query: ListRecurrencesQuery, scope: RequestScope) {
    const isActive = flag(query.isActive);
    const rows = await this.prisma.taskRecurrence.findMany({
      where: {
        ...(isActive === undefined ? {} : { isActive }),
        // A null outletId fans out to every outlet, so it belongs on everyone's
        // screen.
        OR: [{ outletId: null }, { outletId: { in: query.outletId ? [query.outletId] : scope.outletIds } }],
      },
      include: { template: { select: { id: true, code: true, name: true, isAudit: true } } },
      orderBy: { name: 'asc' },
    });
    return { data: rows.map(toRecurrenceView) };
  }

  async createRecurrence(dto: CreateRecurrenceDto) {
    this.assertCron(dto.cronExpr);
    if (dto.templateId) await this.assertTemplateExists(dto.templateId);

    const row = await this.prisma.taskRecurrence.create({
      data: {
        name: dto.name,
        cronExpr: dto.cronExpr,
        templateId: dto.templateId ?? null,
        title: dto.title ?? null,
        outletId: dto.outletId ?? null,
        departmentId: dto.departmentId ?? null,
        assigneeId: dto.assigneeId ?? null,
        priority: dto.priority,
        dueAfterMins: dto.dueAfterMins,
      },
      include: { template: { select: { id: true, code: true, name: true, isAudit: true } } },
    });
    return toRecurrenceView(row);
  }

  async updateRecurrence(id: string, dto: UpdateRecurrenceDto) {
    const existing = await this.prisma.taskRecurrence.findUnique({ where: { id } });
    if (!existing) {
      throw new DomainError(
        HttpStatus.NOT_FOUND,
        TASK_ERRORS.RECURRENCE_NOT_FOUND,
        'That recurrence does not exist',
      );
    }
    if (dto.cronExpr) this.assertCron(dto.cronExpr);
    if (dto.templateId) await this.assertTemplateExists(dto.templateId);

    const row = await this.prisma.taskRecurrence.update({
      where: { id },
      data: {
        ...(dto.name === undefined ? {} : { name: dto.name }),
        ...(dto.cronExpr === undefined ? {} : { cronExpr: dto.cronExpr }),
        ...(dto.templateId === undefined ? {} : { templateId: dto.templateId }),
        ...(dto.title === undefined ? {} : { title: dto.title }),
        ...(dto.outletId === undefined ? {} : { outletId: dto.outletId }),
        ...(dto.departmentId === undefined ? {} : { departmentId: dto.departmentId }),
        ...(dto.assigneeId === undefined ? {} : { assigneeId: dto.assigneeId }),
        ...(dto.priority === undefined ? {} : { priority: dto.priority }),
        ...(dto.dueAfterMins === undefined ? {} : { dueAfterMins: dto.dueAfterMins }),
        // Retiring a checklist mid-week stops generation and leaves the
        // instances already on the board alone.
        ...(dto.isActive === undefined ? {} : { isActive: dto.isActive }),
      },
      include: { template: { select: { id: true, code: true, name: true, isAudit: true } } },
    });
    return toRecurrenceView(row);
  }

  private assertCron(expr: string): void {
    try {
      CronExpressionParser.parse(expr, { tz: IST });
    } catch {
      throw DomainError.badRequest(
        TASK_ERRORS.INVALID_CRON_EXPRESSION,
        'That cron expression does not parse',
        { cronExpr: expr },
      );
    }
  }

  private async assertTemplateExists(id: string): Promise<void> {
    const found = await this.prisma.checklistTemplate.findUnique({ where: { id } });
    if (!found) throw this.templateNotFound();
  }

  private templateNotFound(): DomainError {
    return new DomainError(
      HttpStatus.NOT_FOUND,
      TASK_ERRORS.TEMPLATE_NOT_FOUND,
      'That checklist template does not exist',
    );
  }
}

function toTemplateView(row: TemplateRow) {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    description: row.description,
    isAudit: row.isAudit,
    outletId: row.outletId,
    isActive: row.isActive,
    items: row.items.map((i) => ({
      id: i.id,
      sortOrder: i.sortOrder,
      label: i.label,
      requiresPhoto: i.requiresPhoto,
      requiresNote: i.requiresNote,
      failCreatesTask: i.failCreatesTask,
    })),
  };
}

type RecurrenceRow = Prisma.TaskRecurrenceGetPayload<{
  include: { template: { select: { id: true; code: true; name: true; isAudit: true } } };
}>;

function toRecurrenceView(row: RecurrenceRow) {
  return {
    id: row.id,
    name: row.name,
    cronExpr: row.cronExpr,
    templateId: row.templateId,
    template: row.template,
    title: row.title,
    outletId: row.outletId,
    departmentId: row.departmentId,
    assigneeId: row.assigneeId,
    priority: row.priority,
    dueAfterMins: row.dueAfterMins,
    isActive: row.isActive,
    lastRunAt: row.lastRunAt?.toISOString() ?? null,
    // Shown so an admin editing a cron expression sees what it will do before
    // saving. 07:00 IST reads back as 01:30 UTC, which is the check that
    // catches a timezone mistake at configuration time rather than in the
    // kitchen.
    nextFireTimes: nextFires(row.cronExpr, NEXT_FIRE_PREVIEW),
  };
}

function nextFires(expr: string, count: number): string[] {
  try {
    const iterator = CronExpressionParser.parse(expr, { tz: IST });
    return iterator.take(count).map((d) => d.toDate().toISOString());
  } catch {
    return [];
  }
}
