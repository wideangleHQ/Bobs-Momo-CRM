import { Injectable, NestMiddleware } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

// The inbound value reaches both a response header and every log line, so it is
// never trusted as-is. A newline in it forges log entries; anything else fails
// the shape check and gets replaced rather than sanitised, so there is no
// escaping bug to get wrong later.
const SAFE_REQUEST_ID = /^[A-Za-z0-9._-]{8,64}$/;

@Injectable()
export class RequestIdMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    const supplied = req.headers['x-request-id'];
    const id =
      typeof supplied === 'string' && SAFE_REQUEST_ID.test(supplied) ? supplied : randomUUID();
    req.headers['x-request-id'] = id;
    res.setHeader('x-request-id', id);
    next();
  }
}
