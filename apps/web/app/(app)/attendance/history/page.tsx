'use client';

import { Suspense, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'next/navigation';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { ErrorState } from '@/components/ui/error-state';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PageHeader } from '@/components/ui/page-header';
import { Skeleton } from '@/components/ui/skeleton';
import { useCan } from '@/lib/auth';
import { longDate, time } from '@/lib/format';
import { hm, listAttendance, type AttendanceDayRow } from '@/features/workforce/api';
import { workforceKeys } from '@/features/workforce/keys';
import { PunchEditDialog } from '@/features/workforce/punch-edit-dialog';
import { businessDateOffset } from '@bobs-momo/shared';

function isoDaysAgo(days: number): string {
  return businessDateOffset(-days).toISOString().slice(0, 10);
}

export default function AttendanceHistoryPage() {
  // useSearchParams needs a boundary or the whole route opts out of prerender.
  return (
    <Suspense fallback={<Skeleton className="m-4 h-64 w-full" />}>
      <AttendanceHistory />
    </Suspense>
  );
}

function AttendanceHistory() {
  const can = useCan();
  const params = useSearchParams();
  const employeeId = params.get('employeeId') ?? undefined;

  const [from, setFrom] = useState(() => isoDaysAgo(13));
  const [to, setTo] = useState(() => isoDaysAgo(0));
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<AttendanceDayRow | null>(null);

  const query = { from, to, page, pageSize: 25, employeeId };
  const history = useQuery({
    queryKey: workforceKeys.attendance(query),
    queryFn: () => listAttendance(query),
  });

  const rows = history.data?.data ?? [];
  const meta = history.data?.meta;

  return (
    <div className="space-y-4 p-4">
      <PageHeader title="Attendance history" subtitle="Review a day and correct it if it is wrong" />

      <Card className="grid grid-cols-1 gap-3 p-4 sm:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor="from">From</Label>
          <Input
            id="from"
            type="date"
            value={from}
            onChange={(e) => {
              setFrom(e.target.value);
              setPage(1);
            }}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="to">To</Label>
          <Input
            id="to"
            type="date"
            value={to}
            onChange={(e) => {
              setTo(e.target.value);
              setPage(1);
            }}
          />
        </div>
      </Card>

      {history.isLoading ? (
        <div className="space-y-2">
          {[0, 1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-24 w-full" />
          ))}
        </div>
      ) : history.isError ? (
        <ErrorState
          title="Could not load attendance"
          message={(history.error as Error).message}
          onRetry={() => void history.refetch()}
        />
      ) : rows.length === 0 ? (
        <EmptyState
          title="No attendance in this range"
          description="Widen the dates, or check that somebody was rostered on these days."
        />
      ) : (
        <ul className="space-y-2">
          {rows.map((r) => (
            <li key={r.id}>
              <Card className="space-y-2 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-medium">{r.employeeName}</p>
                    <p className="text-sm text-text-muted">
                      {longDate(`${r.businessDate}T00:00:00.000Z`)}
                    </p>
                  </div>
                  <Badge variant={r.status === 'ABSENT' ? 'danger' : 'neutral'}>{r.status}</Badge>
                </div>
                <p className="text-sm text-text">
                  {r.firstInAt ? `In ${time(r.firstInAt)}` : 'No in punch'}
                  {r.lastOutAt ? ` · out ${time(r.lastOutAt)}` : ''}
                  {` · worked ${hm(r.workedMins)}`}
                  {r.breakMins > 0 ? ` · break ${hm(r.breakMins)}` : ''}
                </p>
                {r.lateMins > 0 ? (
                  <p className="text-sm text-amber-700">Late by {r.lateMins} min</p>
                ) : null}
                {can('workforce.attendance.edit') ? (
                  <Button
                    type="button"
                    variant="secondary"
                    className="min-h-[44px] w-full sm:w-auto"
                    onClick={() => setEditing(r)}
                  >
                    Correct this day
                  </Button>
                ) : null}
              </Card>
            </li>
          ))}
        </ul>
      )}

      {meta && meta.totalPages > 1 ? (
        <div className="flex items-center justify-between gap-3">
          <Button
            type="button"
            variant="secondary"
            className="min-h-[44px]"
            disabled={page <= 1}
            onClick={() => setPage((p) => p - 1)}
          >
            Previous
          </Button>
          <span className="text-sm text-text-muted">
            Page {meta.page} of {meta.totalPages}
          </span>
          <Button
            type="button"
            variant="secondary"
            className="min-h-[44px]"
            disabled={page >= meta.totalPages}
            onClick={() => setPage((p) => p + 1)}
          >
            Next
          </Button>
        </div>
      ) : null}

      {editing ? (
        <PunchEditDialog
          employeeId={editing.employeeId}
          employeeName={editing.employeeName}
          businessDate={editing.businessDate}
          onClose={() => setEditing(null)}
        />
      ) : null}
    </div>
  );
}
