import { HttpStatus, Injectable } from '@nestjs/common';
import { Prisma, type TaskStatus } from '@prisma/client';
import { CronExpressionParser } from 'cron-parser';
import {
  AUDIT_FOLLOW_UP_HOURS,
  ERROR_CODES,
  TASK_ATTACHMENT_MAX_BYTES,
  TASK_ERRORS,
  TASK_PHOTO_MIME_TYPES,
  paginate,
  toBusinessDate,
  toBusinessDateUtc,
  type CancelTaskDto,
  type CompleteTaskDto,
  type CreateAttachmentDto,
  type CreateCommentDto,
  type CreateTaskDto,
  type ListTasksQuery,
  type MyTasksQuery,
  type SubmitChecklistDto,
  type UpdateTaskDto,
  type VerifyTaskDto,
} from '@bobs-momo/shared';
import { DomainError } from '../../common/errors/domain.error';
import { PrismaService } from '../../common/prisma/prisma.service';
import type { AuthedUser, RequestScope } from '../../common/types/request';

const IST = 'Asia/Kolkata';

/** Employment states that may still be handed work. */
const ASSIGNABLE = ['ACTIVE', 'ON_NOTICE'] as const;

// OVERDUE appears on the left of three rows on purpose. A task that went late
// is still work, so the sweep flagging it does not close any door.
const ALLOWED_FROM: Record<string, TaskStatus[]> = {
  IN_PROGRESS: ['OPEN', 'OVERDUE'],
  COMPLETED: ['OPEN', 'IN_PROGRESS', 'OVERDUE'],
  VERIFIED: ['COMPLETED'],
  CANCELLED: ['OPEN', 'IN_PROGRESS', 'OVERDUE'],
};

const EDIT_BLOCKED: TaskStatus[] = ['COMPLETED', 'VERIFIED', 'CANCELLED'];

// A resubmit of the same checklist has to land on the same rows rather than a
// 409, so COMPLETED is in the list. VERIFIED and CANCELLED are not: a manager
// has already signed the first one off.
const CHECKLIST_SUBMITTABLE: TaskStatus[] = ['OPEN', 'IN_PROGRESS', 'OVERDUE', 'COMPLETED'];

const EXT_BY_MIME: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

/** A generator run never replays more than a day of missed fire times. */
const CATCH_UP_HOURS = 24;
const MAX_FIRES_PER_RUN = 96;

const TASK_LIST_INCLUDE = {
  outlet: { select: { code: true } },
  assignee: { select: { id: true, fullName: true } },
  template: { select: { id: true, code: true, name: true, isAudit: true } },
  _count: { select: { results: true } },
} satisfies Prisma.TaskInclude;

const TASK_DETAIL_INCLUDE = {
  outlet: { select: { code: true } },
  assignee: { select: { id: true, fullName: true } },
  creator: { select: { id: true, fullName: true } },
  template: {
    select: {
      id: true,
      code: true,
      name: true,
      isAudit: true,
      items: { orderBy: { sortOrder: 'asc' } },
    },
  },
  results: true,
  comments: { orderBy: { createdAt: 'asc' } },
  attachments: { orderBy: { createdAt: 'asc' } },
} satisfies Prisma.TaskInclude;

type TaskListRow = Prisma.TaskGetPayload<{ include: typeof TASK_LIST_INCLUDE }>;
type TaskDetailRow = Prisma.TaskGetPayload<{ include: typeof TASK_DETAIL_INCLUDE }>;

export interface SweepSummary {
  flagged: number;
  taskIds: string[];
}

export interface GenerateSummary {
  recurrences: number;
  created: number;
  skipped: number;
}

@Injectable()
export class TasksService {
  constructor(private readonly prisma: PrismaService) {}

  // ---- reads -------------------------------------------------------------

