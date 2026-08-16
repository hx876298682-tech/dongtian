import {
  Inject,
  Injectable,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
} from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { map, type Observable } from 'rxjs';

import type { Environment } from '@dongtian/config-schema';

import { environmentToken } from '../environment.js';

type SuccessEnvelope = {
  readonly data: unknown;
  readonly meta: {
    readonly request_id: string;
    readonly server_time: string;
    readonly config_version: string;
    readonly state_version?: number;
  };
};

function stateVersionFromData(data: unknown): number | undefined {
  if (typeof data !== 'object' || data === null || !('character' in data)) {
    return undefined;
  }
  const character = data.character;
  if (typeof character !== 'object' || character === null || !('state_version' in character)) {
    return undefined;
  }
  const stateVersion = character.state_version;
  return typeof stateVersion === 'number' && Number.isSafeInteger(stateVersion)
    ? stateVersion
    : undefined;
}

@Injectable()
export class SuccessEnvelopeInterceptor implements NestInterceptor {
  public constructor(@Inject(environmentToken) private readonly environment: Environment) {}

  public intercept(context: ExecutionContext, next: CallHandler): Observable<SuccessEnvelope> {
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const requestId = String(request.id);

    return next.handle().pipe(
      map((data: unknown) => {
        const stateVersion = stateVersionFromData(data);
        return {
          data,
          meta: {
            request_id: requestId,
            server_time: new Date().toISOString(),
            config_version: this.environment.ACTIVE_CONFIG_VERSION,
            ...(stateVersion === undefined ? {} : { state_version: stateVersion }),
          },
        };
      }),
    );
  }
}
