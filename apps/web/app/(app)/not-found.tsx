import Link from 'next/link';
import { EmptyState } from '@/components/ui';

export default function AppNotFound() {
  return (
    <div className="p-4">
      <EmptyState
        title="That page does not exist"
        description="The link may be out of date, or the record may have been removed."
        action={
          <Link
            href="/dashboard"
            className="inline-flex h-12 items-center rounded-lg bg-primary px-5 font-medium text-primary-fg"
          >
            Go to the dashboard
          </Link>
        }
      />
    </div>
  );
}