  async list(query: ListTasksQuery, scope: RequestScope) {
    const where = this.buildWhere(query, scope);
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.task.findMany({
        where,
        include: TASK_LIST_INCLUDE,
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        orderBy: [{ priority: 'desc' }, { dueAt: { sort: 'asc', nulls: 'last' } }],
      }),
      this.prisma.task.count({ where }),
    ]);
    return paginate(rows.map(toListView), total, query);
  }

  async board(query: ListTasksQuery, scope: RequestScope) {
    const where = this.buildWhere(query, scope);
    const rows = await this.prisma.task.findMany({
      where,
      include: TASK_LIST_INCLUDE,
      orderBy: [{ priority: 'desc' }, { dueAt: { sort: 'asc', nulls: 'last' } }],
      take: 500,
    });

    const columns: Record<string, { count: number; tasks: ReturnType<typeof toListView>[] }> = {};
    for (const status of ['OPEN', 'IN_PROGRESS', 'OVERDUE', 'COMPLETED', 'VERIFIED', 'CANCELLED']) {
      columns[status] = { count: 0, tasks: [] };
    }
    for (const row of rows) {
      const column = columns[row.status];
      if (!column) continue;
      column.count += 1;
      column.tasks.push(toListView(row));
    }
    return { columns };
  }

  /**
   * Unassigned outlet tasks are in here alongside the caller's own. That is how
   * a kitchen opening checklist with no named owner reaches whoever opens the
   * kitchen.
   */
  async my(query: MyTasksQuery, user: AuthedUser, scope: RequestScope) {
    // The owner has a login and no employee record, which is a real account
    // shape rather than a mistake. Tasks assigned to them is genuinely the
    // empty set, and a 403 on "my tasks" reads as a broken app.
    if (!user.employeeId) return { overdue: [], today: [], upcoming: [] };
    const employeeId = user.employeeId;
    const employee = await this.prisma.employee.findUnique({
      where: { id: employeeId },
      select: { outletId: true, departmentId: true },
    });
    if (!employee) throw DomainError.notFound('That employee record does not exist');

    const statuses: TaskStatus[] = query.includeCompleted
      ? ['OPEN', 'IN_PROGRESS', 'OVERDUE', 'COMPLETED', 'VERIFIED']
      : ['OPEN', 'IN_PROGRESS', 'OVERDUE'];

    const rows = await this.prisma.task.findMany({
      where: {
        outletId: { in: scope.outletIds },
        status: { in: statuses },
        OR: [
          { assigneeId: employeeId },
          {
            assigneeId: null,
            outletId: employee.outletId,
            ...(employee.departmentId
              ? { OR: [{ departmentId: employee.departmentId }, { departmentId: null }] }
              : {}),
          },
        ],
      },
      include: TASK_LIST_INCLUDE,
      orderBy: [{ priority: 'desc' }, { dueAt: { sort: 'asc', nulls: 'last' } }],
      take: 200,
    });

    const today = toBusinessDate();
    const groups: Record<'overdue' | 'today' | 'upcoming', ReturnType<typeof toListView>[]> = {
      overdue: [],
      today: [],
      upcoming: [],
    };
    const now = Date.now();
    for (const row of rows) {
      const view = toListView(row);
      if (row.status === 'OVERDUE' || (row.dueAt !== null && row.dueAt.getTime() < now)) {
        groups.overdue.push(view);
      } else if (view.businessDate <= today) {
        groups.today.push(view);
      } else {
        groups.upcoming.push(view);
      }
    }
    return groups;
  }

  async getOne(id: string, scope: RequestScope) {
    const task = await this.prisma.task.findUnique({ where: { id }, include: TASK_DETAIL_INCLUDE });
    if (!task || !scope.outletIds.includes(task.outletId)) throw this.notFound();

    const parent = task.parentTaskId
      ? await this.prisma.task.findUnique({
          where: { id: task.parentTaskId },
          select: { id: true, title: true, status: true },
        })
      : null;
    const children = await this.prisma.task.findMany({
      where: { parentTaskId: id },
      select: { id: true, title: true, status: true, priority: true, dueAt: true },
      orderBy: { createdAt: 'asc' },
    });

    return {
      ...toDetailView(task),
      parentTask: parent,
      followUpTasks: children.map((c) => ({
        id: c.id,
        title: c.title,
        status: c.status,
        priority: c.priority,
        dueAt: c.dueAt?.toISOString() ?? null,
      })),
    };
  }

  // ---- writes ------------------------------------------------------------

  async create(dto: CreateTaskDto, user: AuthedUser, scope: RequestScope) {
    if (!scope.outletIds.includes(dto.outletId)) throw DomainError.notFound();
    const createdById = this.actorEmployeeId(user);

    const template = dto.templateId ? await this.loadTemplate(dto.templateId) : null;
    if (template && template.outletId !== null && template.outletId !== dto.outletId) {
      throw this.unprocessable(
        TASK_ERRORS.TEMPLATE_MISMATCH,
        'That template belongs to another outlet',
      );
    }

    const dueAt = dto.dueAt ? new Date(dto.dueAt) : null;
    if (dueAt && dueAt.getTime() < Date.now()) {
      throw DomainError.badRequest(ERROR_CODES.COMMON_VALIDATION_FAILED, 'That due time has passed');
    }

    const assignee = await this.resolveAssignee(dto.assigneeId ?? null, dto.outletId);

    const created = await this.prisma.$transaction(async (tx) => {
      const task = await tx.task.create({
        data: {
          // Never taken from the caller. A template decides whether this is a
          // checklist or an audit, and an audit is the one kind that defaults
          // to needing a sign-off.
          kind: template ? (template.isAudit ? 'AUDIT_RUN' : 'CHECKLIST_RUN') : 'ONE_OFF',
          title: dto.title,
          description: dto.description ?? null,
          outletId: dto.outletId,
          departmentId: dto.departmentId ?? null,
          assigneeId: assignee?.id ?? null,
          createdById,
          templateId: template?.id ?? null,
          priority: dto.priority,
          dueAt,
          requiresVerification: template?.isAudit === true ? true : dto.requiresVerification,
          businessDate: toBusinessDateUtc(),
        },
        include: TASK_DETAIL_INCLUDE,
      });
      if (assignee) await this.emitAssigned(tx, task.id, task.title, dto.outletId, assignee);
      return task;
    });

    return toDetailView(created);
  }

  async update(id: string, dto: UpdateTaskDto, scope: RequestScope) {
    if (dto.status !== undefined) {
      throw this.unprocessable(
        TASK_ERRORS.TASK_INVALID_TRANSITION,
        'Status moves through /start, /complete, /verify or /cancel, never PATCH',
        { attempted: dto.status },
      );
    }
    const task = await this.load(id, scope);
    if (EDIT_BLOCKED.includes(task.status)) {
      throw DomainError.conflict(
        TASK_ERRORS.TASK_INVALID_TRANSITION,
        `A ${task.status.toLowerCase()} task cannot be edited`,
        { currentStatus: task.status },
      );
    }

    const dueAt = dto.dueAt === undefined ? undefined : dto.dueAt ? new Date(dto.dueAt) : null;
    const reassigning = dto.assigneeId !== undefined && dto.assigneeId !== task.assigneeId;
    const assignee = reassigning
      ? await this.resolveAssignee(dto.assigneeId ?? null, task.outletId)
      : null;

    const updated = await this.prisma.$transaction(async (tx) => {
      const row = await tx.task.update({
        where: { id },
        data: {
          ...(dto.title === undefined ? {} : { title: dto.title }),
          ...(dto.description === undefined ? {} : { description: dto.description }),
          ...(dto.departmentId === undefined ? {} : { departmentId: dto.departmentId }),
          ...(dto.priority === undefined ? {} : { priority: dto.priority }),
          ...(dueAt === undefined ? {} : { dueAt }),
          ...(dto.requiresVerification === undefined
            ? {}
            : { requiresVerification: dto.requiresVerification }),
          ...(reassigning ? { assigneeId: assignee?.id ?? null } : {}),
        },
        include: TASK_DETAIL_INCLUDE,
      });
      // The new person has no idea the task exists until this goes out.
      if (assignee) await this.emitAssigned(tx, row.id, row.title, row.outletId, assignee);
      return row;
    });

    return toDetailView(updated);
  }

  async start(id: string, scope: RequestScope) {
    const task = await this.load(id, scope);
    this.assertMayAct(task, scope);
    this.assertTransition(task.status, 'IN_PROGRESS');
    const row = await this.prisma.task.update({
      where: { id },
      data: { status: 'IN_PROGRESS', startedAt: task.startedAt ?? new Date() },
      include: TASK_DETAIL_INCLUDE,
    });
    return toDetailView(row);
  }

  async complete(id: string, dto: CompleteTaskDto, user: AuthedUser, scope: RequestScope) {
    const task = await this.load(id, scope);
    this.assertMayAct(task, scope);
    this.assertTransition(task.status, 'COMPLETED');

    if (task.templateId !== null) {
      const submitted = await this.prisma.taskChecklistResult.count({ where: { taskId: id } });
      if (submitted === 0) {
        throw this.unprocessable(
          TASK_ERRORS.CHECKLIST_INCOMPLETE,
          'Submit the checklist at POST /tasks/:id/checklist instead',
        );
      }
    }

    const authorId = user.employeeId ?? user.sub;
    const row = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.task.update({
        where: { id },
        data: { status: 'COMPLETED', completedAt: new Date() },
        include: TASK_DETAIL_INCLUDE,
      });
      // The completion note and the conversation belong in one list, so a
      // manager reading the thread does not have to look in two places.
      if (dto.note) {
        await tx.taskComment.create({ data: { taskId: id, authorId, body: dto.note } });
      }
      return updated;
    });
    return toDetailView(row);
  }

  async verify(id: string, dto: VerifyTaskDto, user: AuthedUser, scope: RequestScope) {
    const task = await this.load(id, scope);
    this.assertTransition(task.status, 'VERIFIED');
    if (!task.requiresVerification) {
      throw this.unprocessable(
        TASK_ERRORS.VERIFICATION_NOT_REQUIRED,
        'That task does not need a sign-off',
      );
    }
    const actorId = user.employeeId ?? user.sub;
    // Signing off your own work is not verification, it is a second tap.
    if (task.assigneeId !== null && task.assigneeId === user.employeeId) {
      throw DomainError.forbidden('You cannot verify a task you were assigned');
    }

    const row = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.task.update({
        where: { id },
        data: { status: 'VERIFIED', verifiedAt: new Date(), verifiedById: actorId },
        include: TASK_DETAIL_INCLUDE,
      });
      if (dto.note) {
        await tx.taskComment.create({ data: { taskId: id, authorId: actorId, body: dto.note } });
      }
      return updated;
    });
    return toDetailView(row);
  }

  /**
   * Cancellation is the one status that removes a task from somebody's
   * completion rate, so the reason is mandatory and lands in both the comment
   * thread and the audit log.
   */
  async cancel(id: string, dto: CancelTaskDto, user: AuthedUser, scope: RequestScope) {
    const task = await this.load(id, scope);
    this.assertTransition(task.status, 'CANCELLED');
    const actorId = user.employeeId ?? user.sub;

    const row = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.task.update({
        where: { id },
        data: { status: 'CANCELLED' },
        include: TASK_DETAIL_INCLUDE,
      });
      await tx.taskComment.create({ data: { taskId: id, authorId: actorId, body: dto.reason } });
      await tx.auditLog.create({
        data: {
          actorId: user.sub,
          actorLabel: user.roleKey,
          action: 'task.task.cancel',
          entityType: 'Task',
          entityId: id,
          outletId: task.outletId,
          before: { status: task.status },
          after: { status: 'CANCELLED', reason: dto.reason },
        },
      });
      return updated;
    });
    return toDetailView(row);
  }

  // ---- comments and attachments ------------------------------------------

  async addComment(id: string, dto: CreateCommentDto, user: AuthedUser, scope: RequestScope) {
    await this.load(id, scope);
    const row = await this.prisma.taskComment.create({
      data: { taskId: id, authorId: user.employeeId ?? user.sub, body: dto.body },
    });
    return toCommentView(row);
  }

  async listComments(id: string, scope: RequestScope) {
    await this.load(id, scope);
    const rows = await this.prisma.taskComment.findMany({
      where: { taskId: id },
      orderBy: { createdAt: 'asc' },
    });
    return { data: rows.map(toCommentView) };
  }

  /**
   * ponytail: metadata only. Supabase Storage is not wired up in this
   * environment, so no signed upload URL is minted and no bytes move. The
   * upgrade path is a StorageService that calls createSignedUploadUrl(key, 300)
   * here and createSignedUrl(key, 300) in getOne; the row and the storage key
   * convention are already what that service needs.
   */
  async addAttachment(id: string, dto: CreateAttachmentDto, user: AuthedUser, scope: RequestScope) {
    const task = await this.prisma.task.findUnique({
      where: { id },
      include: { outlet: { select: { code: true } } },
    });
    if (!task || !scope.outletIds.includes(task.outletId)) throw this.notFound();
    if (EDIT_BLOCKED.includes(task.status)) {
      throw DomainError.conflict(
        TASK_ERRORS.TASK_INVALID_TRANSITION,
        `A ${task.status.toLowerCase()} task takes no more photos`,
      );
    }
    this.assertMayAct(task, scope);

    const ext = EXT_BY_MIME[dto.mimeType];
    if (!ext) {
      throw this.unprocessable(
        TASK_ERRORS.UNSUPPORTED_MIME_TYPE,
        `Photos must be one of ${TASK_PHOTO_MIME_TYPES.join(', ')}`,
      );
    }
    if (dto.sizeBytes > TASK_ATTACHMENT_MAX_BYTES) {
      throw this.unprocessable(TASK_ERRORS.ATTACHMENT_TOO_LARGE, 'Photos are limited to 5 MB', {
        maxBytes: TASK_ATTACHMENT_MAX_BYTES,
      });
    }

    const attachmentId = crypto.randomUUID();
    const businessDate = task.businessDate.toISOString().slice(0, 10);
    // Outlet, then date, then task: every prefix of this key is a useful
    // listing, and no caller-supplied string appears anywhere in the path.
    const storageKey =
      dto.storageKey ??
      `task-proof/${task.outlet.code}/${businessDate}/${task.id}/${attachmentId}.${ext}`;

    const row = await this.prisma.taskAttachment.create({
      data: {
        id: attachmentId,
        taskId: id,
        storageKey,
        mimeType: dto.mimeType,
        sizeBytes: dto.sizeBytes,
        uploadedById: user.employeeId ?? user.sub,
      },
    });
    return {
      attachmentId: row.id,
      taskId: row.taskId,
      storageKey: row.storageKey,
      mimeType: row.mimeType,
      sizeBytes: row.sizeBytes,
      createdAt: row.createdAt.toISOString(),
    };
  }

  // ---- checklist submission ----------------------------------------------

  async submitChecklist(
    id: string,
    dto: SubmitChecklistDto,
    user: AuthedUser,
    scope: RequestScope,
  ) {
    const task = await this.prisma.task.findUnique({
      where: { id },
      include: { template: { include: { items: { orderBy: { sortOrder: 'asc' } } } } },
    });
    if (!task || !scope.outletIds.includes(task.outletId)) throw this.notFound();
    this.assertMayAct(task, scope);
    if (!CHECKLIST_SUBMITTABLE.includes(task.status)) {
      throw DomainError.conflict(
        TASK_ERRORS.TASK_INVALID_TRANSITION,
        `A ${task.status.toLowerCase()} task takes no checklist`,
        { currentStatus: task.status },
      );
    }
    if (!task.template) {
      throw this.unprocessable(TASK_ERRORS.TEMPLATE_MISMATCH, 'That task has no checklist template');
    }

    const items = task.template.items;
    const byId = new Map(items.map((i) => [i.id, i]));

    const stray = dto.results.filter((r) => !byId.has(r.templateItemId));
    if (stray.length > 0) {
      throw this.unprocessable(
        TASK_ERRORS.TEMPLATE_MISMATCH,
        'Some results are for items on another template',
        { templateItemIds: stray.map((r) => r.templateItemId) },
      );
    }

    const answered = new Set(dto.results.map((r) => r.templateItemId));
    const missing = items.filter((i) => !answered.has(i.id));
    if (missing.length > 0) {
      throw this.unprocessable(TASK_ERRORS.CHECKLIST_INCOMPLETE, 'Some items have no answer', {
        missing: missing.map((i) => ({ templateItemId: i.id, label: i.label })),
      });
    }

    const attachmentIds = new Set(
      (
        await this.prisma.taskAttachment.findMany({
          where: { taskId: id },
          select: { id: true },
        })
      ).map((a) => a.id),
    );

    // NA skips both. "The fryer was not used today" is a real answer, and
    // demanding a photo of an unused fryer teaches staff to photograph anything.
    for (const result of dto.results) {
      const item = byId.get(result.templateItemId);
      if (!item || result.result === 'NA') continue;
      if (item.requiresPhoto && !(result.attachmentId && attachmentIds.has(result.attachmentId))) {
        throw this.unprocessable(TASK_ERRORS.PHOTO_REQUIRED, `${item.label} needs a photo`, {
          templateItemId: item.id,
        });
      }
      if (item.requiresNote && !result.note?.trim()) {
        throw this.unprocessable(TASK_ERRORS.NOTE_REQUIRED, `${item.label} needs a note`, {
          templateItemId: item.id,
        });
      }
    }

    const storeManagerId = await this.storeManagerOf(task.outletId);
    const createdById = user.employeeId ?? task.createdById;
    const now = new Date();

    // One transaction covers the results, the follow-ups and the parent status.
    // A failure recorded with no follow-up is worse than not looking, because
    // the audit trail then says somebody did.
    const outcome = await this.prisma.$transaction(async (tx) => {
      for (const result of dto.results) {
        await tx.taskChecklistResult.upsert({
          where: { taskId_templateItemId: { taskId: id, templateItemId: result.templateItemId } },
          create: {
            taskId: id,
            templateItemId: result.templateItemId,
            result: result.result,
            note: result.note ?? null,
            attachmentId: result.attachmentId ?? null,
          },
          update: {
            result: result.result,
            note: result.note ?? null,
            attachmentId: result.attachmentId ?? null,
            recordedAt: now,
          },
        });
      }

      const followUps: { id: string; title: string; priority: string; dueAt: string }[] = [];
      for (const result of dto.results) {
        const item = byId.get(result.templateItemId);
        if (!item || result.result !== 'FAIL' || !item.failCreatesTask) continue;

        const title = `Fix: ${item.label}`.slice(0, 120);
        // The result upsert is idempotent, a child insert is not. Without this
        // check a double-tapped submit leaves two "Fix: chimney filter" tasks.
        const existing = await tx.task.findFirst({ where: { parentTaskId: id, title } });
        if (existing) {
          followUps.push({
            id: existing.id,
            title: existing.title,
            priority: existing.priority,
            dueAt: existing.dueAt?.toISOString() ?? '',
          });
          continue;
        }

        const child = await tx.task.create({
          data: {
            kind: 'ONE_OFF',
            title,
            description: result.note ?? null,
            outletId: task.outletId,
            departmentId: task.departmentId,
            // HIGH, not URGENT. A priority level that fires automatically stops
            // meaning anything inside a week.
            priority: 'HIGH',
            assigneeId: storeManagerId,
            createdById,
            parentTaskId: id,
            dueAt: new Date(now.getTime() + AUDIT_FOLLOW_UP_HOURS * 60 * 60 * 1000),
            requiresVerification: true,
            businessDate: task.businessDate,
          },
        });
        await tx.outboxEvent.create({
          data: {
            eventKey: 'AUDIT_ITEM_FAILED',
            aggregateType: 'Task',
            aggregateId: child.id,
            payload: {
              auditTaskId: id,
              outletId: task.outletId,
              templateItemId: item.id,
              label: item.label,
              note: result.note ?? null,
              followUpTaskId: child.id,
              dueAt: child.dueAt?.toISOString() ?? null,
              assigneeId: storeManagerId,
            },
          },
        });
        followUps.push({
          id: child.id,
          title: child.title,
          priority: child.priority,
          dueAt: child.dueAt?.toISOString() ?? '',
        });
      }

      const parent = await tx.task.update({
        where: { id },
        data: { status: 'COMPLETED', completedAt: task.completedAt ?? now },
      });
      const results = await tx.taskChecklistResult.findMany({
        where: { taskId: id },
        orderBy: { recordedAt: 'asc' },
      });
      return { parent, results, followUps };
    });

    return {
      task: {
        id: outcome.parent.id,
        status: outcome.parent.status,
        completedAt: outcome.parent.completedAt?.toISOString() ?? null,
      },
      results: outcome.results.map((r) => ({
        templateItemId: r.templateItemId,
        result: r.result,
        note: r.note,
        attachmentId: r.attachmentId,
      })),
      followUpTasks: outcome.followUps,
    };
  }

  // ---- job entry points --------------------------------------------------

  /**
   * The whole sweep is one UPDATE ... RETURNING so a concurrent run cannot
   * select the same row. `overdueNotifiedAt IS NULL` is what keeps one late
   * task from becoming a WhatsApp message every ten minutes all weekend.
   */
  async sweepOverdue(now: Date): Promise<SweepSummary> {
    return this.prisma.$transaction(async (tx) => {
      const swept = await tx.$queryRaw<
        {
          id: string;
          outletId: string;
          assigneeId: string | null;
          createdById: string;
          title: string;
          dueAt: Date | null;
        }[]
      >`
        UPDATE "Task"
           SET status = 'OVERDUE'::"TaskStatus",
               "overdueNotifiedAt" = ${now}
         WHERE status IN ('OPEN', 'IN_PROGRESS')
           AND "dueAt" < ${now}
           AND "overdueNotifiedAt" IS NULL
        RETURNING id, "outletId", "assigneeId", "createdById", title, "dueAt"`;

      if (swept.length > 0) {
        await tx.outboxEvent.createMany({
          data: swept.map((t) => ({
            eventKey: 'TASK_OVERDUE',
            aggregateType: 'Task',
            aggregateId: t.id,
            payload: {
              taskId: t.id,
              outletId: t.outletId,
              assigneeId: t.assigneeId,
              createdById: t.createdById,
              title: t.title,
              dueAt: t.dueAt?.toISOString() ?? null,
            },
          })),
        });
      }
      return { flagged: swept.length, taskIds: swept.map((t) => t.id) };
    });
  }

  /**
   * ponytail: duplicate generation is blocked by a read-then-write check rather
   * than the partial unique index the chapter specifies, because that index
   * needs a migration this lane does not own. Two overlapping runs can still
   * race. Upgrade path: add
   * `CREATE UNIQUE INDEX task_recurrence_day_uniq ON "Task" ("recurrenceId",
   * "outletId", "businessDate") WHERE "recurrenceId" IS NOT NULL;` and swallow
   * the P2002 here instead.
   */
  async generateRecurringInstances(now: Date): Promise<GenerateSummary> {
    const recurrences = await this.prisma.taskRecurrence.findMany({
      where: { isActive: true },
      include: { template: true },
    });
    const activeOutlets = await this.prisma.outlet.findMany({
      where: { isActive: true },
      select: { id: true },
    });

    const summary: GenerateSummary = { recurrences: recurrences.length, created: 0, skipped: 0 };

    for (const rec of recurrences) {
      const floor = new Date(now.getTime() - CATCH_UP_HOURS * 60 * 60 * 1000);
      const since =
        rec.lastRunAt && rec.lastRunAt.getTime() > floor.getTime() ? rec.lastRunAt : floor;
      const fireTimes = cronFireTimesBetween(rec.cronExpr, since, now);

      const outlets = rec.outletId
        ? activeOutlets.filter((o) => o.id === rec.outletId)
        : activeOutlets;

      for (const fireAt of fireTimes) {
        const businessDate = toBusinessDateUtc(fireAt);
        for (const outlet of outlets) {
          const made = await this.createInstance(rec, outlet.id, fireAt, businessDate);
          if (made) summary.created += 1;
          else summary.skipped += 1;
        }
      }
      await this.prisma.taskRecurrence.update({ where: { id: rec.id }, data: { lastRunAt: now } });
    }
    return summary;
  }

  private async createInstance(
    rec: Prisma.TaskRecurrenceGetPayload<{ include: { template: true } }>,
    outletId: string,
    fireAt: Date,
    businessDate: Date,
  ): Promise<boolean> {
    const existing = await this.prisma.task.findFirst({
      where: { recurrenceId: rec.id, outletId, businessDate },
      select: { id: true },
    });
    if (existing) return false;

    const assignee = rec.assigneeId
      ? await this.prisma.employee.findFirst({
          where: { id: rec.assigneeId, outletId, status: { in: [...ASSIGNABLE] } },
          select: { id: true, userId: true },
        })
      : null;

    // Task.createdById is a required foreign key to Employee and a job has no
    // caller, so the outlet's store manager stands in. An outlet with nobody
    // to stand in for it is skipped rather than crashing the run.
    const createdById =
      (await this.storeManagerOf(outletId)) ??
      assignee?.id ??
      (
        await this.prisma.employee.findFirst({
          where: { outletId, status: { in: [...ASSIGNABLE] } },
          select: { id: true },
          orderBy: { createdAt: 'asc' },
        })
      )?.id;
    if (!createdById) return false;

    const template = rec.template;
    const title = template?.name ?? rec.title;
    if (!title) return false;

    try {
      await this.prisma.$transaction(async (tx) => {
        const task = await tx.task.create({
          data: {
            kind: template
              ? template.isAudit
                ? 'AUDIT_RUN'
                : 'CHECKLIST_RUN'
              : 'RECURRING_INSTANCE',
            title,
            outletId,
            departmentId: rec.departmentId,
            assigneeId: assignee?.id ?? null,
            createdById,
            templateId: template?.id ?? null,
            recurrenceId: rec.id,
            priority: rec.priority,
            dueAt: new Date(fireAt.getTime() + rec.dueAfterMins * 60 * 1000),
            requiresVerification: template?.isAudit ?? false,
            businessDate,
          },
        });
        if (assignee) await this.emitAssigned(tx, task.id, task.title, outletId, assignee);
      });
      return true;
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') return false;
      throw e;
    }
  }

  // ---- helpers -----------------------------------------------------------

  private buildWhere(query: ListTasksQuery, scope: RequestScope): Prisma.TaskWhereInput {
    const outletIds = query.outletId
      ? scope.outletIds.filter((id) => id === query.outletId)
      : scope.outletIds;
    if (query.outletId && outletIds.length === 0) throw DomainError.notFound();

    // A caller who only holds SELF sees their own work and nothing else, even
    // when they ask for somebody else's employee id.
    const assigneeId = scope.selfEmployeeId ?? query.assigneeId;

    return {
      outletId: { in: outletIds },
      ...(assigneeId ? { assigneeId } : {}),
      ...(query.departmentId ? { departmentId: query.departmentId } : {}),
      ...(query.kind ? { kind: query.kind } : {}),
      ...(query.status ? { status: { in: query.status } } : {}),
      ...(query.priority ? { priority: query.priority } : {}),
      ...(query.q ? { title: { contains: query.q, mode: 'insensitive' } } : {}),
      ...(query.from || query.to
        ? {
            businessDate: {
              ...(query.from ? { gte: new Date(`${query.from}T00:00:00.000Z`) } : {}),
              ...(query.to ? { lte: new Date(`${query.to}T00:00:00.000Z`) } : {}),
            },
          }
        : {}),
    };
  }

  private async load(id: string, scope: RequestScope) {
    const task = await this.prisma.task.findUnique({ where: { id } });
    if (!task || !scope.outletIds.includes(task.outletId)) throw this.notFound();
    return task;
  }

  private async loadTemplate(id: string) {
    const template = await this.prisma.checklistTemplate.findUnique({ where: { id } });
    if (!template || !template.isActive) {
      throw new DomainError(
        HttpStatus.NOT_FOUND,
        TASK_ERRORS.TEMPLATE_NOT_FOUND,
        'That checklist template does not exist',
      );
    }
    return template;
  }

  private async resolveAssignee(assigneeId: string | null, outletId: string) {
    if (!assigneeId) return null;
    const employee = await this.prisma.employee.findUnique({
      where: { id: assigneeId },
      select: { id: true, outletId: true, status: true, userId: true },
    });
    if (!employee) {
      throw new DomainError(
        HttpStatus.NOT_FOUND,
        ERROR_CODES.EMPLOYEE_NOT_FOUND,
        'That employee does not exist',
      );
    }
    if (employee.outletId !== outletId) {
      throw this.unprocessable(
        TASK_ERRORS.ASSIGNEE_OUTLET_MISMATCH,
        'That employee works at another outlet',
      );
    }
    if (!ASSIGNABLE.includes(employee.status as (typeof ASSIGNABLE)[number])) {
      throw this.unprocessable(
        TASK_ERRORS.EMPLOYEE_NOT_ACTIVE,
        'That employee has left and cannot be given work',
      );
    }
    return { id: employee.id, userId: employee.userId };
  }

  private async storeManagerOf(outletId: string): Promise<string | null> {
    const manager = await this.prisma.employee.findFirst({
      where: {
        outletId,
        status: { in: [...ASSIGNABLE] },
        user: { roleKey: 'STORE_MANAGER', status: 'ACTIVE' },
      },
      select: { id: true },
      orderBy: { createdAt: 'asc' },
    });
    return manager?.id ?? null;
  }

  private async emitAssigned(
    tx: Prisma.TransactionClient,
    taskId: string,
    title: string,
    outletId: string,
    assignee: { id: string; userId: string | null },
  ): Promise<void> {
    await tx.outboxEvent.create({
      data: {
        eventKey: 'TASK_ASSIGNED',
        aggregateType: 'Task',
        aggregateId: taskId,
        payload: {
          taskId,
          title,
          outletId,
          assigneeId: assignee.id,
          assigneeUserId: assignee.userId,
        },
      },
    });
  }

  private assertMayAct(task: { assigneeId: string | null }, scope: RequestScope): void {
    if (scope.selfEmployeeId === null) return;
    if (task.assigneeId === null || task.assigneeId === scope.selfEmployeeId) return;
    throw DomainError.forbidden('That task belongs to somebody else');
  }

  private assertTransition(from: TaskStatus, to: string): void {
    if (!ALLOWED_FROM[to]?.includes(from)) {
      throw DomainError.conflict(
        TASK_ERRORS.TASK_INVALID_TRANSITION,
        `A ${from.toLowerCase()} task cannot become ${to.toLowerCase()}`,
        { currentStatus: from, attempted: to },
      );
    }
  }

  private actorEmployeeId(user: AuthedUser): string {
    if (!user.employeeId) {
      throw DomainError.forbidden('This account is not linked to an employee record');
    }
    return user.employeeId;
  }

  private notFound(): DomainError {
    return new DomainError(
      HttpStatus.NOT_FOUND,
      TASK_ERRORS.TASK_NOT_FOUND,
      'That task does not exist',
    );
  }

  private unprocessable(code: string, message: string, details?: unknown): DomainError {
    return new DomainError(HttpStatus.UNPROCESSABLE_ENTITY, code, message, details);
  }
}

