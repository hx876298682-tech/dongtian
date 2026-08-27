import type { Server } from 'node:http';
import type { Socket } from 'node:net';

export type HttpServerCloseResult = {
  graceful: boolean;
  forced: boolean;
  timedOut: boolean;
};

/** Stop accepting work, then force-close any connection past the deadline. */
export const closeHttpServerBounded = async (server: Server, timeoutMs: number, trackedSockets?: ReadonlySet<Socket>): Promise<HttpServerCloseResult> => {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 0 || timeoutMs > 120_000) {
    throw new RangeError('HTTP shutdown timeout must be an integer between 0 and 120000');
  }
  if (!server.listening) return { graceful: true, forced: false, timedOut: false };
  return await new Promise<HttpServerCloseResult>((resolve, reject) => {
    let settled = false;
    const sockets = new Set<Socket>(trackedSockets);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onConnection = (socket: Socket): void => {
      sockets.add(socket);
      socket.once('close', () => sockets.delete(socket));
    };
    const cleanup = (): void => {
      if (timer !== undefined) clearTimeout(timer);
      if (!trackedSockets) server.off('connection', onConnection);
    };
    const finish = (result: HttpServerCloseResult): void => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(result);
    };
    const fail = (error: Error): void => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };
    const forceClose = (): void => {
      try {
        if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
      } catch {
        // Tracked socket destruction below is the fallback for older Node or
        // a concurrent close operation.
      }
      for (const socket of sockets) socket.destroy();
    };
    if (!trackedSockets) server.on('connection', onConnection);
    timer = setTimeout(() => {
      forceClose();
      finish({ graceful: false, forced: true, timedOut: true });
    }, timeoutMs);
    timer.unref();
    server.close((error?: Error) => {
      if (error && (error as NodeJS.ErrnoException).code !== 'ERR_SERVER_NOT_RUNNING') {
        fail(error);
        return;
      }
      // `server.close` does not own upgraded/connect sockets. At this point
      // ordinary HTTP requests are drained, so closing the remaining tracked
      // sockets cannot interrupt an in-flight HTTP response.
      forceClose();
      finish({ graceful: true, forced: false, timedOut: false });
    });
  });
};
