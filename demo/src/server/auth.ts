import { createHmac, createPublicKey, timingSafeEqual, verify as verifySignature } from 'node:crypto';
import type { JsonWebKey as CryptoJsonWebKey, KeyObject } from 'node:crypto';
import { ApiError } from './types.ts';

type JwtHeader = { alg?: unknown; typ?: unknown; kid?: unknown };
type JwtClaims = { sub?: unknown; exp?: unknown; nbf?: unknown; iss?: unknown; aud?: unknown; role?: unknown; roles?: unknown };
export type AuthIdentity = { subject: string; roles: string[] };
export type AuthProviderBackend = 'hs256' | 'jwks' | 'insecure' | 'unconfigured';
export type AuthProvider = { readonly backend: AuthProviderBackend; authenticate(token: string): Promise<AuthIdentity> };
export class AuthConfigurationError extends Error {
  constructor(message: string) { super(message); this.name = 'AuthConfigurationError'; }
}

const decodeBytes = (part: string, label: string): Buffer => {
  if (!/^[A-Za-z0-9_-]+$/.test(part)) throw new ApiError('AUTH_REQUIRED', `JWT ${label} is malformed`);
  const normalized = part.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(part.length / 4) * 4, '=');
  try { return Buffer.from(normalized, 'base64'); }
  catch { throw new ApiError('AUTH_REQUIRED', `JWT ${label} is malformed`); }
};

const decodePart = (part: string, label: string): string => decodeBytes(part, label).toString('utf8');

const parseJson = <T>(part: string, label: string): T => {
  try { return JSON.parse(decodePart(part, label)) as T; }
  catch (error) { if (error instanceof ApiError) throw error; throw new ApiError('AUTH_REQUIRED', `JWT ${label} is malformed`); }
};

const claimString = (value: unknown, label: string): string | undefined => {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || value.trim().length === 0) throw new ApiError('AUTH_REQUIRED', `JWT ${label} is invalid`);
  return value;
};

const claimSeconds = (value: unknown, label: string): number | undefined => {
  if (value === undefined) return undefined;
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new ApiError('AUTH_REQUIRED', `JWT ${label} is invalid`);
  return value;
};
const claimRoles = (claims: JwtClaims): string[] => {
  const values: unknown[] = [];
  if (claims.role !== undefined) values.push(claims.role);
  if (claims.roles !== undefined) values.push(...(Array.isArray(claims.roles) ? claims.roles : [claims.roles]));
  if (values.some((value) => typeof value !== 'string' || value.trim().length === 0)) throw new ApiError('AUTH_REQUIRED', 'JWT role claims are invalid');
  return [...new Set(values as string[])];
};

const expectedAudience = (claims: JwtClaims, configured: string | undefined): void => {
  if (!configured) return;
  const audience = claims.aud;
  if (typeof audience === 'string' && audience === configured) return;
  if (Array.isArray(audience) && audience.some((value) => value === configured)) return;
  throw new ApiError('AUTH_REQUIRED', 'JWT audience is invalid');
};

const validateClaims = (claims: JwtClaims, nowSeconds: number, issuer?: string, audience?: string, requireExpiry = false): AuthIdentity => {
  const subject = claimString(claims.sub, 'subject');
  if (!subject) throw new ApiError('AUTH_REQUIRED', 'JWT subject is required');
  const expiry = claimSeconds(claims.exp, 'expiry');
  if (requireExpiry && expiry === undefined) throw new ApiError('AUTH_REQUIRED', 'JWT expiry is required');
  const notBefore = claimSeconds(claims.nbf, 'not-before');
  if (expiry !== undefined && nowSeconds >= expiry) throw new ApiError('AUTH_REQUIRED', 'JWT has expired');
  if (notBefore !== undefined && nowSeconds < notBefore) throw new ApiError('AUTH_REQUIRED', 'JWT is not active yet');
  if (issuer && claimString(claims.iss, 'issuer') !== issuer) throw new ApiError('AUTH_REQUIRED', 'JWT issuer is invalid');
  expectedAudience(claims, audience);
  return { subject, roles: claimRoles(claims) };
};

type ParsedJwt = { encodedHeader: string; encodedClaims: string; encodedSignature: string; header: JwtHeader; claims: JwtClaims; signature: Buffer };
const parseJwt = (token: string): ParsedJwt => {
  const parts = token.split('.');
  if (parts.length !== 3) throw new ApiError('AUTH_REQUIRED', 'Authorization token is not a compact JWT');
  const [encodedHeader, encodedClaims, encodedSignature] = parts;
  const header = parseJson<JwtHeader>(encodedHeader, 'header');
  const claims = parseJson<JwtClaims>(encodedClaims, 'claims');
  return { encodedHeader, encodedClaims, encodedSignature, header, claims, signature: decodeBytes(encodedSignature, 'signature') };
};