/** Fire times strictly after `since` and at or before `until`, in IST. */
export function cronFireTimesBetween(expr: string, since: Date, until: Date): Date[] {
  const iterator = CronExpressionParser.parse(expr, {
    currentDate: since,
    endDate: until,
    tz: IST,
  });
  const fires: Date[] = [];
  while (fires.length < MAX_FIRES_PER_RUN && iterator.hasNext()) {
    fires.push(iterator.next().toDate());
  }
  return fires;
}

function toListView(row: TaskListRow) {
  return {
    id: row.id,
    kind: row.kind,
    title: row.title,
    outletId: row.outletId,
    outletCode: row.outlet.code,
    departmentId: row.departmentId,
    assigneeId: row.assigneeId,
    assigneeName: row.assignee?.fullName ?? null,
    priority: row.priority,
    status: row.status,
    dueAt: row.dueAt?.toISOString() ?? null,
    startedAt: row.startedAt?.toISOString() ?? null,
    completedAt: row.completedAt?.toISOString() ?? null,
    overdueNotifiedAt: row.overdueNotifiedAt?.toISOString() ?? null,
    // Lateness is two columns compared, never a stored boolean. A boolean can
    // drift out of sync with the timestamps; the timestamps cannot.
    wasLate:
      row.completedAt !== null && row.dueAt !== null
        ? row.completedAt.getTime() > row.dueAt.getTime()
        : null,
    requiresVerification: row.requiresVerification,
    businessDate: row.businessDate.toISOString().slice(0, 10),
    templateCode: row.template?.code ?? null,
    completedItemCount: row._count.results,
  };
}

