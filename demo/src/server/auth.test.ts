import assert from 'node:assert/strict';
import { createHmac, createSign, generateKeyPairSync } from 'node:crypto';
import test from 'node:test';
import { ApiError } from './types.ts';
import { authenticateBearerToken, createAuthProvider, verifyJwtIdentity, verifyJwtSubject, AuthConfigurationError } from './auth.ts';

const encode = (value: unknown): string => Buffer.from(JSON.stringify(value)).toString('base64url');
const tokenFor = (claims: Record<string, unknown>, secret = 'test-secret'): string => {
  const header = encode({ alg: 'HS256', typ: 'JWT' });
  const payload = encode(claims);
  const signature = createHmac('sha256', secret).update(`${header}.${payload}`).digest('base64url');
  return `${header}.${payload}.${signature}`;
};
const rsaTokenFor = (claims: Record<string, unknown>, privateKey: ReturnType<typeof generateKeyPairSync>['privateKey'], kid = 'production-key-1'): string => {
  const header = encode({ alg: 'RS256', typ: 'JWT', kid });
  const payload = encode(claims);
  const signer = createSign('RSA-SHA256').update(`${header}.${payload}`);
  return `${header}.${payload}.${signer.sign(privateKey).toString('base64url')}`;
};

test('JWT verification returns the subject and enforces time and signature claims', () => {
  const token = tokenFor({ sub: 'player-1', exp: 200, nbf: 100 });
  assert.equal(verifyJwtSubject(token, 'test-secret', 150), 'player-1');
  assert.throws(() => verifyJwtSubject(`${token.slice(0, -1)}x`, 'test-secret', 150), (error: unknown) => error instanceof ApiError && error.code === 'AUTH_REQUIRED');
  assert.throws(() => verifyJwtSubject(tokenFor({ sub: 'player-1', exp: 100 }), 'test-secret', 100), (error: unknown) => error instanceof ApiError && error.code === 'AUTH_REQUIRED');
  assert.throws(() => verifyJwtSubject(tokenFor({ sub: 'player-1', nbf: 200 }), 'test-secret', 150), (error: unknown) => error instanceof ApiError && error.code === 'AUTH_REQUIRED');
});

test('JWT verification parses optional role and roles claims while subject API stays compatible', () => {
  const token = tokenFor({ sub: 'admin-1', role: 'operator', roles: ['admin', 'operator'], exp: 200 });
  assert.equal(verifyJwtSubject(token, 'test-secret', 150), 'admin-1');
  assert.deepEqual(verifyJwtIdentity(token, 'test-secret', 150), { subject: 'admin-1', roles: ['operator', 'admin'] });
  assert.throws(() => verifyJwtIdentity(tokenFor({ sub: 'admin-1', roles: ['admin', 7] }), 'test-secret', 150), (error: unknown) => error instanceof ApiError && error.code === 'AUTH_REQUIRED');
});

test('JWT verification enforces configured issuer and audience', () => {
  const previousIssuer = process.env.DONGTIAN_JWT_ISSUER;
  const previousAudience = process.env.DONGTIAN_JWT_AUDIENCE;
  process.env.DONGTIAN_JWT_ISSUER = 'dongtian-api';
  process.env.DONGTIAN_JWT_AUDIENCE = 'dongtian-web';
  try {
    const token = tokenFor({ sub: 'player-2', iss: 'dongtian-api', aud: ['other', 'dongtian-web'], exp: 200 });
    assert.equal(verifyJwtSubject(token, 'test-secret', 150), 'player-2');
    assert.throws(() => verifyJwtSubject(tokenFor({ sub: 'player-2', iss: 'other', aud: 'dongtian-web', exp: 200 }), 'test-secret', 150), (error: unknown) => error instanceof ApiError && error.code === 'AUTH_REQUIRED');
  } finally {
    if (previousIssuer === undefined) delete process.env.DONGTIAN_JWT_ISSUER; else process.env.DONGTIAN_JWT_ISSUER = previousIssuer;
    if (previousAudience === undefined) delete process.env.DONGTIAN_JWT_AUDIENCE; else process.env.DONGTIAN_JWT_AUDIENCE = previousAudience;
  }
});

test('raw bearer subject is rejected unless explicit development fallback is enabled', () => {
  const previousSecret = process.env.DONGTIAN_JWT_SECRET;
  const previousFallback = process.env.DONGTIAN_ALLOW_INSECURE_BEARER_TOKEN;
  process.env.DONGTIAN_JWT_SECRET = 'test-secret';
  delete process.env.DONGTIAN_ALLOW_INSECURE_BEARER_TOKEN;
  try {
    assert.throws(() => authenticateBearerToken('player-raw'), (error: unknown) => error instanceof ApiError && error.code === 'AUTH_REQUIRED');
    assert.equal(authenticateBearerToken(tokenFor({ sub: 'player-3', exp: Math.floor(Date.now() / 1000) + 60 })), 'player-3');
  } finally {
    if (previousSecret === undefined) delete process.env.DONGTIAN_JWT_SECRET; else process.env.DONGTIAN_JWT_SECRET = previousSecret;
    if (previousFallback === undefined) delete process.env.DONGTIAN_ALLOW_INSECURE_BEARER_TOKEN; else process.env.DONGTIAN_ALLOW_INSECURE_BEARER_TOKEN = previousFallback;
  }
});

