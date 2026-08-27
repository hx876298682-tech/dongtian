import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createConnection, type Socket } from 'node:net';
import { once } from 'node:events';
import test from 'node:test';
import { closeHttpServerBounded } from './http-shutdown.ts';

const listen = async (server: ReturnType<typeof createServer>): Promise<number> => {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('server did not expose a TCP address');
  return address.port;
};

const close = async (server: ReturnType<typeof createServer>): Promise<void> => {
  if (!server.listening) return;
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
};

test('bounded HTTP close resolves gracefully when requests are complete', async () => {
  const server = createServer((_request, response) => response.end('ok'));
  try {
    await listen(server);
    const result = await closeHttpServerBounded(server, 100);
    assert.deepEqual(result, { graceful: true, forced: false, timedOut: false });
  } finally {
    await close(server);
  }
});

test('bounded HTTP close force-closes a hanging keep-alive request', async () => {
  let requestSeenResolve: ((socket: Socket) => void) | undefined;
  const requestSeen = new Promise<Socket>((resolve) => { requestSeenResolve = resolve; });
  const server = createServer((request) => { requestSeenResolve?.(request.socket); });
  const socket = createConnection({ host: '127.0.0.1', port: await listen(server) });
  socket.on('error', () => undefined);
  let socketClosed = false;
  const socketClosedPromise = once(socket, 'close').then(() => { socketClosed = true; });
  try {
    socket.write('GET /hang HTTP/1.1\r\nHost: localhost\r\nConnection: keep-alive\r\n\r\n');
    await requestSeen;
    const startedAt = Date.now();
    const result = await closeHttpServerBounded(server, 25);
    assert.equal(result.forced, true);
    assert.equal(result.timedOut, true);
    assert.ok(Date.now() - startedAt < 500, 'bounded close exceeded its upper test bound');
    await Promise.race([socketClosedPromise, new Promise((resolve) => setTimeout(resolve, 500))]);
    assert.equal(socketClosed, true, 'tracked socket was not destroyed after timeout');
  } finally {
    socket.destroy();
    await close(server);
  }
});
