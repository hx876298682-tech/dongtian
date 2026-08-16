import {
  Catch,
  HttpException,
  type ArgumentsHost,
  type ExceptionFilter,
} from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';

type StructuredError = {
  readonly code?: unknown;
  readonly message_key?: unknown;
  readonly details?: unknown;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

@Catch()
export class HttpErrorFilter implements ExceptionFilter {
  public catch(exception: unknown, host: ArgumentsHost): void {
    if (!(exception instanceof HttpException)) {
      console.error(
        'Unhandled HTTP exception.',
        exception instanceof Error ? `${exception.name}: ${exception.message}` : 'unknown',
      );
    }
    const context = host.switchToHttp();
    const response = context.getResponse<FastifyReply>();
    const request = context.getRequest<FastifyRequest>();
    const status = exception instanceof HttpException ? exception.getStatus() : 500;
    const exceptionResponse = exception instanceof HttpException ? exception.getResponse() : undefined;
    const structured = isRecord(exceptionResponse) ? (exceptionResponse as StructuredError) : undefined;
    const code = typeof structured?.code === 'string' ? structured.code : status >= 500 ? 'INTERNAL_ERROR' : 'HTTP_ERROR';
    const messageKey = typeof structured?.message_key === 'string' ? structured.message_key : `error.${code.toLowerCase()}`;
    const error: Record<string, unknown> = {
      code,
      message_key: messageKey,
      retryable: status >= 500,
    };

    if (structured?.['details'] !== undefined) {
      error['details'] = structured['details'];
    }

    response.status(status).send({
      error,
      meta: {
        request_id: String(request.id),
        server_time: new Date().toISOString(),
      },
    });
  }
}
