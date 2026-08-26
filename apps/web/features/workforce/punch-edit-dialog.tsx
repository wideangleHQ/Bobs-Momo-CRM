'use client';

import { useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { punchSchema } from '@bobs-momo/shared';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { punch } from '@/features/workforce/api';

interface Props {
  employeeId: string;
  employeeName: string;
  businessDate: string;
  onClose: () => void;
}

/**
 * A manager correction, not a silent fix. The punch is written with the
 * manager's id and their reason attached, and the audit log keeps both. An
 * unattributed edit is fraud, so there is no version of this form without the
 * reason field.
 */
export function PunchEditDialog({ employeeId, employeeName, businessDate, onClose }: Props) {
  const queryClient = useQueryClient();
  const [direction, setDirection] = useState<'IN' | 'OUT'>('IN');
  const [at, setAt] = useState(`${businessDate}T09:00`);
  const [reason, setReason] = useState('');
  const [problem, setProblem] = useState<string | null>(null);

  // One key for this correction, reused if the first attempt is lost.
  const key = useRef(crypto.randomUUID());

  const save = useMutation({
    mutationFn: (body: unknown) => punch(body, key.current),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['attendance'] });
      onClose();
    },
    onError: (err: Error) => setProblem(err.message),
  });

  const submit = () => {
    setProblem(null);
    const parsed = punchSchema.safeParse({
      direction,
      employeeId,
      at: new Date(at).toISOString(),
      reason: reason.trim(),
    });
    if (!parsed.success) {
      setProblem(parsed.error.issues[0]?.message ?? 'Check the form');
      return;
    }
    save.mutate(parsed.data);
  };

  return (
    <Dialog open onClose={onClose} title={`Correct a punch for ${employeeName}`}>
      <div className="space-y-4">
        <p className="text-sm text-text-muted">
          This writes a punch attributed to you. Your name, the time you set and the reason you give
          are stored in the audit log and stay readable to the owner.
        </p>

        <div className="space-y-1">
          <Label htmlFor="punch-direction">Direction</Label>
          <Select
            id="punch-direction"
            value={direction}
            onChange={(e) => setDirection(e.target.value === 'OUT' ? 'OUT' : 'IN')}
          >
            <option value="IN">Punched in</option>
            <option value="OUT">Punched out</option>
          </Select>
        </div>

        <div className="space-y-1">
          <Label htmlFor="punch-at">Time</Label>
          <Input
            id="punch-at"
            type="datetime-local"
            value={at}
            onChange={(e) => setAt(e.target.value)}
          />
        </div>

        <div className="space-y-1">
          <Label htmlFor="punch-reason">Reason, required</Label>
          <Textarea
            id="punch-reason"
            value={reason}
            rows={3}
            placeholder="Wifi was down at 09:00, Raju was on the floor"
            onChange={(e) => setReason(e.target.value)}
          />
          <p className="text-sm text-text-muted">
            Say what actually happened. The employee and the owner can both read this later, and a
            correction without a reason is the one thing this system will not accept.
          </p>
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
          <Button
            type="button"
            className="min-h-[44px] flex-1"
            disabled={save.isPending}
            onClick={submit}
          >
            {save.isPending ? 'Saving...' : 'Save correction'}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