test('JWKS provider verifies RS256 tokens, enforces OIDC claims, and caches the key set', async () => {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const jwk = publicKey.export({ format: 'jwk' }) as JsonWebKey;
  Object.assign(jwk, { kid: 'production-key-1', alg: 'RS256', use: 'sig' });
  let fetches = 0;
  const provider = createAuthProvider({
    DONGTIAN_AUTH_BACKEND: 'jwks',
    DONGTIAN_JWKS_URL: 'https://issuer.example/.well-known/jwks.json',
    DONGTIAN_JWKS_ISSUER: 'https://issuer.example',
    DONGTIAN_JWKS_AUDIENCE: 'dongtian-api',
    DONGTIAN_JWKS_CACHE_TTL_MS: '60000',
  }, async () => {
    fetches += 1;
    return new Response(JSON.stringify({ keys: [jwk] }), { status: 200, headers: { 'content-type': 'application/json' } });
  });
  const claims = { sub: 'oidc-player', iss: 'https://issuer.example', aud: 'dongtian-api', exp: Math.floor(Date.now() / 1000) + 60 };
  assert.deepEqual(await provider.authenticate(rsaTokenFor(claims, privateKey)), { subject: 'oidc-player', roles: [] });
  assert.deepEqual(await provider.authenticate(rsaTokenFor({ ...claims, roles: ['player'] }, privateKey)), { subject: 'oidc-player', roles: ['player'] });
  assert.equal(fetches, 1, 'valid key must be served from the provider cache');
  await assert.rejects(() => provider.authenticate(rsaTokenFor({ ...claims, aud: 'wrong' }, privateKey)), (error: unknown) => error instanceof ApiError && error.code === 'AUTH_REQUIRED');
  await assert.rejects(() => provider.authenticate(rsaTokenFor({ sub: claims.sub, iss: claims.iss, aud: claims.aud }, privateKey)), (error: unknown) => error instanceof ApiError && error.code === 'AUTH_REQUIRED');
});

test('JWKS provider rejects insecure endpoints and missing production claim configuration', () => {
  assert.throws(() => createAuthProvider({ DONGTIAN_AUTH_BACKEND: 'jwks', DONGTIAN_JWKS_URL: 'http://issuer.example/jwks', DONGTIAN_JWKS_ISSUER: 'https://issuer.example', DONGTIAN_JWKS_AUDIENCE: 'dongtian-api' }), AuthConfigurationError);
  assert.throws(() => createAuthProvider({ DONGTIAN_AUTH_BACKEND: 'jwks', DONGTIAN_JWKS_URL: 'https://issuer.example/jwks', DONGTIAN_JWKS_ISSUER: 'https://issuer.example' }), AuthConfigurationError);
  assert.throws(() => createAuthProvider({ DONGTIAN_AUTH_BACKEND: 'jwks', DONGTIAN_JWKS_URL: 'https://user:secret@issuer.example/jwks', DONGTIAN_JWKS_ISSUER: 'https://issuer.example', DONGTIAN_JWKS_AUDIENCE: 'dongtian-api' }), /must not contain credentials/);
  assert.throws(() => createAuthProvider({ DONGTIAN_AUTH_BACKEND: 'jwks', DONGTIAN_JWKS_URL: '   ', DONGTIAN_JWKS_ISSUER: 'https://issuer.example', DONGTIAN_JWKS_AUDIENCE: 'dongtian-api' }), /requires DONGTIAN_JWKS_URL/);
});

test('JWKS provider refreshes on a newly rotated key id without waiting for cache expiry', async () => {
  const first = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const second = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const jwkFor = (key: ReturnType<typeof generateKeyPairSync>['publicKey'], kid: string): JsonWebKey => {
    const jwk = key.export({ format: 'jwk' }) as JsonWebKey;
    Object.assign(jwk, { kid, alg: 'RS256', use: 'sig' });
    return jwk;
  };
  const firstJwk = jwkFor(first.publicKey, 'rotation-key-1');
  const secondJwk = jwkFor(second.publicKey, 'rotation-key-2');
  let fetches = 0;
  const provider = createAuthProvider({
    DONGTIAN_AUTH_BACKEND: 'jwks',
    DONGTIAN_JWKS_URL: 'https://issuer.example/.well-known/jwks.json',
    DONGTIAN_JWKS_ISSUER: 'https://issuer.example',
    DONGTIAN_JWKS_AUDIENCE: 'dongtian-api',
    DONGTIAN_JWKS_CACHE_TTL_MS: '60000',
  }, async () => {
    fetches += 1;
    const keys = fetches === 1 ? [firstJwk] : [secondJwk];
    return new Response(JSON.stringify({ keys }), { status: 200, headers: { 'content-type': 'application/json' } });
  });
  const claims = { sub: 'rotating-player', iss: 'https://issuer.example', aud: 'dongtian-api', exp: Math.floor(Date.now() / 1000) + 60 };
  assert.deepEqual(await provider.authenticate(rsaTokenFor(claims, first.privateKey, 'rotation-key-1')), { subject: 'rotating-player', roles: [] });
  assert.deepEqual(await provider.authenticate(rsaTokenFor(claims, second.privateKey, 'rotation-key-2')), { subject: 'rotating-player', roles: [] });
  assert.equal(fetches, 2);
});
