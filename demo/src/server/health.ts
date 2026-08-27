/**
 * Process health contracts intentionally expose only coarse dependency state.
 * Check implementations must keep credentials, URLs and provider diagnostics
 * out of the returned payload; evaluateReadiness also suppresses thrown errors.
 */
export type HealthCheckName = 'database' | 'config' | 'scanner';
export type HealthCheck = () => boolean | void | Promise<boolean | void>;
export type HealthChecks = Partial<Record<HealthCheckName, HealthCheck>>;
export type HealthCheckState = 'up' | 'down';
export type ReadinessReport = {
  status: 'ok' | 'not_ready';
  checks: Record<HealthCheckName, HealthCheckState>;
};

const CHECK_NAMES: readonly HealthCheckName[] = ['database', 'config', 'scanner'];
const DEFAULT_TIMEOUT_MS = 1_000;

const runCheck = async (check: HealthCheck | undefined, timeoutMs: number): Promise<HealthCheckState> => {
  // A missing check is a failed dependency. This prevents a production
  // process from advertising readiness when main forgot to wire a dependency.
  if (!check) return 'down';
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const result = await Promise.race([
      Promise.resolve().then(check).then((value) => value !== false),
      new Promise<boolean>((resolve) => {
        timer = setTimeout(() => resolve(false), timeoutMs);
        timer.unref?.();
      }),
    ]);
    return result ? 'up' : 'down';
  } catch {
    // Readiness responses are deliberately non-diagnostic.
    return 'down';
  } finally {
    if (timer) clearTimeout(timer);
  }
};

export const evaluateReadiness = async (checks: HealthChecks, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<ReadinessReport> => {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60_000) throw new RangeError('health check timeout must be between 1 and 60000 milliseconds');
  const entries = await Promise.all(CHECK_NAMES.map(async (name) => [name, await runCheck(checks[name], timeoutMs)] as const));
  const states = Object.fromEntries(entries) as Record<HealthCheckName, HealthCheckState>;
  return { status: Object.values(states).every((state) => state === 'up') ? 'ok' : 'not_ready', checks: states };
};

