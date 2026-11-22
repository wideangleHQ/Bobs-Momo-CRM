import { Badge } from '@/components/ui/badge';
import type { VerificationStatus } from './api';

const LABEL: Record<VerificationStatus, { text: string; tone: 'warning' | 'success' | 'danger' }> = {
  PENDING: { text: 'Awaiting verification', tone: 'warning' },
  VERIFIED: { text: 'Verified', tone: 'success' },
  REJECTED: { text: 'Rejected', tone: 'danger' },
};

/** Null means the day was never submitted for verification, so it shows nothing. */
export function VerificationBadge({ status }: { status: VerificationStatus | null }) {
  if (!status) return null;
  const { text, tone } = LABEL[status];
  return <Badge tone={tone}>{text}</Badge>;
}
