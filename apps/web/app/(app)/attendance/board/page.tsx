'use client';

import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { ErrorState } from '@/components/ui/error-state';
import { PageHeader } from '@/components/ui/page-header';
import { Skeleton } from '@/components/ui/skeleton';
import { longDate, time } from '@/lib/format';
import { getBoard, hm, liveWorkedMins, type PunchState } from '@/features/workforce/api';
import { workforceKeys } from '@/features/workforce/keys';

const FILTERS: { key: PunchState | 'ALL'; label: string }[] = [
  { key: 'ALL', label: 'Everyone' },
  { key: 'IN', label: 'On the floor' },
  { key: 'ON_BREAK', label: 'On break' },
  { key: 'OUT', label: 'Done' },
  { key: 'NOT_IN', label: 'Not in' },
];

const BADGE: Record<PunchState, { label: string; variant: string }> = {
  IN: { label: 'On the floor', variant: 'success' },
  ON_BREAK: { label: 'On break', variant: 'warning' },
  OUT: { label: 'Done for the day', variant: 'neutral' },
  NOT_IN: { label: 'Not in', variant: 'danger' },
};

export default function AttendanceBoardPage() {
  const [filter, setFilter] = useState<PunchState | 'ALL'>('ALL');
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  const board = useQuery({
    queryKey: workforceKeys.board(),
    queryFn: getBoard,
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
    staleTime: 15_000,
  });

  const rows = board.data?.employees ?? [];
  const counts = rows.reduce<Record<string, number>>((acc, r) => {
    acc[r.state] = (acc[r.state] ?? 0) + 1;
    return acc;
  }, {});
  const shown = filter === 'ALL' ? rows : rows.filter((r) => r.state === filter);

  return (
    <div className="space-y-4 p-4">
      <PageHeader
        title="Attendance board"
        subtitle={board.data ? longDate(`${board.data.businessDate}T00:00:00.000Z`) : undefined}
      />

      {/* A failed poll keeps the last good data on screen. A board that blanks
          itself is worse than a board that is thirty seconds old. */}
      {board.isError && board.data ? (
        <p className="text-sm text-amber-700">
          Last updated {time(new Date(now).toISOString())}, retrying.
        </p>
      ) : null}

      {board.isError && !board.data ? (
        <ErrorState
          title="Could not load the board"
          message={(board.error as Error).message}
          onRetry={() => void board.refetch()}
        />
      ) : null}

      <div className="flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <Button
            key={f.key}
            type="button"
            variant={filter === f.key ? 'primary' : 'secondary'}
            className="min-h-[44px]"
            onClick={() => setFilter(f.key)}
          >
            {f.label}
            {f.key === 'ALL' ? ` ${rows.length}` : ` ${counts[f.key] ?? 0}`}
          </Button>
        ))}
      </div>

      {board.isLoading ? (
        <div className="space-y-2">
          {[0, 1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-20 w-full" />
          ))}
        </div>
      ) : shown.length === 0 ? (
        <EmptyState
          title="Nobody matches this filter"
          description="Nobody is rostered or punched in here right now. Build the week's roster from the shifts screen."
        />
      ) : (
        <ul className="space-y-2">
          {shown.map((r) => (
            <li key={r.employeeId}>
              <Link href={`/attendance/history?employeeId=${r.employeeId}`}>
                <Card className="space-y-1 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-medium">{r.fullName}</p>
                      <p className="text-sm text-text-muted">{r.employeeCode}</p>
                    </div>
                    <Badge variant={BADGE[r.state].variant}>{BADGE[r.state].label}</Badge>
                  </div>
                  <p className="text-sm text-text">
                    {r.firstInAt ? `In ${time(r.firstInAt)}` : 'No punch yet'}
                    {r.firstInAt ? ` · ${hm(liveWorkedMins(r, now))}` : ''}
                    {r.breakMins > 0 ? ` · break ${hm(r.breakMins)}` : ''}
                  </p>
                  {r.lateMins > 0 ? (
                    <p className="text-sm text-amber-700">Late by {r.lateMins} min</p>
                  ) : null}
                </Card>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
