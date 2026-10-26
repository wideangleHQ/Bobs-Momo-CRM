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
import { Select } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { useCan, useSession } from '@/lib/auth';
import { longDate, time } from '@/lib/format';
import {
  getAttendanceSummary,
  hm,
  listAttendance,
  type AttendanceDayRow,
  type VerificationStatus,
} from '@/features/workforce/api';
import { workforceKeys } from '@/features/workforce/keys';
import { PunchEditDialog } from '@/features/workforce/punch-edit-dialog';
import { VerificationBadge } from '@/features/workforce/verification-badge';
import { businessDateOffset } from '@bobs-momo/shared';

function isoDaysAgo(days: number): string {
  return businessDateOffset(-days).toISOString().slice(0, 10);
}

// Today plus the previous 364 business dates. The server enforces it too.
const WINDOW_START = () => isoDaysAgo(364);

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
  const { user } = useSession();
  const params = useSearchParams();
  const employeeId = params.get('employeeId') ?? undefined;
  // Someone who cannot see other people's attendance is looking at their own.
  const summaryEmployeeId =
    employeeId ?? (can('workforce.attendance.edit') ? undefined : (user?.employeeId ?? undefined));

  const [from, setFrom] = useState(() => isoDaysAgo(13));
  const [to, setTo] = useState(() => isoDaysAgo(0));
  const [page, setPage] = useState(1);
  const [verification, setVerification] = useState<VerificationStatus | ''>('');
  const [editing, setEditing] = useState<AttendanceDayRow | null>(null);

  const query = { from, to, page, pageSize: 25, employeeId, verification: verification || undefined };
  const history = useQuery({
    queryKey: workforceKeys.attendance(query),
    queryFn: () => listAttendance(query),
  });

  const summaryQuery = { employeeId: summaryEmployeeId, from, to };
  const summary = useQuery({
    queryKey: workforceKeys.summary(summaryQuery),
    queryFn: () => getAttendanceSummary(summaryQuery),
    enabled: Boolean(summaryEmployeeId),
  });

  const rows = history.data?.data ?? [];
  const meta = history.data?.meta;

  return (
    <div className="space-y-4 p-4">
      <PageHeader
        title="Attendance history"
        subtitle={
          can('workforce.attendance.edit')
            ? 'Review a day and correct it if it is wrong'
            : 'The last 365 days'
        }
      />

      <Card className="grid grid-cols-1 gap-3 p-4 sm:grid-cols-3">
        <div className="space-y-1">
          <Label htmlFor="from">From</Label>
          <Input
            id="from"
            type="date"
            min={WINDOW_START()}
            max={to}
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
            min={from}
            value={to}
            onChange={(e) => {
              setTo(e.target.value);
              setPage(1);
            }}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="verification">Verification</Label>
          <Select
            id="verification"
            value={verification}
            onChange={(e) => {
              setVerification(e.target.value as VerificationStatus | '');
              setPage(1);
            }}
          >
            <option value="">All</option>
            <option value="PENDING">Awaiting verification</option>
            <option value="VERIFIED">Verified</option>
            <option value="REJECTED">Rejected</option>
          </Select>
        </div>
        <Button
          type="button"
          variant="secondary"
          className="min-h-[44px] sm:col-span-3"
          onClick={() => {
            setFrom(WINDOW_START());
            setTo(isoDaysAgo(0));
            setPage(1);
          }}
        >
          Show the full 365 days
        </Button>
      </Card>

      {summaryEmployeeId ? (
        <Card className="space-y-1 p-4">
          {summary.isLoading ? (
            <Skeleton className="h-10 w-40" />
          ) : summary.isError ? (
            <p role="alert" className="text-sm text-danger">
              {(summary.error as Error).message}
            </p>
          ) : summary.data ? (
            <>
              <p className="text-2xl font-semibold tabular-nums">
                {summary.data.attendancePercent === null
                  ? 'N/A'
                  : `${summary.data.attendancePercent}%`}
                <span className="ml-2 text-sm font-normal text-text-muted">
                  {summary.data.verifiedPresentDays} verified present of {summary.data.eligibleDays}{' '}
                  eligible days in this range
                </span>
              </p>
              <p className="text-sm text-text-muted">
                {summary.data.approvedLeaveDays} on approved leave · {summary.data.pendingDays}{' '}
                awaiting verification · {summary.data.rejectedDays} rejected
              </p>
            </>
          ) : null}
        </Card>
      ) : null}

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
                  <div className="flex flex-col items-end gap-1">
                    <Badge variant={r.status === 'ABSENT' ? 'danger' : 'neutral'}>{r.status}</Badge>
                    <VerificationBadge status={r.verificationStatus} />
                  </div>
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
                {r.verificationStatus === 'REJECTED' && r.verificationNote ? (
                  <p className="text-sm text-danger">Reason: {r.verificationNote}</p>
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
