import { Injectable, type NestMiddleware, type RawBodyRequest } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';

export const WEBHOOK_SUFFIX = '/whatsapp/webhook';

// express.json() defaults to 100kb. Meta status batches are a few hundred
// bytes, so anything near this is not a delivery receipt.
const MAX_BYTES = 100 * 1024;

function isWebhookPost(req: Request): boolean {
  if (req.method !== 'POST') return false;
  const url = req.originalUrl || req.url;
  const path = url.split('?')[0] ?? '';
  return path.endsWith(WEBHOOK_SUFFIX);
}

// Meta signs the exact bytes it sent. Parsing and re-serialising changes
// whitespace and key order, which breaks the HMAC, so the buffer has to be
// captured before any body parser touches the stream.
@Injectable()
export class WhatsappRawBodyMiddleware implements NestMiddleware {
  use(req: RawBodyRequest<Request>, res: Response, next: NextFunction): void {
    // readableEnded means a parser already drained the stream. The controller
    // falls back to the parsed body in that case rather than hanging here
    // waiting for an "end" event that has already fired.
    if (!isWebhookPost(req) || req.rawBody || req.readableEnded) {
      next();
      return;
    }

    const chunks: Buffer[] = [];
    let size = 0;
    let done = false;
    const finish = (): void => {
      if (done) return;
      done = true;
      next();
    };

    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BYTES) {
        req.destroy();
        res.status(413).end();
        done = true;
        return;
      }
      chunks.push(chunk);
    });

    req.on('end', () => {
      if (done) return;
      const raw = Buffer.concat(chunks);
      req.rawBody = raw;
      // The JSON parser downstream now finds an empty stream, so the parsed
      // body has to come from the same bytes the signature covers.
      try {
        req.body = raw.length ? (JSON.parse(raw.toString('utf8')) as unknown) : {};
      } catch {
        req.body = {};
      }
      finish();
    });

    req.on('error', finish);
  }
}
