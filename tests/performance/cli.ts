import { renderPerfReport, runPerfHarness } from './perf-runner.js';

async function main(): Promise<void> {
  try {
    const report = await runPerfHarness();
    process.stdout.write(renderPerfReport(report));
    if (report.status === 'failed') {
      process.exitCode = 1;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown error';
    process.stderr.write(`PERF FAIL-FAST: ${message}\n`);
    process.exitCode = 1;
  }
}

void main();