/** Verify a compact HS256 token and return its player subject. */
export function verifyJwtIdentity(token: string, secret: string, nowSeconds = Math.floor(Date.now() / 1000)): AuthIdentity {
  const parsed = parseJwt(token);
  const { encodedHeader, encodedClaims, header, claims, signature } = parsed;
  if (header.alg !== 'HS256' || (header.typ !== undefined && header.typ !== 'JWT')) throw new ApiError('AUTH_REQUIRED', 'JWT algorithm or type is not supported');
  const issuer = process.env.DONGTIAN_JWT_ISSUER;
  const identity = validateClaims(claims, nowSeconds, issuer, process.env.DONGTIAN_JWT_AUDIENCE);

  const expected = createHmac('sha256', secret).update(`${encodedHeader}.${encodedClaims}`).digest();
  if (signature.length !== expected.length || !timingSafeEqual(signature, expected)) throw new ApiError('AUTH_REQUIRED', 'JWT signature is invalid');
  return identity;
}

export function verifyJwtSubject(token: string, secret: string, nowSeconds = Math.floor(Date.now() / 1000)): string { return verifyJwtIdentity(token, secret, nowSeconds).subject; }

export function authenticateBearerToken(token: string): string {
  return authenticateBearerIdentity(token).subject;
}

export function authenticateBearerIdentity(token: string): AuthIdentity {
  const secret = process.env.DONGTIAN_JWT_SECRET;
  if (secret) return verifyJwtIdentity(token, secret);
  if (process.env.DONGTIAN_ALLOW_INSECURE_BEARER_TOKEN === '1') return { subject: token, roles: [] };
  throw new ApiError('AUTH_REQUIRED', 'JWT authentication is not configured');
}

type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;
type JwksConfig = { endpoint: string; issuer: string; audience: string; timeoutMs: number; cacheTtlMs: number };
const positiveDuration = (env: NodeJS.ProcessEnv, key: string, fallback: number, max: number): number => {
  const raw = env[key] ?? String(fallback);
  if (!/^\d+$/.test(raw)) throw new AuthConfigurationError(`${key} must be a positive integer`);
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0 || value > max) throw new AuthConfigurationError(`${key} must be between 1 and ${max}`);
  return value;
};

const jwksConfig = (env: NodeJS.ProcessEnv): JwksConfig => {
  const endpoint = env.DONGTIAN_JWKS_URL?.trim();
  const issuer = (env.DONGTIAN_JWKS_ISSUER ?? env.DONGTIAN_JWT_ISSUER)?.trim();
  const audience = (env.DONGTIAN_JWKS_AUDIENCE ?? env.DONGTIAN_JWT_AUDIENCE)?.trim();
  if (!endpoint || !issuer || !audience) throw new AuthConfigurationError('jwks auth requires DONGTIAN_JWKS_URL, DONGTIAN_JWKS_ISSUER and DONGTIAN_JWKS_AUDIENCE');
  let parsed: URL;
  try { parsed = new URL(endpoint); } catch { throw new AuthConfigurationError('DONGTIAN_JWKS_URL must be a valid HTTPS URL'); }
  if (parsed.protocol !== 'https:') throw new AuthConfigurationError('DONGTIAN_JWKS_URL must use HTTPS');
  if (parsed.username || parsed.password) throw new AuthConfigurationError('DONGTIAN_JWKS_URL must not contain credentials');
  return { endpoint: parsed.toString(), issuer, audience, timeoutMs: positiveDuration(env, 'DONGTIAN_JWKS_TIMEOUT_MS', 5000, 120_000), cacheTtlMs: positiveDuration(env, 'DONGTIAN_JWKS_CACHE_TTL_MS', 300_000, 86_400_000) };
};

class Hs256AuthProvider implements AuthProvider {
  readonly backend = 'hs256' as const;
  private readonly secret: string;
  constructor(secret: string) { this.secret = secret; }
  async authenticate(token: string): Promise<AuthIdentity> { return verifyJwtIdentity(token, this.secret); }
}

class InsecureAuthProvider implements AuthProvider {
  readonly backend = 'insecure' as const;
  async authenticate(token: string): Promise<AuthIdentity> { if (!token.trim()) throw new ApiError('AUTH_REQUIRED', 'Authorization token is empty'); return { subject: token, roles: [] }; }
}

class UnconfiguredAuthProvider implements AuthProvider {
  readonly backend = 'unconfigured' as const;
  async authenticate(_token: string): Promise<AuthIdentity> { throw new ApiError('AUTH_REQUIRED', 'JWT authentication is not configured'); }
}

