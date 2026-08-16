import { ForbiddenException, NotFoundException } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import {
  loadConfigRegistry,
  parseEnvironment,
  type ConfigRegistry,
  type Environment,
} from '@dongtian/config-schema';
import type { AuthRepository, AuthSessionRecord, CreatedAnonymousSession } from '@dongtian/database';

import {
  AuthService,
  CSRF_COOKIE_NAME,
  SESSION_COOKIE_NAME,
} from './auth.service.js';

type CookieJar = Record<string, string>;

type ReplyMock = FastifyReply & {
  readonly cookies: CookieJar;
  readonly cookieOptions: Record<string, Record<string, unknown>>;
  readonly statusCode: number;
};

function makeReply(): ReplyMock {
  const reply = {
    cookies: {},
    cookieOptions: {},
    statusCode: 200,
    code(statusCode: number) {
      reply.statusCode = statusCode;
      return reply;
    },
    setCookie(name: string, value: string, options: Record<string, unknown>) {
      reply.cookies[name] = value;
      reply.cookieOptions[name] = options;
      return reply;
    },
    clearCookie(name: string) {
      delete reply.cookies[name];
      return reply;
    },
  } as unknown as ReplyMock;
  return reply;
}

function makeRequest(environment: Environment, cookies: CookieJar = {}): FastifyRequest {
  return {
    headers: { origin: environment.WEB_ORIGIN },
    cookies,
  } as unknown as FastifyRequest;
}

function makeRepository(): AuthRepository {
  const sessions = new Map<string, AuthSessionRecord & { readonly sessionTokenHash: string }>();
  let accountNumber = 0;
  let sessionNumber = 0;
  const characterOwners = new Map<string, string>([['character-1', 'account-1']]);

  return {
    async createAnonymousSession(input): Promise<CreatedAnonymousSession> {
      accountNumber += 1;
      sessionNumber += 1;
      const accountId = `account-${accountNumber}`;
      const sessionId = `session-${sessionNumber}`;
      sessions.set(input.sessionTokenHash, {
        sessionId,
        accountId,
        accountType: 'ANONYMOUS',
        accountStatus: 'ACTIVE',
        csrfTokenHash: input.csrfTokenHash,
        expiresAt: input.expiresAt,
        sessionTokenHash: input.sessionTokenHash,
      });
      return {
        sessionId,
        accountId,
        characterId: `character-${accountNumber}`,
        accountType: 'ANONYMOUS',
        accountStatus: 'ACTIVE',
        expiresAt: input.expiresAt,
      };
    },
    async ensureDefaultCharacter(accountId) {
      return { characterId: `character-${accountId.replace('account-', '')}` };
    },
    async findActiveSession(sessionTokenHash, now) {
      const session = sessions.get(sessionTokenHash);
      return session && session.expiresAt > now && session.accountStatus === 'ACTIVE'
        ? { ...session }
        : null;
    },
    async touchSession() {},
    async rotateCsrfToken(sessionId, csrfTokenHash, now) {
      for (const [tokenHash, session] of sessions) {
        if (session.sessionId === sessionId && session.expiresAt > now) {
          sessions.set(tokenHash, { ...session, csrfTokenHash });
          return true;
        }
      }
      return false;
    },
    async revokeSession(sessionTokenHash) {
      return sessions.delete(sessionTokenHash);
    },
    async characterBelongsToAccount(characterId, accountId) {
      return characterOwners.get(characterId) === accountId;
    },
  };
}

function makeEnvironment(): Environment {
  return parseEnvironment({
    NODE_ENV: 'test',
    APP_ENV: 'test',
    WEB_ORIGIN: 'https://web.test',
  });
}

function makeRegistry(): ConfigRegistry {
  return loadConfigRegistry({
    releasesRoot: fileURLToPath(new URL('../../../../config/releases', import.meta.url)),
    version: '2026.08.16.1',
  });
}

function makeService(environment: Environment): AuthService {
  return new AuthService(makeRepository(), environment, makeRegistry());
}

describe('AuthService', () => {
  it('returns the same anonymous identity for a repeated request and sets secure cookie attributes', async () => {
    const environment = makeEnvironment();
    const service = makeService(environment);
    const firstReply = makeReply();
    const firstRequest = makeRequest(environment);

    const first = await service.createAnonymous(firstRequest, firstReply);
    const secondRequest = makeRequest(environment, firstReply.cookies);
    secondRequest.headers['x-csrf-token'] = first.csrf_token;
    const secondReply = makeReply();
    const second = await service.createAnonymous(secondRequest, secondReply);

    expect(second.account_id).toBe(first.account_id);
    expect(second.character_id).toBe(first.character_id);
    expect(second.account_type).toBe('ANONYMOUS');
    expect(secondReply.statusCode).toBe(200);
    expect(secondReply.cookieOptions[SESSION_COOKIE_NAME]).toMatchObject({
      httpOnly: true,
      secure: false,
      sameSite: 'lax',
      path: '/',
    });
    expect(secondReply.cookieOptions[CSRF_COOKIE_NAME]).toMatchObject({
      httpOnly: false,
      secure: false,
      sameSite: 'lax',
      path: '/',
    });
  });

  it('rejects a state-changing request without a matching Origin and CSRF double-submit token', async () => {
    const environment = makeEnvironment();
    const service = makeService(environment);
    const reply = makeReply();
    const request = makeRequest(environment);
    const created = await service.createAnonymous(request, reply);
    const csrfRequest = makeRequest(environment, reply.cookies);

    await expect(service.logout(csrfRequest, makeReply())).rejects.toBeInstanceOf(ForbiddenException);

    const wrongOriginRequest = makeRequest(environment, reply.cookies);
    wrongOriginRequest.headers.origin = 'https://attacker.test';
    wrongOriginRequest.headers['x-csrf-token'] = created.csrf_token;
    await expect(service.logout(wrongOriginRequest, makeReply())).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('revokes the session on logout and no longer authenticates it', async () => {
    const environment = makeEnvironment();
    const service = makeService(environment);
    const reply = makeReply();
    const request = makeRequest(environment);
    const created = await service.createAnonymous(request, reply);
    const authenticatedRequest = makeRequest(environment, reply.cookies);
    authenticatedRequest.headers['x-csrf-token'] = created.csrf_token;

    await expect(service.logout(authenticatedRequest, makeReply())).resolves.toEqual({ logged_out: true });
    await expect(service.getSession(authenticatedRequest, makeReply())).resolves.toEqual({
      authenticated: false,
    });
  });

  it('hides a character owned by another account as a 404', async () => {
    const environment = makeEnvironment();
    const repository = makeRepository();
    const service = new AuthService(repository, environment, makeRegistry());
    const firstReply = makeReply();
    const first = await service.createAnonymous(makeRequest(environment), firstReply);
    const firstRequest = makeRequest(environment, firstReply.cookies);
    firstRequest.headers['x-csrf-token'] = first.csrf_token;
    await expect(service.assertCharacterOwnership(firstRequest, 'character-1')).resolves.toBeUndefined();

    const secondReply = makeReply();
    await service.createAnonymous(makeRequest(environment), secondReply);
    await expect(
      service.assertCharacterOwnership(makeRequest(environment, secondReply.cookies), 'character-1'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
