import { context as otelContext, metrics, SpanStatusCode, trace, type Span } from '@opentelemetry/api';
import pino, { type DestinationStream, type Level, type Logger } from 'pino';

export const packageName = '@dongtian/observability' as const;

export const REDACTION_PATHS = [
  'password',
  'password_hash',
  'email',
  'email_normalized',
  'token',
  'access_token',
  'refresh_token',
  'session_token',
  'session_token_hash',
  'csrf_token',
  'csrf_token_hash',
  'authorization',
  'cookie',
  'ip',
  'ip_address',
  'client_ip',
  'remote_ip',
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers.x-csrf-token',
] as const;

export type ObservabilityContext = Readonly<{
  serviceName: string;
  tracingEnabled: boolean;
  tracer: ReturnType<typeof trace.getTracer>;
  meter: ReturnType<typeof metrics.getMeter>;
  httpRequests: ReturnType<ReturnType<typeof metrics.getMeter>['createCounter']>;
  httpDurationMs: ReturnType<ReturnType<typeof metrics.getMeter>['createHistogram']>;
}>;

export type ObservabilityOptions = Readonly<{
  enabled?: boolean;
  instrumentationVersion?: string;
}>;

export function initializeObservability(
  serviceName: string,
  options: ObservabilityOptions = {},
): ObservabilityContext {
  const tracer = trace.getTracer(serviceName, options.instrumentationVersion);
  const meter = metrics.getMeter(serviceName, options.instrumentationVersion);

  return Object.freeze({
    serviceName,
    tracingEnabled: options.enabled === true,
    tracer,
    meter,
    httpRequests: meter.createCounter('http.server.requests', {
      description: 'Number of HTTP requests observed by the service.',
    }),
    httpDurationMs: meter.createHistogram('http.server.duration', {
      description: 'HTTP request duration in milliseconds.',
      unit: 'ms',
    }),
  });
}

export type RequestSpan = Readonly<{
  span: Span;
  run<T>(callback: () => T): T;
  end(statusCode: number): void;
}>;

export function startRequestSpan(
  observability: ObservabilityContext,
  requestId: string,
  route: string,
): RequestSpan {
  const span = observability.tracer.startSpan('http.request', {
    attributes: {
      'service.name': observability.serviceName,
      'http.request.id': requestId,
      'http.route': route,
    },
  });

  return {
    span,
    run<T>(callback: () => T): T {
      return otelContext.with(trace.setSpan(otelContext.active(), span), callback);
    },
    end(statusCode: number): void {
      span.setAttribute('http.response.status_code', statusCode);
      span.setStatus({
        code: statusCode >= 500 ? SpanStatusCode.ERROR : SpanStatusCode.UNSET,
      });
      span.end();
    },
  };
}

export function recordHttpRequest(
  observability: ObservabilityContext,
  attributes: Readonly<{ method: string; route: string; statusCode: number }>,
  durationMs: number,
): void {
  const metricAttributes = {
    'http.method': attributes.method,
    'http.route': attributes.route,
    'http.status_code': attributes.statusCode,
  };
  observability.httpRequests.add(1, metricAttributes);
  observability.httpDurationMs.record(durationMs, metricAttributes);
}

export type LoggerOptions = Readonly<{
  level?: Level;
  stream?: DestinationStream;
}>;

export function createLogger(serviceName: string, options: LoggerOptions = {}): Logger {
  const loggerOptions = {
    name: serviceName,
    level: options.level ?? 'info',
    redact: [...REDACTION_PATHS],
  };

  return options.stream === undefined ? pino(loggerOptions) : pino(loggerOptions, options.stream);
}

export * from './analytics.js';
