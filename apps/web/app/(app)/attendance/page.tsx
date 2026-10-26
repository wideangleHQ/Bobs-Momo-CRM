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
  getAttendanceSummary,
  getBoard,
  hm,
  listShifts,
  liveWorkedMins,
  punch,
  startBreak,
  stateLabel,
  type AttendanceBoard,
  type AttendanceDayFull,
  type PunchState,
  type SelfPunchBody,
} from '@/features/workforce/api';
import { workforceKeys } from '@/features/workforce/keys';
import { VerificationBadge } from '@/features/workforce/verification-badge';
import { ApiError } from '@/lib/api';
import { toBusinessDate } from '@bobs-momo/shared';

type Attempt = 'IN' | 'OUT';

const LOCATION_MESSAGES: Record<number, string> = {
  1: 'Location access is blocked. Allow location for this site in your browser settings, then tap again.',
  2: 'Your device could not work out where you are. Turn on location services, then tap again.',
  3: 'Finding your location took too long. Move somewhere with a clearer sky, then tap again.',
};

// The coordinates are sent for the server to measure. Nothing is decided here.
function readLocation(): Promise<SelfPunchBody['location']> {
  return new Promise((resolve, reject) => {
    if (typeof navigator === 'undefined' || !('geolocation' in navigator)) {
      reject(new Error('This browser cannot share your location, so it cannot be used to punch.'));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (p) =>
        resolve({
          latitude: p.coords.latitude,
          longitude: p.coords.longitude,
          accuracyM: p.coords.accuracy,
        }),
      (e) => reject(new Error(LOCATION_MESSAGES[e.code] ?? 'Could not read your location.')),
      { enableHighAccuracy: true, timeout: 15_000, maximumAge: 0 },
    );
  });
}

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

  // The key and the exact body are held together until the attempt is settled.
  // Tapping again after a lost response replays the same request (same key,
  // same coordinates) instead of creating a second punch.
  const attempts = useRef<Partial<Record<Attempt, { key: string; body: SelfPunchBody }>>>({});

  const [day, setDay] = useState<AttendanceDayFull | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [locating, setLocating] = useState(false);
  const [recovered, setRecovered] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState<{ distanceM: number; radiusM: number } | null>(null);

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
  const verification = row?.verificationStatus ?? null;
  const rejected = verification === 'REJECTED';

  const summary = useQuery({
    queryKey: workforceKeys.summary({ self: true }),
    queryFn: () => getAttendanceSummary({}),
    enabled: Boolean(employeeId),
  });

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

  const refreshBoard = () => queryClient.invalidateQueries({ queryKey: workforceKeys.board() });

  const settle = (next: AttendanceDayFull) => {
    setDay(next);
    setFailure(null);
    void refreshBoard();
  };

  const punchMutation = useMutation({
    mutationFn: async (direction: Attempt) => {
      let held = attempts.current[direction];
      if (!held) {
        setLocating(true);
        try {
          const location = await readLocation();
          held = { key: crypto.randomUUID(), body: { direction, location } };
          attempts.current[direction] = held;
        } finally {
          setLocating(false);
        }
      }
      return punch(held.body, held.key);
    },
    onSuccess: (res, direction) => {
      delete attempts.current[direction];
      setConfirmed(res.location);
      setRecovered(null);
      settle(res.attendanceDay);
    },
    onError: async (err: Error, direction) => {
      setRecovered(null);
      // A 4xx means the server refused and wrote nothing, so the next tap
      // measures afresh. Anything else may have been written: keep the same key
      // so a retry replays rather than duplicates.
      if (err instanceof ApiError && err.status < 500) delete attempts.current[direction];
      // Drop the local copy and re-read, so the screen shows what the server
      // holds rather than what this tab last saw.
      setDay(null);
      setConfirmed(null);
      setFailure(
        attempts.current[direction]
          ? `${err.message} Tap again to retry, it will not punch you twice.`
          : err.message,
      );
      await refreshBoard();

      // A lost response looks like a failure but the punch may have landed. Say
      // so, and stop offering a retry that the board no longer needs.
      const fresh = queryClient.getQueryData<AttendanceBoard>(workforceKeys.board());
      const mine = fresh?.employees.find((e) => e.employeeId === employeeId);
      const landed =
        direction === 'IN'
          ? mine?.state === 'IN' || mine?.state === 'ON_BREAK'
          : mine?.state === 'OUT';
      const transport = !(err instanceof ApiError) || err.status >= 500;
      if (landed && transport) {
        delete attempts.current[direction];
        setFailure(null);
        setRecovered(
          direction === 'IN'
            ? 'Your punch in did go through. You are punched in.'
            : 'Your punch out did go through. You are punched out.',
        );
      }
    },
  });

  const breakMutation = useMutation({
    mutationFn: (action: 'start' | 'end') => (action === 'start' ? startBreak({}) : endBreak()),
    onSuccess: (res) => settle(res),
    onError: (err: Error) => {
      // A break request that fails may still have landed (a lost response) or
      // be stale (a second tab). Show what the server holds, not what we guessed.
      setDay(null);
      setFailure(err.message);
      void refreshBoard();
    },
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
            {verification ? (
              <div className="flex justify-center pt-1">
                <VerificationBadge status={verification} />
              </div>
            ) : null}
            {rejected ? (
              <p role="status" className="text-sm text-danger">
                Your manager rejected today&apos;s attendance
                {row?.verificationNote ? `: ${row.verificationNote}` : '.'}
                <span className="mt-1 block">
                  Ask your manager to review it. You cannot punch again on this day.
                </span>
              </p>
            ) : null}
          </div>
        )}

        <Button
          type="button"
          className="min-h-[64px] w-full text-lg"
          disabled={busy || board.isLoading || rejected}
          onClick={() => punchMutation.mutate(nextDirection)}
        >
          {locating
            ? 'Finding your location...'
            : punchMutation.isPending
              ? 'Sending...'
              : nextDirection === 'IN'
                ? 'Punch in'
                : 'Punch out'}
        </Button>

        <p className="text-xs text-text-muted">
          {row ? `${row.outletCode}: ` : ''}your location is checked when you punch.
          {confirmed
            ? ` Last punch was ${confirmed.distanceM} m from the outlet (limit ${confirmed.radiusM} m).`
            : ''}
        </p>

        <Button
          type="button"
          variant="secondary"
          className="min-h-[52px] w-full"
          disabled={busy || board.isLoading || rejected || state === 'NOT_IN' || state === 'OUT'}
          onClick={() => breakMutation.mutate(state === 'ON_BREAK' ? 'end' : 'start')}
        >
          {breakMutation.isPending
            ? 'Sending...'
            : state === 'ON_BREAK'
              ? 'End break'
              : 'Start break'}
        </Button>

        {recovered ? (
          <p role="status" className="text-sm text-text-muted">
            {recovered}
          </p>
        ) : null}

        {failure ? (
          <p role="alert" className="text-sm text-danger">
            {failure}
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

      <Card className="space-y-1 p-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-text-muted">
          Attendance, last 365 days
        </h2>
        {summary.isLoading ? (
          <Skeleton className="h-10 w-40" />
        ) : summary.isError ? (
          <p role="alert" className="text-sm text-danger">
            {(summary.error as Error).message}
          </p>
        ) : summary.data ? (
          <>
            <p className="text-3xl font-semibold tabular-nums">
              {summary.data.attendancePercent === null
                ? 'N/A'
                : `${summary.data.attendancePercent}%`}
            </p>
            <p className="text-sm text-text-muted">
              {summary.data.verifiedPresentDays} verified present of {summary.data.eligibleDays}{' '}
              eligible days
              {summary.data.approvedLeaveDays > 0
                ? `, ${summary.data.approvedLeaveDays} on approved leave`
                : ''}
              {summary.data.pendingDays > 0
                ? `. ${summary.data.pendingDays} awaiting verification`
                : ''}
              {summary.data.rejectedDays > 0 ? `. ${summary.data.rejectedDays} rejected` : ''}.
            </p>
            {summary.data.attendancePercent === null ? (
              <p className="text-sm text-text-muted">
                No rostered working days yet, so there is nothing to measure.
              </p>
            ) : null}
          </>
        ) : null}
      </Card>

      {can('workforce.attendance.read') ? (
        <div className="flex flex-wrap gap-3">
          <Link className="inline-flex min-h-[44px] items-center text-sm underline" href="/attendance/board">
            Attendance board
          </Link>
          <Link className="inline-flex min-h-[44px] items-center text-sm underline" href="/attendance/history">
            Attendance history
          </Link>
          {can('workforce.attendance.verify') ? (
            <Link className="inline-flex min-h-[44px] items-center text-sm underline" href="/attendance/verify">
              Verify attendance
            </Link>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
