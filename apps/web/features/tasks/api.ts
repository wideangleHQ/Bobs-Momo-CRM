import { apiGet, apiPatch, apiPost } from '@/lib/api';
import type { Paginated } from '@bobs-momo/shared';

export type TaskKind = 'ONE_OFF' | 'RECURRING_INSTANCE' | 'CHECKLIST_RUN' | 'AUDIT_RUN';
export type TaskStatus =
  | 'OPEN'
  | 'IN_PROGRESS'
  | 'COMPLETED'
  | 'VERIFIED'
  | 'CANCELLED'
  | 'OVERDUE';
export type TaskPriority = 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT';
export type ChecklistResultValue = 'PASS' | 'FAIL' | 'NA';

export interface TaskRow {
  id: string;
  kind: TaskKind;
  title: string;
  outletId: string;
  assigneeId: string | null;
  assigneeName?: string | null;
  priority: TaskPriority;
  status: TaskStatus;
  dueAt: string | null;
  businessDate: string;
  requiresVerification?: boolean;
  itemCount?: number;
  completedItemCount?: number;
}

export interface TemplateItem {
  id: string;
  sortOrder: number;
  label: string;
  requiresPhoto: boolean;
  requiresNote: boolean;
  failCreatesTask: boolean;
}

export interface ChecklistTemplate {
  id: string;
  code: string;
  name: string;
  description: string | null;
  isAudit: boolean;
  isActive: boolean;
  outletId: string | null;
  items: TemplateItem[];
}

export interface ChecklistResult {
  templateItemId: string;
  result: ChecklistResultValue;
  note: string | null;
  attachmentId?: string | null;
}

export interface TaskComment {
  id: string;
  body: string;
  authorName?: string | null;
  createdAt: string;
}

export interface TaskAttachment {
  id: string;
  url?: string | null;
  storageKey?: string | null;
}

export interface TaskDetail extends TaskRow {
  description: string | null;
  departmentId?: string | null;
  startedAt?: string | null;
  completedAt?: string | null;
  verifiedAt?: string | null;
  template?: ChecklistTemplate | null;
  checklistResults?: ChecklistResult[];
  comments?: TaskComment[];
  attachments?: TaskAttachment[];
}

export interface MyTasks {
  overdue: TaskRow[];
  today: TaskRow[];
  upcoming: TaskRow[];
}

export interface TaskRecurrence {
  id: string;
  name: string;
  cronExpr: string;
  templateId: string | null;
  title: string | null;
  outletId: string | null;
  departmentId: string | null;
  assigneeId: string | null;
  priority: TaskPriority;
  dueAfterMins: number;
  isActive: boolean;
  nextFireTimes?: string[];
}

function qs(params: Record<string, string | number | undefined>): string {
  const search = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== '') search.set(k, String(v));
  }
  const s = search.toString();
  return s ? `?${s}` : '';
}

/**
 * The templates and recurrences routes are not paginated, so they may come back
 * bare or wrapped. ponytail: one line beats coordinating an envelope.
 */
function unwrap<T>(res: T[] | { data: T[] }): T[] {
  return Array.isArray(res) ? res : res.data;
}

export const listTasks = (params: Record<string, string | number | undefined>) =>
  apiGet<Paginated<TaskRow>>(`/tasks${qs(params)}`);

export const getMyTasks = () => apiGet<MyTasks>('/tasks/my');

export const getTask = (id: string) => apiGet<TaskDetail>(`/tasks/${id}`);

export const createTask = (body: unknown) => apiPost<TaskRow>('/tasks', body);

export const startTask = (id: string) => apiPost<TaskRow>(`/tasks/${id}/start`, {});

export const completeTask = (id: string, body: unknown) =>
  apiPost<TaskRow>(`/tasks/${id}/complete`, body);

export const verifyTask = (id: string, body: unknown) =>
  apiPost<TaskRow>(`/tasks/${id}/verify`, body);

export const cancelTask = (id: string, body: unknown) =>
  apiPost<TaskRow>(`/tasks/${id}/cancel`, body);

export const addComment = (id: string, body: unknown) =>
  apiPost<TaskComment>(`/tasks/${id}/comments`, body);

export const submitChecklist = (id: string, body: unknown) =>
  apiPost<{ task: TaskRow; followUpTasks?: TaskRow[] }>(`/tasks/${id}/checklist`, body);

export const listTemplates = async (params: Record<string, string | number | undefined> = {}) =>
  unwrap(await apiGet<ChecklistTemplate[] | { data: ChecklistTemplate[] }>(
    `/checklist-templates${qs(params)}`,
  ));

export const createTemplate = (body: unknown) =>
  apiPost<ChecklistTemplate>('/checklist-templates', body);

export const updateTemplate = (id: string, body: unknown) =>
  apiPatch<ChecklistTemplate>(`/checklist-templates/${id}`, body);

export const listRecurrences = async (params: Record<string, string | number | undefined> = {}) =>
  unwrap(await apiGet<TaskRecurrence[] | { data: TaskRecurrence[] }>(
    `/task-recurrences${qs(params)}`,
  ));

export const createRecurrence = (body: unknown) =>
  apiPost<TaskRecurrence>('/task-recurrences', body);

export const updateRecurrence = (id: string, body: unknown) =>
  apiPatch<TaskRecurrence>(`/task-recurrences/${id}`, body);

// ---- display --------------------------------------------------------------

export const PRIORITY_TONE: Record<TaskPriority, string> = {
  LOW: 'neutral',
  NORMAL: 'neutral',
  HIGH: 'warning',
  URGENT: 'danger',
};

export const STATUS_TONE: Record<TaskStatus, string> = {
  OPEN: 'neutral',
  IN_PROGRESS: 'warning',
  COMPLETED: 'success',
  VERIFIED: 'success',
  CANCELLED: 'neutral',
  OVERDUE: 'danger',
};

/** "due in 40 min", "2h late". A cook reads a clock, not a timestamp. */
export function dueLabel(dueAt: string | null, nowMs: number = Date.now()): string {
  if (!dueAt) return 'No due time';
  const mins = Math.round((Date.parse(dueAt) - nowMs) / 60_000);
  const abs = Math.abs(mins);
  const size = abs < 60 ? `${abs} min` : `${Math.floor(abs / 60)}h ${abs % 60}m`;
  return mins >= 0 ? `due in ${size}` : `${size} late`;
}

/**
 * OVERDUE is not terminal. A late task is still work, so it keeps every action
 * an open one has and is never greyed out.
 */
export const ACTIONABLE: TaskStatus[] = ['OPEN', 'IN_PROGRESS', 'OVERDUE'];

export function isChecklist(task: { kind: TaskKind }): boolean {
  return task.kind === 'CHECKLIST_RUN' || task.kind === 'AUDIT_RUN';
}
