import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Query,
  Req,
  Res,
  type RawBodyRequest,
} from '@nestjs/common';
import { ERROR_CODES } from '@bobs-momo/shared';
import type { Request, Response } from 'express';
import { Public } from '../../common/decorators/permissions.decorator';
import { DomainError } from '../../common/errors/domain.error';
import { WhatsappService } from './whatsapp.service';

// The only unauthenticated routes in the API. They verify Meta's signature
// instead of a JWT.
@Controller('whatsapp')
export class WhatsappController {
  constructor(private readonly service: WhatsappService) {}

  @Get('webhook')
  @Public()
  verify(@Query() query: Record<string, string | undefined>, @Res() res: Response): void {
    const challenge = query['hub.challenge'];
    if (query['hub.mode'] !== 'subscribe' || !this.service.verifyToken(query['hub.verify_token'])) {
      res.status(HttpStatus.FORBIDDEN).end();
      return;
    }
    res.type('text/plain').status(HttpStatus.OK).send(challenge ?? '');
  }

  @Post('webhook')
  @Public()
  // Meta treats anything but a fast 2xx as a failure and retries for 24 hours.
  @HttpCode(HttpStatus.OK)
  async receive(@Req() req: RawBodyRequest<Request>): Promise<{ received: true }> {
    // rawBody is what WhatsappRawBodyMiddleware captured. If some other body
    // parser got there first the bytes are gone and this is the best
    // reconstruction available, which only matches when the sender happened to
    // serialise canonically.
    const raw = req.rawBody ?? Buffer.from(JSON.stringify(req.body ?? {}), 'utf8');
    const header = req.headers['x-hub-signature-256'];

    if (!this.service.verifySignature(typeof header === 'string' ? header : undefined, raw)) {
      throw new DomainError(
        HttpStatus.UNAUTHORIZED,
        ERROR_CODES.AUTH_TOKEN_INVALID,
        'Signature mismatch',
      );
    }

    // Meta retries anything slower than a few seconds, so the retries pile up.
    // One indexed UPDATE per status stays inline; anything heavier goes through
    // the outbox.
    await this.service.applyStatuses(req.body);
    return { received: true };
  }
}
