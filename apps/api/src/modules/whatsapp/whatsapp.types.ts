export const WHATSAPP_PROVIDER = Symbol('WHATSAPP_PROVIDER');

export interface WhatsAppSendResult {
  /** `wamid.HBgM...` from Meta, or `stub:<uuid>` from the null adapter. */
  providerRef: string;
  accepted: boolean;
}

// A template send is the only thing this system ever does, because the 24 hour
// customer service window is always closed: staff never message the ERP's
// number, so free-form text would come back as error 131047 every time.
export interface WhatsAppProvider {
  send(to: string, templateName: string, variables: string[]): Promise<WhatsAppSendResult>;
}

export interface MetaErrorBody {
  code?: number;
  title?: string;
  message?: string;
  error_data?: { details?: string };
}

export class WhatsAppError extends Error {
  readonly httpStatus: number;
  readonly code: number;
  readonly title: string;

  constructor(httpStatus: number, body: MetaErrorBody | undefined) {
    super(body?.message ?? body?.title ?? `WhatsApp send failed with HTTP ${httpStatus}`);
    this.name = 'WhatsAppError';
    this.httpStatus = httpStatus;
    this.code = body?.code ?? 0;
    this.title = body?.title ?? '';
  }

  /** 131026 covers both a transient send failure and a dead number. */
  get isTransient(): boolean {
    return !/not a whatsapp user/i.test(this.title);
  }
}

// Retry means the outbox backs off and tries again. Everything else marks the
// Notification FAILED and finishes the outbox row, because retrying an
// unapproved template just hammers Meta with the same rejection.
export function isRetryable(e: WhatsAppError): boolean {
  if (e.httpStatus === 429 || e.httpStatus >= 500) return true;
  return [131048, 131026].includes(e.code) && e.isTransient;
}
