import {
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';

import type { ConfigRegistry, Environment } from '@dongtian/config-schema';
import type {
  AuthRepository,
  AuthSessionRecord,
} from '@dongtian/database';

import { environmentToken } from '../environment.js';
import { configRegistryToken } from '../config/config.tokens.js';
import { authRepositoryToken } from './auth.tokens.js';

export const SESSION_COOKIE_NAME = 'dt_session';
export const CSRF_COOKIE_NAME = 'dt_csrf';

// The table requires a concrete expiry. This security-session TTL is independent of game time.
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1_000;
const DEFAULT_CHARACTER_NAME = '洞天散修';

type SessionData = {
  readonly account_id: string;
  readonly character_id: string;
  readonly account_type: AuthSessionRecord['accountType'];
  readonly account_status: AuthSessionRecord['accountStatus'];
  readonly csrf_token: string;
  readonly session_expires_at: string;
};

type AuthenticatedSessionData = SessionData & { readonly authenticated: true };

type AnonymousSessionData = Omit<SessionData, 'account_status'>;

function newToken(): string {
  return randomBytes(32).toString('base64url');
}

function hashToken(token: string, secret: string): string {
  return createHmac('sha256', secret).update(token).digest('hex');
}

function hashForComparison(value: string): Buffer {
  return createHash('sha256').update(value).digest();
}

function sameValue(left: string, right: string): boolean {
  const leftHash = hashForComparison(left);
  const rightHash = hashForComparison(right);
  return timingSafeEqual(leftHash, rightHash);
}

function headerValue(request: FastifyRequest, name: string): string | undefined {
  const value = request.headers[name];
  return typeof value === 'string' ? value : undefined;
}

function cookieValue(request: FastifyRequest, name: string): string | undefined {
  const value = request.cookies[name];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function unauthorized(): UnauthorizedException {
  return new UnauthorizedException({
    code: 'UNAUTHENTICATED',
    message_key: 'error.unauthenticated',
  });
}

function csrfFailure(): ForbiddenException {
  return new ForbiddenException({
    code: 'CSRF_VALIDATION_FAILED',
    message_key: 'error.csrf_validation_failed',
  });
}

@Injectable()
export class AuthService {
  public constructor(
    @Inject(authRepositoryToken) private readonly repository: AuthRepository,
    @Inject(environmentToken) private readonly environment: Environment,
    @Inject(configRegistryToken) private readonly configRegistry: ConfigRegistry,
  ) {}

  public async createAnonymous(
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<AnonymousSessionData> {
    this.assertOrigin(request);
    const existing = await this.resolveSession(request);

    if (existing) {
      this.assertCsrf(request, existing);
      const csrfToken = await this.ensureCsrfToken(existing, request);
      await this.repository.touchSession(existing.sessionId, new Date());
      const character = await this.repository.ensureDefaultCharacter(
        existing.accountId,
        this.defaultCharacterInput(),
      );
      reply.code(200);
      this.setCookies(reply, cookieValue(request, SESSION_COOKIE_NAME) ?? '', csrfToken, existing.expiresAt);
      return this.toAnonymousData(existing, csrfToken, character.characterId);
    }

    const sessionToken = newToken();
    const csrfToken = newToken();
    const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
    const created = await this.repository.createAnonymousSession({
      sessionTokenHash: hashToken(sessionToken, this.environment.SESSION_SECRET),
      csrfTokenHash: hashToken(csrfToken, this.environment.CSRF_SECRET),
      expiresAt,
      defaultCharacter: this.defaultCharacterInput(),
    });

    this.setCookies(reply, sessionToken, csrfToken, created.expiresAt);
    return {
      account_id: created.accountId,
      character_id: created.characterId,
      account_type: created.accountType,
      csrf_token: csrfToken,
      session_expires_at: created.expiresAt.toISOString(),
    };
  }

  public async getSession(
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<AuthenticatedSessionData | { readonly authenticated: false }> {
    const session = await this.resolveSession(request);
    if (!session) {
      return { authenticated: false };
    }

    const csrfToken = await this.ensureCsrfToken(session, request);
    await this.repository.touchSession(session.sessionId, new Date());
    const character = await this.repository.ensureDefaultCharacter(
      session.accountId,
      this.defaultCharacterInput(),
    );
    const sessionToken = cookieValue(request, SESSION_COOKIE_NAME);
    if (sessionToken) {
      this.setCookies(reply, sessionToken, csrfToken, session.expiresAt);
    }
    return {
      ...this.toSessionData(session, csrfToken, character.characterId),
      authenticated: true,
    };
  }

  public async logout(request: FastifyRequest, reply: FastifyReply): Promise<{ readonly logged_out: true }> {
    this.assertOrigin(request);
    const sessionToken = cookieValue(request, SESSION_COOKIE_NAME);
    const session = await this.resolveSession(request);
    if (!sessionToken || !session) {
      this.clearCookies(reply);
      throw unauthorized();
    }

    this.assertCsrf(request, session);
    await this.repository.revokeSession(
      hashToken(sessionToken, this.environment.SESSION_SECRET),
      new Date(),
    );
    this.clearCookies(reply);
    return { logged_out: true };
  }

  public async assertCharacterOwnership(
    request: FastifyRequest,
    characterId: string,
  ): Promise<void> {
    const session = await this.resolveSession(request);
    if (!session) {
      throw unauthorized();
    }

    if (!(await this.repository.characterBelongsToAccount(characterId, session.accountId))) {
      throw new NotFoundException({
        code: 'RESOURCE_NOT_FOUND',
        message_key: 'error.resource_not_found',
      });
    }
  }

  public async requireWriteAccess(request: FastifyRequest): Promise<string> {
    const session = await this.resolveSession(request);
    if (!session) {
      throw unauthorized();
    }
    this.assertOrigin(request);
    this.assertCsrf(request, session);
    return session.accountId;
  }

  public async requireCurrentAccountId(request: FastifyRequest): Promise<string> {
    const session = await this.resolveSession(request);
    if (!session) {
      throw unauthorized();
    }
    return session.accountId;
  }

  public async requireCurrentCharacterId(request: FastifyRequest): Promise<string> {
    const session = await this.resolveSession(request);
    if (!session) {
      throw unauthorized();
    }
    const character = await this.repository.ensureDefaultCharacter(
      session.accountId,
      this.defaultCharacterInput(),
    );
    return character.characterId;
  }

  private async resolveSession(request: FastifyRequest): Promise<AuthSessionRecord | null> {
    const sessionToken = cookieValue(request, SESSION_COOKIE_NAME);
    if (!sessionToken || sessionToken.length > 256) {
      return null;
    }

    return this.repository.findActiveSession(
      hashToken(sessionToken, this.environment.SESSION_SECRET),
      new Date(),
    );
  }

  private async ensureCsrfToken(session: AuthSessionRecord, request: FastifyRequest): Promise<string> {
    const current = cookieValue(request, CSRF_COOKIE_NAME);
    if (current && current.length <= 256) {
      const currentHash = hashToken(current, this.environment.CSRF_SECRET);
      if (sameValue(currentHash, session.csrfTokenHash)) {
        return current;
      }
    }

    const next = newToken();
    const rotated = await this.repository.rotateCsrfToken(
      session.sessionId,
      hashToken(next, this.environment.CSRF_SECRET),
      new Date(),
    );
    if (!rotated) {
      throw unauthorized();
    }
    return next;
  }

  private assertOrigin(request: FastifyRequest): void {
    if (headerValue(request, 'origin') !== this.environment.WEB_ORIGIN) {
      throw csrfFailure();
    }
  }

  private assertCsrf(request: FastifyRequest, session: AuthSessionRecord): void {
    const header = headerValue(request, 'x-csrf-token');
    const cookie = cookieValue(request, CSRF_COOKIE_NAME);
    if (!header || !cookie || header.length > 256 || cookie.length > 256 || !sameValue(header, cookie)) {
      throw csrfFailure();
    }

    const headerHash = hashToken(header, this.environment.CSRF_SECRET);
    if (!sameValue(headerHash, session.csrfTokenHash)) {
      throw csrfFailure();
    }
  }

  private setCookies(reply: FastifyReply, sessionToken: string, csrfToken: string, expiresAt: Date): void {
    const secure = this.environment.NODE_ENV === 'production' || this.environment.APP_ENV === 'production';
    const cookieOptions = {
      path: '/',
      sameSite: 'lax' as const,
      secure,
      expires: expiresAt,
    };
    reply.setCookie(SESSION_COOKIE_NAME, sessionToken, { ...cookieOptions, httpOnly: true });
    reply.setCookie(CSRF_COOKIE_NAME, csrfToken, { ...cookieOptions, httpOnly: false });
  }

  private clearCookies(reply: FastifyReply): void {
    const secure = this.environment.NODE_ENV === 'production' || this.environment.APP_ENV === 'production';
    const cookieOptions = { path: '/', sameSite: 'lax' as const, secure };
    reply.clearCookie(SESSION_COOKIE_NAME, { ...cookieOptions, httpOnly: true });
    reply.clearCookie(CSRF_COOKIE_NAME, { ...cookieOptions, httpOnly: false });
  }

  private defaultCharacterInput() {
    return {
      name: DEFAULT_CHARACTER_NAME,
      realmStageId: this.configRegistry.getRealm('realm.mortal.entry').id,
      activeConfigVersion: this.configRegistry.manifest.config_version,
      skillIds: this.configRegistry.skills.map((skill) => skill.id),
    } as const;
  }

  private toAnonymousData(
    session: AuthSessionRecord,
    csrfToken: string,
    characterId: string,
  ): AnonymousSessionData {
    return {
      account_id: session.accountId,
      character_id: characterId,
      account_type: session.accountType,
      csrf_token: csrfToken,
      session_expires_at: session.expiresAt.toISOString(),
    };
  }

  private toSessionData(
    session: AuthSessionRecord,
    csrfToken: string,
    characterId: string,
  ): SessionData {
    return {
      account_id: session.accountId,
      character_id: characterId,
      account_type: session.accountType,
      account_status: session.accountStatus,
      csrf_token: csrfToken,
      session_expires_at: session.expiresAt.toISOString(),
    };
  }
}
