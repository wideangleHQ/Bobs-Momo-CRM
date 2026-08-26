import { Badge, type BadgeTone } from '@/components/ui/badge';

const TONES: Record<string, BadgeTone> = {
  PENDING: 'warning',
  APPROVED: 'success',
  FULFILLED: 'neutral',
  REJECTED: 'danger',
  CANCELLED: 'neutral',
  RECORDED: 'success',
  VOIDED: 'danger',
  DRAFT: 'neutral',
};

/** Colour is never the only signal, so the word itself carries the meaning. */
export function StatusPill({ status }: { status: string }) {
  return <Badge tone={TONES[status] ?? 'neutral'}>{status.toLowerCase()}</Badge>;
}