class JwksAuthProvider implements AuthProvider {
  readonly backend = 'jwks' as const;
  private keys = new Map<string, KeyObject>();
  private expiresAt = 0;
  private refreshPromise: Promise<void> | null = null;
  private readonly config: JwksConfig;
  private readonly fetchFn: FetchLike;
  constructor(config: JwksConfig, fetchFn: FetchLike = globalThis.fetch) { this.config = config; this.fetchFn = fetchFn; }

  private async refresh(): Promise<void> {
    if (this.refreshPromise) return this.refreshPromise;
    this.refreshPromise = (async () => {
      try {
        const response = await this.fetchFn(this.config.endpoint, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(this.config.timeoutMs) });
        if (!response.ok) throw new Error(`JWKS endpoint returned HTTP ${response.status}`);
        const contentLength = response.headers.get('content-length');
        if (contentLength && Number(contentLength) > 1_000_000) throw new Error('JWKS response is too large');
        const raw = await response.text();
        if (Buffer.byteLength(raw, 'utf8') > 1_000_000) throw new Error('JWKS response is too large');
        let payload: unknown;
        try { payload = JSON.parse(raw) as unknown; } catch { throw new Error('JWKS response is not valid JSON'); }
        if (!payload || typeof payload !== 'object' || !Array.isArray((payload as { keys?: unknown }).keys) || (payload as { keys: unknown[] }).keys.length === 0 || (payload as { keys: unknown[] }).keys.length > 100) throw new Error('JWKS response must contain 1 to 100 keys');
        const next = new Map<string, KeyObject>();
        for (const candidate of (payload as { keys: unknown[] }).keys) {
          if (!candidate || typeof candidate !== 'object') continue;
          const jwk = candidate as { kid?: unknown; kty?: unknown; alg?: unknown };
          if (typeof jwk.kid !== 'string' || !jwk.kid || jwk.kty !== 'RSA' || (jwk.alg !== undefined && jwk.alg !== 'RS256')) continue;
          try { next.set(jwk.kid, createPublicKey({ key: candidate as CryptoJsonWebKey, format: 'jwk' })); } catch { /* ignore malformed keys */ }
        }
        if (next.size === 0) throw new Error('JWKS response contains no usable RSA keys');
        this.keys = next;
        this.expiresAt = Date.now() + this.config.cacheTtlMs;
      } finally { this.refreshPromise = null; }
    })();
    return this.refreshPromise;
  }

  async authenticate(token: string): Promise<AuthIdentity> {
    const parsed = parseJwt(token);
    if (parsed.header.alg !== 'RS256' || parsed.header.typ !== undefined && parsed.header.typ !== 'JWT' || typeof parsed.header.kid !== 'string' || !parsed.header.kid) throw new ApiError('AUTH_REQUIRED', 'JWT algorithm, type, or key id is not supported');
    if (Date.now() >= this.expiresAt || !this.keys.has(parsed.header.kid)) await this.refresh().catch(() => { throw new ApiError('AUTH_REQUIRED', 'JWT key set is unavailable'); });
    const key = this.keys.get(parsed.header.kid);
    if (!key || !verifySignature('RSA-SHA256', Buffer.from(`${parsed.encodedHeader}.${parsed.encodedClaims}`), key, parsed.signature)) throw new ApiError('AUTH_REQUIRED', 'JWT signature is invalid');
    return validateClaims(parsed.claims, Math.floor(Date.now() / 1000), this.config.issuer, this.config.audience, true);
  }
}

/** Build the production identity boundary. HS256 remains the default when a secret is configured. */
export const createAuthProvider = (env: NodeJS.ProcessEnv = process.env, fetchFn?: FetchLike): AuthProvider => {
  const requested = env.DONGTIAN_AUTH_BACKEND;
  const backend = requested ?? (env.DONGTIAN_JWKS_URL ? 'jwks' : env.DONGTIAN_JWT_SECRET ? 'hs256' : env.DONGTIAN_ALLOW_INSECURE_BEARER_TOKEN === '1' ? 'insecure' : 'unconfigured');
  if (backend === 'hs256') {
    if (!env.DONGTIAN_JWT_SECRET) throw new AuthConfigurationError('hs256 auth requires DONGTIAN_JWT_SECRET');
    return new Hs256AuthProvider(env.DONGTIAN_JWT_SECRET);
  }
  if (backend === 'jwks') return new JwksAuthProvider(jwksConfig(env), fetchFn);
  if (backend === 'insecure') {
    if (env.DONGTIAN_ALLOW_INSECURE_BEARER_TOKEN !== '1') throw new AuthConfigurationError('insecure auth requires DONGTIAN_ALLOW_INSECURE_BEARER_TOKEN=1');
    return new InsecureAuthProvider();
  }
  if (backend === 'unconfigured') return new UnconfiguredAuthProvider();
  throw new AuthConfigurationError('DONGTIAN_AUTH_BACKEND must be hs256, jwks, or insecure');
};
