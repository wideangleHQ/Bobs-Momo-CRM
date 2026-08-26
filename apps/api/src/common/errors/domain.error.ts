import { HttpException, HttpStatus } from '@nestjs/common';
import type { ErrorCode } from '@bobs-momo/shared';

// Every thrown business error carries a registry code. AllExceptionsFilter
// reads code/message/details straight off the response body.
export class DomainError extends HttpException {
  constructor(status: HttpStatus, code: ErrorCode | string, message: string, details?: unknown) {
    super({ code, message, details }, status);
  }

  static notFound(message = 'Not found'): DomainError {
    return new DomainError(HttpStatus.NOT_FOUND, 'COMMON_NOT_FOUND', message);
  }

  static forbidden(message = 'Not allowed'): DomainError {
    return new DomainError(HttpStatus.FORBIDDEN, 'COMMON_FORBIDDEN', message);
  }

  static conflict(code: string, message: string, details?: unknown): DomainError {
    return new DomainError(HttpStatus.CONFLICT, code, message, details);
  }

  static badRequest(code: string, message: string, details?: unknown): DomainError {
    return new DomainError(HttpStatus.BAD_REQUEST, code, message, details);
  }
}