function toDetailView(row: TaskDetailRow) {
  const byItem = new Map(row.results.map((r) => [r.templateItemId, r]));
  return {
    id: row.id,
    kind: row.kind,
    title: row.title,
    description: row.description,
    outletId: row.outletId,
    outletCode: row.outlet.code,
    departmentId: row.departmentId,
    assigneeId: row.assigneeId,
    assignee: row.assignee,
    createdById: row.createdById,
    creator: row.creator,
    templateId: row.templateId,
    recurrenceId: row.recurrenceId,
    parentTaskId: row.parentTaskId,
    priority: row.priority,
    status: row.status,
    dueAt: row.dueAt?.toISOString() ?? null,
    startedAt: row.startedAt?.toISOString() ?? null,
    completedAt: row.completedAt?.toISOString() ?? null,
    verifiedAt: row.verifiedAt?.toISOString() ?? null,
    verifiedById: row.verifiedById,
    requiresVerification: row.requiresVerification,
    overdueNotifiedAt: row.overdueNotifiedAt?.toISOString() ?? null,
    wasLate:
      row.completedAt !== null && row.dueAt !== null
        ? row.completedAt.getTime() > row.dueAt.getTime()
        : null,
    businessDate: row.businessDate.toISOString().slice(0, 10),
    createdAt: row.createdAt.toISOString(),
    items:
      row.template?.items.map((i) => {
        const result = byItem.get(i.id);
        return {
          templateItemId: i.id,
          sortOrder: i.sortOrder,
          label: i.label,
          requiresPhoto: i.requiresPhoto,
          requiresNote: i.requiresNote,
          failCreatesTask: i.failCreatesTask,
          result: result?.result ?? null,
          note: result?.note ?? null,
          attachmentId: result?.attachmentId ?? null,
        };
      }) ?? [],
    comments: row.comments.map(toCommentView),
    // ponytail: no signed read URL, the bucket is not configured here. Mint
    // createSignedUrl(storageKey, 300) alongside each row when it is.
    attachments: row.attachments.map((a) => ({
      id: a.id,
      storageKey: a.storageKey,
      mimeType: a.mimeType,
      sizeBytes: a.sizeBytes,
      uploadedById: a.uploadedById,
      createdAt: a.createdAt.toISOString(),
    })),
  };
}

function toCommentView(row: {
  id: string;
  taskId: string;
  authorId: string;
  body: string;
  createdAt: Date;
}) {
  return {
    id: row.id,
    taskId: row.taskId,
    authorId: row.authorId,
    body: row.body,
    createdAt: row.createdAt.toISOString(),
  };
}
