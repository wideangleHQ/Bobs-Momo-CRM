'use client';

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { createLeaveSchema, LEAVE_TYPES } from '@bobs-momo/shared';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PageHeader } from '@/components/ui/page-header';
import { Textarea } from '@/components/ui/textarea';
import { createLeave, type LeaveType } from '@/features/workforce/api';

const TYPE_LABELS: Record<LeaveType, string> = {
  CASUAL: 'Casual',
  SICK: 'Sick',
  UNPAID: 'Unpaid',
  COMP_OFF: 'Comp off',
};

export default function RequestLeavePage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const today = new Date().toISOString().slice(0, 10);

  const [type, setType] = useState<LeaveType>('CASUAL');
  const [fromDate, setFromDate] = useState(today);
  const [toDate, setToDate] = useState(today);
  const [halfDay, setHalfDay] = useState(false);
  const [reason, setReason] = useState('');
  const [problem, setProblem] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: (body: unknown) => createLeave(body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['leave'] });
      router.push('/leave');
    },
    onError: (err: Error) => setProblem(err.message),
  });

  // A half day covers one date, so the end date stops being a question.
  const effectiveTo = halfDay ? fromDate : toDate;
  const dayCount = halfDay
    ? 0.5
    : Math.round(
        (Date.parse(`${effectiveTo}T00:00:00.000Z`) - Date.parse(`${fromDate}T00:00:00.000Z`)) /
          86_400_000,
      ) + 1;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setProblem(null);
    const parsed = createLeaveSchema.safeParse({
      type,
      fromDate,
      toDate: effectiveTo,
      halfDay,
      reason: reason.trim(),
    });
    if (!parsed.success) {
      setProblem(parsed.error.issues[0]?.message ?? 'Check the form');
      return;
    }
    save.mutate(parsed.data);
  };

  return (
    <div className="mx-auto w-full max-w-[560px] space-y-4 p-4">
      <PageHeader title="Request leave" />
      <Card className="p-4">
        <form className="space-y-4" onSubmit={submit}>
          <div className="space-y-2">
            <Label>Leave type</Label>
            <div className="flex flex-wrap gap-2">
              {LEAVE_TYPES.map((t) => (
                <Button
                  key={t}
                  type="button"
                  variant={type === t ? 'primary' : 'secondary'}
                  className="min-h-[44px]"
                  onClick={() => setType(t)}
                >
                  {TYPE_LABELS[t]}
                </Button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="fromDate">From</Label>
              <Input
                id="fromDate"
                type="date"
                value={fromDate}
                onChange={(e) => {
                  setFromDate(e.target.value);
                  if (e.target.value > toDate) setToDate(e.target.value);
                }}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="toDate">To</Label>
              <Input
                id="toDate"
                type="date"
                value={effectiveTo}
                disabled={halfDay}
                min={fromDate}
                onChange={(e) => setToDate(e.target.value)}
              />
            </div>
          </div>

          <label className="flex min-h-[44px] items-center gap-2 text-sm">
            <Checkbox
              checked={halfDay}
              onChange={(e) => {
                setHalfDay(e.target.checked);
                if (e.target.checked) setToDate(fromDate);
              }}
            />
            Half day, on the from date only
          </label>

          <p className="text-sm text-text-muted">
            {dayCount} day{dayCount === 1 ? '' : 's'}
          </p>

          <div className="space-y-1">
            <Label htmlFor="reason">Reason</Label>
            <Textarea
              id="reason"
              rows={3}
              maxLength={500}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
            <p className="text-sm text-text-muted">{reason.length} / 500</p>
          </div>

          {problem ? (
            <p role="alert" className="text-sm text-danger">
              {problem}
            </p>
          ) : null}

          <div className="flex gap-3">
            <Button
              type="button"
              variant="secondary"
              className="min-h-[48px] flex-1"
              onClick={() => router.push('/leave')}
            >
              Cancel
            </Button>
            <Button type="submit" className="min-h-[48px] flex-1" disabled={save.isPending}>
              {save.isPending ? 'Sending...' : 'Submit request'}
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
