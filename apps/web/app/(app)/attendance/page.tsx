'use client';

import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { ErrorState } from '@/components/ui/error-state';
import { PageHeader } from '@/components/ui/page-header';
import { Skeleton } from '@/components/ui/skeleton';
import { useCan, useSession } from '@/lib/auth';
import { longDate, time } from '@/lib/format';
import {
  endBreak,
  getBoard,
  hm,
  listShifts,
  liveWorkedMins,
  punch,
  startBreak,
  stateLabel,
  type AttendanceDayFull,
  type PunchState,
} from '@/features/workforce/api';
import { workforceKeys } from '@/features/workforce/keys';
import { toBusinessDate } from '@bobs-momo/shared';

type Attempt = 'IN' | 'OUT';

export default function AttendancePunchPage() {
  const { user, loading } = useSession();
  const can = useCan();
  const queryClient = useQueryClient();
  const employeeId = user?.employeeId ?? null;

  // The card clock is the device clock in IST. The punch timestamp is the
  // server's, never this one.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  // A key per attempt, held until that attempt succeeds. Tapping again after a
  // lost response replays the original punch instead of creating a second one.
  const keys = useRef<Partial<Record<Attempt, string>>>({});
  const keyFor = (direction: Attempt): string => {
    const held = keys.current[direction];
    if (held) return held;
    const fresh = crypto.randomUUID();
    keys.current[direction] = fresh;
    return fresh;
  };

  const [day, setDay] = useState<AttendanceDayFull | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  const board = useQuery({
    queryKey: workforceKeys.board(),
    queryFn: getBoard,
    enabled: Boolean(employeeId),
    refetchOnWindowFocus: true,
  });

  // The 04:00 IST boundary, not the UTC date. Between midnight and 05:30 the
  // two differ, so a 05:00 prep shift looked up yesterday's roster and the
  // late-or-on-time line was wrong for exactly the staff who start earliest.
  const today = toBusinessDate(new Date(now));
  const shift = useQuery({
    queryKey: workforceKeys.shifts({ from: today, to: today, employeeId }),
    queryFn: () => listShifts({ from: today, to: today, pageSize: 5 }),
    enabled: Boolean(employeeId),
  });

  const row = board.data?.employees.find((e) => e.employeeId === employeeId) ?? null;

  const state: PunchState = day
    ? day.openBreak
      ? 'ON_BREAK'
      : (day.punches.at(-1)?.direction ?? null) === 'IN'
        ? 'IN'
        : day.punches.length > 0
          ? 'OUT'
          : 'NOT_IN'
    : (row?.state ?? 'NOT_IN');

  const source = day ?? row;
  const worked = source ? liveWorkedMins({ ...source, state }, now) : 0;
  const lateMins = source?.lateMins ?? 0;
  const punched = day
    ? day.punches
    : row?.firstInAt
      ? [{ id: 'first', direction: 'IN' as const, punchedAt: row.firstInAt, source: 'WEB' }]
      : [];

  const settle = (next: AttendanceDayFull, clear?: Attempt) => {
    if (clear) delete keys.current[clear];
    setDay(next);
    setFailure(null);
    void queryClient.invalidateQueries({ queryKey: workforceKeys.board() });
  };

  const punchMutation = useMutation({
    mutationFn: (direction: Attempt) => punch({ direction }, keyFor(direction)),
    onSuccess: (res, direction) => settle(res.attendanceDay, direction),
    onError: (err: Error) => setFailure(err.message),
  });

  const breakMutation = useMutation({
    mutationFn: (action: 'start' | 'end') => (action === 'start' ? startBreak({}) : endBreak()),
    onSuccess: (res) => settle(res),
    onError: (err: Error) => setFailure(err.message),
  });

  if (loading) {
    return (
      <div className="space-y-4 p-4">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-56 w-full" />
      </div>
    );
  }

  if (!employeeId) {
    return (
      <div className="space-y-4 p-4">
        <PageHeader title="Attendance" />
        <EmptyState
          title="This login is not linked to an employee record"
          description="Ask an administrator to link your account to your employee profile before you punch in."
        />
      </div>
    );
  }

  const busy = punchMutation.isPending || breakMutation.isPending;
  const nextDirection: Attempt = state === 'IN' || state === 'ON_BREAK' ? 'OUT' : 'IN';
  const scheduled = shift.data?.data.find((s) => s.status === 'SCHEDULED') ?? null;

  return (
    <div className="mx-auto w-full max-w-[480px] space-y-4 p-4">
      <PageHeader title="Attendance" subtitle={longDate(new Date(now).toISOString())} />

      {board.isError ? (
        <ErrorState
          title="Could not load your attendance"
          message={(board.error as Error).message}
          onRetry={() => void board.refetch()}
        />
      ) : null}

      <Card className="space-y-4 p-5 text-center">
        {board.isLoading ? (
          <div className="space-y-3">
            <Skeleton className="mx-auto h-9 w-32" />
            <Skeleton className="mx-auto h-5 w-40" />
          </div>
        ) : (
          <div className="space-y-1">
            <p className="text-3xl font-semibold tabular-nums">
              {time(new Date(now).toISOString())}
            </p>
            <p className="text-base font-medium">{stateLabel[state]}</p>
            {state === 'NOT_IN' ? null : (
              <p className="text-sm text-text-muted">Worked {hm(worked)} today</p>
            )}
            {lateMins > 0 ? (
              <p className="text-sm text-amber-700">Late by {lateMins} min</p>
            ) : null}
          </div>
        )}

        <Button
          type="button"
          className="min-h-[64px] w-full text-lg"
          disabled={busy || board.isLoading}
          onClick={() => punchMutation.mutate(nextDirection)}
        >
          {punchMutation.isPending
            ? 'Sending...'
            : nextDirection === 'IN'
              ? 'Punch in'
              : 'Punch out'}
        </Button>

        <Button
          type="button"
          variant="secondary"
          className="min-h-[52px] w-full"
          disabled={busy || board.isLoading || state === 'NOT_IN' || state === 'OUT'}
          onClick={() => breakMutation.mutate(state === 'ON_BREAK' ? 'end' : 'start')}
        >
          {breakMutation.isPending
            ? 'Sending...'
            : state === 'ON_BREAK'
              ? 'End break'
              : 'Start break'}
        </Button>

        {failure ? (
          <p role="alert" className="text-sm text-danger">
            {failure} Tap again to retry, it will not punch you twice.
          </p>
        ) : null}
      </Card>

      <Card className="space-y-3 p-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-text-muted">Today</h2>
        {punched.length === 0 ? (
          <p className="text-sm text-text-muted">No punches yet today.</p>
        ) : (
          <ul className="space-y-2">
            {punched.map((p) => (
              <li key={p.id} className="flex items-center justify-between text-sm">
                <span className="font-medium">{p.direction}</span>
                <span className="tabular-nums">{time(p.punchedAt)}</span>
              </li>
            ))}
          </ul>
        )}
        {source && source.breakMins > 0 ? (
          <p className="text-sm text-text-muted">Breaks {hm(source.breakMins)}</p>
        ) : null}
        {scheduled ? (
          <p className="text-sm text-text-muted">
            Shift {time(scheduled.startsAt)} - {time(scheduled.endsAt)}
          </p>
        ) : null}
      </Card>

      {can('workforce.attendance.read') ? (
        <div className="flex flex-wrap gap-3">
          <Link className="text-sm underline" href="/attendance/board">
            Attendance board
          </Link>
          <Link className="text-sm underline" href="/attendance/history">
            Attendance history
          </Link>
        </div>
      ) : null}
    </div>
  );
}
