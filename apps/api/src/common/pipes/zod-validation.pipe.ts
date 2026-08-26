import { HttpStatus, Injectable, PipeTransform } from '@nestjs/common';
import { ZodSchema } from 'zod';
import { ERROR_CODES } from '@bobs-momo/shared';
import { DomainError } from '../errors/domain.error';

@Injectable()
export class ZodValidationPipe implements PipeTransform {
  constructor(private readonly schema: ZodSchema) {}

  transform(value: unknown): unknown {
    const result = this.schema.safeParse(value);
    if (result.success) return result.data;
    throw new DomainError(
      HttpStatus.BAD_REQUEST,
      ERROR_CODES.COMMON_VALIDATION_FAILED,
      'Check the highlighted fields',
      result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    );
  }
}
