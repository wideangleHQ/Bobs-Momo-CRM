import { apiGet, apiPatch, apiPost } from '@/lib/api';
import type { Paginated } from '@bobs-momo/shared';

// ---- types, mirroring what the workforce services return ------------------

export type EmploymentStatus = 'ACTIVE' | 'ON_NOTICE' | 'EXITED';
export type AttendanceStatus = 'PRESENT' | 'ABSENT' | 'HALF_DAY' | 'ON_LEAVE' | 'WEEKLY_OFF';
export type PunchState = 'NOT_IN' | 'IN' | 'ON_BREAK' | 'OUT';
export type LeaveType = 'CASUAL' | 'SICK' | 'UNPAID' | 'COMP_OFF';
export type LeaveStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED';

export interface Employee {
  id: string;
  employeeCode: string;
  fullName: string;
  phone: string;
  outletId: string;
  outletCode: string;
  departmentId: string | null;
  departmentName: string | null;
  designation: string | null;
  joinedOn: string;
  exitedOn: string | null;
  status: EmploymentStatus;
  user: { id: string; username: string; roleKey: string } | null;
}

export interface AttendanceDayRow {
  id: string;
  employeeId: string;
  employeeName: string;
  employeeCode: string;
  outletId: string;
  businessDate: string;
  status: AttendanceStatus;
  firstInAt: string | null;
  lastOutAt: string | null;
  workedMins: number;
  breakMins: number;
  lateMins: number;
}

export interface BoardRow {
  employeeId: string;
  employeeCode: string;
  fullName: string;
  outletCode: string;
  state: PunchState;
  status: AttendanceStatus;
  firstInAt: string | null;
  lastOutAt: string | null;
  workedMins: number;
  breakMins: number;
  lateMins: number;
}

export interface AttendanceBoard {
  businessDate: string;
  employees: BoardRow[];
}

export interface AttendanceDayFull {
  id: string;
  employeeId: string;
  outletId: string;
  businessDate: string;
  status: AttendanceStatus;
  firstInAt: string | null;
  lastOutAt: string | null;
  workedMins: number;
  breakMins: number;
  lateMins: number;
  openBreak: boolean;
  punches: { id: string; direction: 'IN' | 'OUT'; punchedAt: string; source: string }[];
}

export interface Shift {
  id: string;
  employeeId: string;
  employeeName: string;
  employeeCode: string;
  outletId: string;
  shiftDate: string;
  startsAt: string;
  endsAt: string;
  status: 'SCHEDULED' | 'SWAPPED' | 'CANCELLED';
  note: string | null;
}

export interface LeaveRequest {
  id: string;
  employeeId: string;
  employeeName: string;
  employeeCode: string;
  outletId: string;
  type: LeaveType;
  fromDate: string;
  toDate: string;
  dayCount: string;
  reason: string;
  status: LeaveStatus;
  decidedById: string | null;
  decidedAt: string | null;
  decisionNote: string | null;
  createdAt: string;
}

export interface SalaryHistory {
  employeeId: string;
  employeeName: string;
  records: {
    id: string;
    effectiveFrom: string;
    effectiveTo: string | null;
    monthlyCtc: string;
    basic: string | null;
    allowances: string | null;
    note: string | null;
    isCurrent: boolean;
  }[];
}

// ---- fetchers -------------------------------------------------------------

function qs(params: Record<string, string | number | undefined>): string {
  const search = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== '') search.set(k, String(v));
  }
  const s = search.toString();
  return s ? `?${s}` : '';
}

export const listEmployees = (params: Record<string, string | number | undefined>) =>
  apiGet<Paginated<Employee>>(`/employees${qs(params)}`);

export const getEmployee = (id: string) => apiGet<Employee>(`/employees/${id}`);

export const createEmployee = (body: unknown) => apiPost<Employee>('/employees', body);

export const updateEmployee = (id: string, body: unknown) =>
  apiPatch<Employee>(`/employees/${id}`, body);

export const exitEmployee = (id: string, body: unknown) =>
  apiPost<Employee>(`/employees/${id}/exit`, body);

/**
 * A cook on 3G taps punch, sees nothing for two seconds and taps again. The key
 * is generated once per attempt and reused across retries of that attempt, so a
 * lost response replays the original punch instead of creating a second one.
 */
export const punch = (body: unknown, idempotencyKey: string) =>
  apiPost<{ attendanceDay: AttendanceDayFull; punch: AttendanceDayFull['punches'][number] }>(
    '/attendance/punch',
    body,
    { headers: { 'Idempotency-Key': idempotencyKey } },
  );

