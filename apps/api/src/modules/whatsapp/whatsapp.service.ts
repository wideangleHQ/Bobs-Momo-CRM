import { createHmac, timingSafeEqual } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { toE164India, whatsappTemplateFor } from '@bobs-momo/shared';
import { PrismaService } from '../../common/prisma/prisma.service';
import {
  WHATSAPP_PROVIDER,
  type WhatsAppProvider,
  type WhatsAppSendResult,
} from './whatsapp.types';

// Notification.status only ever moves forward. Meta retries for up to 24 hours
// and does not guarantee ordering, so `delivered` can land before `sent`.
const STATUS_RANK = { QUEUED: 0, SENT: 1, DELIVERED: 2, FAILED: 3, SUPPRESSED: 3 } as const;

type MappedStatus = 'SENT' | 'DELIVERED' | 'FAILED';

// The enum has no READ state. The raw Meta value is kept in payload.metaStatus.
const META_TO_STATUS: Record<string, MappedStatus> = {
  sent: 'SENT',
  delivered: 'DELIVERED',
  read: 'DELIVERED',
  failed: 'FAILED',
};

interface MetaStatusEntry {
  id?: unknown;
  status?: unknown;
  errors?: Array<{ code?: unknown; title?: unknown }>;
}

interface MetaWebhookBody {
  entry?: Array<{ changes?: Array<{ value?: { statuses?: MetaStatusEntry[] } }> }>;
}

function timingSafeEqualStr(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  // Length is not a secret, and timingSafeEqual throws on a length mismatch.
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

@Injectable()
export class WhatsappService {
  private readonly log = new Logger(WhatsappService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(WHATSAPP_PROVIDER) private readonly provider: WhatsAppProvider,
  ) {}

  /**
   * Sends one approved template. Returns null when the recipient's phone will
   * not normalise, which the caller records as a SUPPRESSED notification with
   * failReason INVALID_PHONE rather than delivering to a stranger.
   */
  async sendTemplate(
    rawPhone: string,
    eventKey: string,
    variables: string[],
  ): Promise<WhatsAppSendResult | null> {
    const to = toE164India(rawPhone);
    if (!to) return null;

    const template = whatsappTemplateFor(eventKey);
    if (!template) throw new Error(`No WhatsApp template registered for ${eventKey}`);
    if (template.variables !== variables.length) {
      // Meta answers this with error 132000. Failing here names the template.
      throw new Error(
        `Template ${template.name} takes ${template.variables} variables, got ${variables.length}`,
      );
    }

    return this.provider.send(to, template.name, variables);
  }

  verifyToken(supplied: string | undefined): boolean {
    const expected = process.env['WHATSAPP_VERIFY_TOKEN'];
    if (!expected || !supplied) return false;
    return timingSafeEqualStr(supplied, expected);
  }

  verifySignature(header: string | undefined, raw: Buffer): boolean {
    const secret = process.env['WHATSAPP_APP_SECRET'];
    // Fail closed. An unconfigured secret must not mean "accept everything".
    if (!secret || !header) return false;
    const expected = `sha256=${createHmac('sha256', secret).update(raw).digest('hex')}`;
    return timingSafeEqualStr(header, expected);
  }

  /**
   * One indexed UPDATE per status entry, so the handler can answer 200 inline.
   * An unknown providerRef, a repeat, or a status that moves backwards all
   * match zero rows and are no-ops.
   */
  async applyStatuses(body: unknown): Promise<number> {
    const entries = (body as MetaWebhookBody | null)?.entry ?? [];
    let applied = 0;

    for (const entry of entries) {
      for (const change of entry.changes ?? []) {
        for (const status of change.value?.statuses ?? []) {
          const providerRef = typeof status.id === 'string' ? status.id : null;
          const metaStatus = typeof status.status === 'string' ? status.status : '';
          const mapped = META_TO_STATUS[metaStatus];
          if (!providerRef || !mapped) continue;

          const first = status.errors?.[0];
          const failReason =
            mapped === 'FAILED'
              ? `${String(first?.code ?? 'unknown')}: ${String(first?.title ?? 'send failed')}`.slice(0, 200)
              : null;

          applied += await this.prisma.$executeRaw`
            UPDATE "Notification"
            SET status = ${mapped}::"NotificationStatus",
                payload = jsonb_set(
                  coalesce(payload, '{}'::jsonb), '{metaStatus}', to_jsonb(${metaStatus}::text)
                ),
                "failReason" = coalesce(${failReason}::text, "failReason"),
                "sentAt" = coalesce("sentAt", now())
            WHERE "providerRef" = ${providerRef}
              AND ${STATUS_RANK[mapped]}::int > CASE status
                    WHEN 'QUEUED' THEN 0 WHEN 'SENT' THEN 1
                    WHEN 'DELIVERED' THEN 2 ELSE 3 END
          `;
        }
      }
    }

    if (applied > 0) this.log.debug(`webhook advanced ${applied} notification(s)`);
    return applied;
  }
}
