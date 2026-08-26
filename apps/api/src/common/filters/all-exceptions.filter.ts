import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Request, Response } from 'express';
import { ERROR_CODES, type ApiErrorBody } from '@bobs-momo/shared';

interface DomainErrorShape {
  code: string;
  message: string;
  details?: unknown;
}

function isDomainShape(v: unknown): v is DomainErrorShape {
  return (
    typeof v === 'object' &&
    v !== null &&
    typeof (v as DomainErrorShape).code === 'string' &&
    typeof (v as DomainErrorShape).message === 'string'
  );
}

const STATUS_TO_CODE: Record<number, string> = {
  400: ERROR_CODES.COMMON_VALIDATION_FAILED,
  401: ERROR_CODES.AUTH_INVALID_CREDENTIALS,
  403: ERROR_CODES.COMMON_FORBIDDEN,
  404: ERROR_CODES.COMMON_NOT_FOUND,
  409: ERROR_CODES.COMMON_CONFLICT,
  429: ERROR_CODES.COMMON_RATE_LIMITED,
};

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request>();
    const requestId = (req.headers['x-request-id'] as string) ?? 'unknown';

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let code: string = ERROR_CODES.COMMON_INTERNAL;
    let message = 'Something went wrong';
    let details: unknown;

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const body = exception.getResponse();
      code = STATUS_TO_CODE[status] ?? ERROR_CODES.COMMON_INTERNAL;
      if (isDomainShape(body)) {
        code = body.code;
        message = body.message;
        details = body.details;
      } else if (typeof body === 'string') {
        message = body;
      } else if (typeof body === 'object' && body !== null && 'message' in body) {
        message = String((body as { message: unknown }).message);
      }
    } else if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      // P2002 unique violation, P2025 record not found. Everything else is ours.
      if (exception.code === 'P2002') {
        status = HttpStatus.CONFLICT;
        code = ERROR_CODES.COMMON_CONFLICT;
        message = 'That value is already taken';
        details = { target: exception.meta?.['target'] };
      } else if (exception.code === 'P2025') {
        status = HttpStatus.NOT_FOUND;
        code = ERROR_CODES.COMMON_NOT_FOUND;
        message = 'Not found';
      }
    }

    if (status >= 500) {
      this.logger.error(
        `${req.method} ${req.url} ${status} requestId=${requestId}`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    }

    const payload: ApiErrorBody = { error: { code, message, requestId } };
    if (details !== undefined) payload.error.details = details;
    res.status(status).json(payload);
  }
}