export const startBreak = (body: unknown) =>
  apiPost<AttendanceDayFull>('/attendance/break/start', body);

export const endBreak = () => apiPost<AttendanceDayFull>('/attendance/break/end', {});

export const getBoard = () => apiGet<AttendanceBoard>('/attendance/today');

export const listAttendance = (params: Record<string, string | number | undefined>) =>
  apiGet<Paginated<AttendanceDayRow>>(`/attendance${qs(params)}`);

export const editPunch = (punchId: string, body: unknown) =>
  apiPatch<AttendanceDayFull>(`/attendance/punches/${punchId}`, body);

export const listShifts = (params: Record<string, string | number | undefined>) =>
  apiGet<Paginated<Shift>>(`/shifts${qs(params)}`);

export const createShift = (body: unknown) => apiPost<Shift>('/shifts', body);

export const bulkShifts = (body: unknown) =>
  apiPost<{ created: number; shifts: Shift[] }>('/shifts/bulk', body);

export const cancelShift = (id: string) =>
  apiPost<{ id: string; status: 'CANCELLED' }>(`/shifts/${id}/cancel`, {});

export const listLeave = (params: Record<string, string | number | undefined>) =>
  apiGet<Paginated<LeaveRequest>>(`/leave-requests${qs(params)}`);

export const createLeave = (body: unknown) => apiPost<LeaveRequest>('/leave-requests', body);

export const decideLeave = (id: string, to: 'approve' | 'reject', body: unknown) =>
  apiPost<LeaveRequest>(`/leave-requests/${id}/${to}`, body);

export const cancelLeave = (id: string) => apiPost<LeaveRequest>(`/leave-requests/${id}/cancel`, {});

export const getSalary = (employeeId: string) =>
  apiGet<SalaryHistory>(`/employees/${employeeId}/salary`);

export const createSalary = (body: unknown) => apiPost<SalaryHistory>('/salary', body);

// ---- display helpers ------------------------------------------------------

/** "3h 26m", "22 min", "0 min". Worked time is read at a glance, not parsed. */
export function hm(mins: number): string {
  const m = Math.max(0, Math.round(mins));
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

/**
 * workedMins only counts closed IN/OUT pairs, so somebody standing on the floor
 * reads zero until they punch out. For a live row the browser adds the time
 * since they arrived, minus the breaks already taken.
 */
export function liveWorkedMins(
  row: { state?: PunchState; firstInAt: string | null; workedMins: number; breakMins: number },
  nowMs: number,
): number {
  if (row.state !== 'IN' && row.state !== 'ON_BREAK') return row.workedMins;
  if (!row.firstInAt) return row.workedMins;
  const elapsed = Math.round((nowMs - Date.parse(row.firstInAt)) / 60_000);
  return Math.max(0, elapsed - row.breakMins);
}

export const stateLabel: Record<PunchState, string> = {
  NOT_IN: 'Not punched in',
  IN: 'Punched in',
  ON_BREAK: 'On break',
  OUT: 'Punched out',
};

/**
 * A week of roster for a full outlet runs past the 100 row page cap, and a grid
 * with a missing Thursday is worse than a slow grid.
 * ponytail: five pages is 500 shifts, well past any single outlet week.
 */
export async function listAllShifts(
  params: Record<string, string | number | undefined>,
): Promise<Shift[]> {
  const out: Shift[] = [];
  for (let page = 1; page <= 5; page += 1) {
    const res = await listShifts({ ...params, page, pageSize: 100 });
    out.push(...res.data);
    if (page >= res.meta.totalPages) break;
  }
  return out;
}

/** Monday of the week containing `date`, as YYYY-MM-DD. */
export function mondayOf(date: string): string {
  const d = new Date(`${date}T00:00:00.000Z`);
  const shift = (d.getUTCDay() + 6) % 7;
  return new Date(d.getTime() - shift * 86_400_000).toISOString().slice(0, 10);
}

export function weekDays(weekStart: string): string[] {
  const base = Date.parse(`${weekStart}T00:00:00.000Z`);
  return Array.from({ length: 7 }, (_, i) => new Date(base + i * 86_400_000).toISOString().slice(0, 10));
}

/** "09:00" in IST from an absolute instant, which is how a roster reads. */
export function istHhmm(iso: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kolkata',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(iso));
}
