import { randomUUID } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { WHATSAPP_TEMPLATE_LANGUAGE, maskPhone } from '@bobs-momo/shared';
import {
  WhatsAppError,
  type MetaErrorBody,
  type WhatsAppProvider,
  type WhatsAppSendResult,
} from './whatsapp.types';

const GRAPH_VERSION = 'v21.0';

interface MetaSendResponse {
  messages?: Array<{ id: string }>;
  error?: MetaErrorBody;
}

@Injectable()
export class MetaCloudWhatsAppService implements WhatsAppProvider {
  private readonly url = `https://graph.facebook.com/${GRAPH_VERSION}/${process.env['WHATSAPP_PHONE_NUMBER_ID'] ?? ''}/messages`;

  async send(to: string, templateName: string, variables: string[]): Promise<WhatsAppSendResult> {
    const res = await fetch(this.url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env['WHATSAPP_ACCESS_TOKEN'] ?? ''}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: to.replace('+', ''),
        type: 'template',
        template: {
          name: templateName,
          language: { code: WHATSAPP_TEMPLATE_LANGUAGE },
          components: [
            { type: 'body', parameters: variables.map((v) => ({ type: 'text', text: v })) },
          ],
        },
      }),
    });

    const json = (await res.json().catch(() => ({}))) as MetaSendResponse;
    if (!res.ok) throw new WhatsAppError(res.status, json.error);

    const id = json.messages?.[0]?.id;
    if (!id) throw new WhatsAppError(res.status, { title: 'Meta returned no message id' });
    return { providerRef: id, accepted: true };
  }
}

// With WHATSAPP_ENABLED=false this is the only implementation in the container,
// so the dispatcher runs the same code path either way and no `if (enabled)`
// leaks into the notification engine.
@Injectable()
export class NullWhatsAppService implements WhatsAppProvider {
  private readonly log = new Logger('WhatsApp(stub)');

  send(to: string, templateName: string, variables: string[]): Promise<WhatsAppSendResult> {
    this.log.log(
      `[stub] would send ${templateName} to ${maskPhone(to)} vars=${JSON.stringify(variables)}`,
    );
    return Promise.resolve({ providerRef: `stub:${randomUUID()}`, accepted: true });
  }
}
