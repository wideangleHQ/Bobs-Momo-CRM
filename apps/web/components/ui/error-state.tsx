import { Button } from './button';
import { Icon } from './icons';

/**
 * The message comes from the API envelope. The backend copy is written for
 * staff to read, so a generic line here would be a downgrade.
 */
export function ErrorState({
  title = 'Could not load this',
  message,
  requestId,
  onRetry,
}: {
  title?: string;
  message: string;
  requestId?: string;
  onRetry?: () => void;
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-lg border border-danger/30 bg-danger-bg px-6 py-12 text-center">
      <Icon name="alert" className="mb-3 h-7 w-7 text-danger" />
      <h2 className="text-base font-semibold text-text">{title}</h2>
      <p className="mt-2 max-w-sm text-sm text-text">{message}</p>
      {requestId ? (
        <p className="mt-2 text-xs text-text-muted">
          Reference <span className="select-all font-mono">{requestId}</span>
        </p>
      ) : null}
      {onRetry ? (
        <div className="mt-6 w-full max-w-xs">
          <Button variant="secondary" fullWidth size="lg" onClick={onRetry}>
            Try again
          </Button>
        </div>
      ) : null}
    </div>
  );
}
