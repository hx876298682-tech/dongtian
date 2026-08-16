import { BadRequestException, ConflictException, Inject, Injectable } from '@nestjs/common';
import {
  type IdempotencyExecutionInput,
  type IdempotencyExecutor,
  IdempotencyInProgressError,
  IdempotencyKeyReusedError,
  type IdempotencyResult,
  type JsonValue,
} from '@dongtian/database';

import { idempotencyExecutorToken } from './idempotency.tokens.js';

@Injectable()
export class IdempotencyService {
  public constructor(
    @Inject(idempotencyExecutorToken) private readonly executor: IdempotencyExecutor,
  ) {}

  public execute<T extends JsonValue>(
    input: IdempotencyExecutionInput<T>,
  ): Promise<IdempotencyResult<T>> {
    return this.executor.execute(input).catch((error: unknown) => {
      if (error instanceof IdempotencyKeyReusedError) {
        throw new ConflictException({
          code: error.code,
          message_key: 'error.idempotency_key_reused',
        });
      }
      if (error instanceof IdempotencyInProgressError) {
        throw new ConflictException({
          code: error.code,
          message_key: 'error.idempotency_in_progress',
        });
      }
      if (error instanceof Error && error.message === 'IDEMPOTENCY_KEY_INVALID') {
        throw new BadRequestException({
          code: 'VALIDATION_ERROR',
          message_key: 'error.validation_error',
          details: { field: 'Idempotency-Key' },
        });
      }
      throw error;
    });
  }
}
