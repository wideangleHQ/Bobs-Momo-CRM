'use client';

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { bulkShiftSchema, createShiftSchema, toBusinessDate } from '@bobs-momo/shared';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog } from '@/components/ui/dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { ErrorState } from '@/components/ui/error-state';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PageHeader } from '@/components/ui/page-header';
import { Skeleton } from '@/components/ui/skeleton';
import { shortDate } from '@/lib/format';
import {
  bulkShifts,
  cancelShift,
  createShift,
  istHhmm,
  listAllShifts,
  listEmployees,
  mondayOf,
  weekDays,
  type Shift,
} from '@/features/workforce/api';
import { workforceKeys } from '@/features/workforce/keys';

const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export default function RosterPage() {
  const queryClient = useQueryClient();
  const [weekStart, setWeekStart] = useState(() => mondayOf(toBusinessDate()));
  const [cell, setCell] = useState<{ employeeId: string; date: string } | null>(null);
  const [bulkOpen, setBulkOpen] = useState(false);

  const days = useMemo(() => weekDays(weekStart), [weekStart]);
  const weekEnd = days[6] ?? weekStart;

  const employees = useQuery({
    queryKey: workforceKeys.employees({ status: 'ACTIVE', pageSize: 100 }),
    queryFn: () => listEmployees({ status: 'ACTIVE', pageSize: 100 }),
  });

  const shifts = useQuery({
    queryKey: workforceKeys.shifts({ from: weekStart, to: weekEnd, all: true }),
    queryFn: () => listAllShifts({ from: weekStart, to: weekEnd }),
  });

  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ['shifts'] });

  const cancel = useMutation({
    mutationFn: (id: string) => cancelShift(id),
    onSuccess: invalidate,
  });

  const staff = employees.data?.data ?? [];
  const byCell = new Map<string, Shift[]>();
  for (const s of shifts.data ?? []) {
    const key = `${s.employeeId}|${s.shiftDate}`;
    byCell.set(key, [...(byCell.get(key) ?? []), s]);
  }

  const shiftWeek = (deltaDays: number) => {
    setWeekStart(new Date(Date.parse(`${weekStart}T00:00:00.000Z`) + deltaDays * 86_400_000)
      .toISOString()
      .slice(0, 10));
  };

  return (
    <div className="space-y-4 p-4">
      <PageHeader
        title="Roster"
        subtitle={`${shortDate(`${weekStart}T00:00:00.000Z`)} to ${shortDate(`${weekEnd}T00:00:00.000Z`)}`}
        action={
          <Button type="button" className="min-h-[44px]" onClick={() => setBulkOpen(true)}>
            Roster a week
          </Button>
        }
      />

      <div className="flex items-center gap-2">
        <Button type="button" variant="secondary" className="min-h-[44px]" onClick={() => shiftWeek(-7)}>
          Previous week
        </Button>
        <Button type="button" variant="secondary" className="min-h-[44px]" onClick={() => shiftWeek(7)}>
          Next week
        </Button>
      </div>

      {employees.isError || shifts.isError ? (
        <ErrorState
          title="Could not load the roster"
          message={((employees.error ?? shifts.error) as Error).message}
          onRetry={() => {
            void employees.refetch();
            void shifts.refetch();
          }}
        />
      ) : null}

      {employees.isLoading || shifts.isLoading ? (
        <Skeleton className="h-80 w-full" />
      ) : staff.length === 0 ? (
        <EmptyState
          title="Nobody to roster"
          description="Add employees before you build a week. New staff appear here as soon as they are created."
        />
      ) : (
        <Card className="overflow-x-auto p-0">
          <table className="w-full min-w-[720px] border-collapse text-sm">
            <thead>
              <tr>
                <th className="sticky left-0 z-10 bg-white p-2 text-left">Employee</th>
                {days.map((d, i) => (
                  <th key={d} className="p-2 text-left font-medium">
                    {DAY_LABELS[i]} {shortDate(`${d}T00:00:00.000Z`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {staff.map((e) => (
                <tr key={e.id} className="border-t align-top">
                  <th scope="row" className="sticky left-0 z-10 bg-white p-2 text-left font-medium">
                    {e.fullName}
                    <span className="block text-xs font-normal text-text-muted">
                      {e.departmentName ?? e.outletCode}
                    </span>
                  </th>
                  {days.map((d) => {
                    const cellShifts = byCell.get(`${e.id}|${d}`) ?? [];
                    return (
                      <td key={d} className="p-2">
                        <div className="space-y-1">
                          {cellShifts.map((s) => (
                            <div
                              key={s.id}
                              className={
                                s.status === 'CANCELLED'
                                  ? 'text-neutral-400 line-through'
                                  : 'font-medium'
                              }
                            >
                              {istHhmm(s.startsAt)}-{istHhmm(s.endsAt)}
                              {s.status === 'SCHEDULED' ? (
                                <button
                                  type="button"
                                  className="ml-2 min-h-[44px] text-xs underline"
                                  onClick={() => cancel.mutate(s.id)}
                                >
                                  Cancel
                                </button>
                              ) : null}
                            </div>
                          ))}
                          <button
                            type="button"
                            className="min-h-[44px] w-full text-left text-xs underline"
                            onClick={() => setCell({ employeeId: e.id, date: d })}
                          >
                            Add shift
                          </button>
                        </div>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      {cell ? (
        <SingleShiftDialog
          employee={staff.find((s) => s.id === cell.employeeId)}
          date={cell.date}
          onClose={() => setCell(null)}
          onSaved={() => {
            setCell(null);
            invalidate();
          }}
        />
      ) : null}

      {bulkOpen ? (
        <BulkShiftDialog
          staff={staff}
          days={days}
          onClose={() => setBulkOpen(false)}
          onSaved={() => {
            setBulkOpen(false);
            invalidate();
          }}
        />
      ) : null}
    </div>
  );
}

interface StaffRow {
  id: string;
  fullName: string;
  outletId: string;
  outletCode: string;
  departmentName: string | null;
}

function SingleShiftDialog({
  employee,
  date,
  onClose,
  onSaved,
}: {
  employee: StaffRow | undefined;
  date: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [startsAt, setStartsAt] = useState('09:00');
  const [endsAt, setEndsAt] = useState('18:00');
  const [note, setNote] = useState('');
  const [problem, setProblem] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: (body: unknown) => createShift(body),
    onSuccess: onSaved,
    onError: (err: Error) => setProblem(err.message),
  });

  if (!employee) return null;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setProblem(null);
    const parsed = createShiftSchema.safeParse({
      employeeId: employee.id,
      outletId: employee.outletId,
      shiftDate: date,
      startsAt,
      endsAt,
      ...(note.trim() === '' ? {} : { note: note.trim() }),
    });
    if (!parsed.success) {
      setProblem(parsed.error.issues[0]?.message ?? 'Check the times');
      return;
    }
    save.mutate(parsed.data);
  };

  return (
    <Dialog open onClose={onClose} title={`Shift for ${employee.fullName}`}>
      <form className="space-y-4" onSubmit={submit}>
        <p className="text-sm text-text-muted">{date}</p>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label htmlFor="startsAt">Starts</Label>
            <Input
              id="startsAt"
              type="time"
              value={startsAt}
              onChange={(e) => setStartsAt(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="endsAt">Ends</Label>
            <Input id="endsAt" type="time" value={endsAt} onChange={(e) => setEndsAt(e.target.value)} />
          </div>
        </div>
        <div className="space-y-1">
          <Label htmlFor="note">Note</Label>
          <Input id="note" value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
        {problem ? (
          <p role="alert" className="text-sm text-danger">
            {problem}
          </p>
        ) : null}
        <div className="flex gap-3">
          <Button type="button" variant="secondary" className="min-h-[44px] flex-1" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" className="min-h-[44px] flex-1" disabled={save.isPending}>
            {save.isPending ? 'Saving...' : 'Add shift'}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

function BulkShiftDialog({
  staff,
  days,
  onClose,
  onSaved,
}: {
  staff: StaffRow[];
  days: string[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [picked, setPicked] = useState<string[]>([]);
  const [pickedDays, setPickedDays] = useState<string[]>(() => days.slice(0, 6));
  const [startsAt, setStartsAt] = useState('09:00');
  const [endsAt, setEndsAt] = useState('18:00');
  const [problem, setProblem] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: (body: unknown) => bulkShifts(body),
    onSuccess: onSaved,
    onError: (err: Error) => setProblem(err.message),
  });

  const toggle = (list: string[], value: string): string[] =>
    list.includes(value) ? list.filter((v) => v !== value) : [...list, value];

  const count = picked.length * pickedDays.length;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setProblem(null);
    const rows = picked.flatMap((employeeId) => {
      const employee = staff.find((s) => s.id === employeeId);
      if (!employee) return [];
      return pickedDays.map((shiftDate) => ({
        employeeId,
        outletId: employee.outletId,
        shiftDate,
        startsAt,
        endsAt,
      }));
    });
    const parsed = bulkShiftSchema.safeParse({ shifts: rows });
    if (!parsed.success) {
      setProblem(parsed.error.issues[0]?.message ?? 'Pick at least one person and one day');
      return;
    }
    save.mutate(parsed.data);
  };

  return (
    <Dialog open onClose={onClose} title="Roster a week">
      <form className="space-y-4" onSubmit={submit}>
        <div className="space-y-2">
          <Label>Days</Label>
          <div className="flex flex-wrap gap-2">
            {days.map((d, i) => (
              <label key={d} className="flex min-h-[44px] items-center gap-2 text-sm">
                <Checkbox
                  checked={pickedDays.includes(d)}
                  onChange={() => setPickedDays((prev) => toggle(prev, d))}
                />
                {DAY_LABELS[i]}
              </label>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label htmlFor="bulkStart">Starts</Label>
            <Input
              id="bulkStart"
              type="time"
              value={startsAt}
              onChange={(e) => setStartsAt(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="bulkEnd">Ends</Label>
            <Input
              id="bulkEnd"
              type="time"
              value={endsAt}
              onChange={(e) => setEndsAt(e.target.value)}
            />
          </div>
        </div>

        <div className="space-y-2">
          <Label>People</Label>
          <div className="max-h-56 space-y-1 overflow-y-auto">
            {staff.map((s) => (
              <label key={s.id} className="flex min-h-[44px] items-center gap-2 text-sm">
                <Checkbox
                  checked={picked.includes(s.id)}
                  onChange={() => setPicked((prev) => toggle(prev, s.id))}
                />
                {s.fullName}
              </label>
            ))}
          </div>
        </div>

        <p className="text-sm text-text-muted">
          {count} shifts. The week is written in one go, so if any single shift clashes nothing at
          all is saved.
        </p>

        {problem ? (
          <p role="alert" className="text-sm text-danger">
            Nothing was saved. {problem} Fix that one and submit the week again.
          </p>
        ) : null}

        <div className="flex gap-3">
          <Button type="button" variant="secondary" className="min-h-[44px] flex-1" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" className="min-h-[44px] flex-1" disabled={save.isPending}>
            {save.isPending ? 'Saving...' : `Create ${count} shifts`}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
