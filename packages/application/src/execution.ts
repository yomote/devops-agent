import { randomUUID } from 'node:crypto';
import type { Config } from '../../config/src/index.js';
import type { Change, Evidence, EventLogger, PlannedTest } from '../../core/src/index.js';
import { containedDirectory, parseCommand, runProcess, testEnvironment } from '../../platform/src/process.js';

export async function executeTest(test: PlannedTest, change: Change, config: Config, logger: EventLogger): Promise<Evidence> {
  const common = { id: randomUUID(), type: 'test' as const, source: 'deterministic-process', testId: test.id,
    command: test.command, cwd: test.cwd, sourceRevision: change.sourceRevision, targetRevision: change.targetRevision,
    recordedAt: new Date().toISOString() };
  logger.emit('test.started', { changeId: change.id, testId: test.id });
  let evidence: Evidence;
  try {
    if (!test.command) evidence = { ...common, status: 'unknown', summary: 'Manual validation is pending; no executable command' };
    else {
      const registered = config.testing.commands.find(entry => entry.id === test.id && entry.command === test.command && entry.cwd === test.cwd);
      if (!registered) throw new Error('Denied: command, test ID and working directory must exactly match a registered testing.commands entry');
      const [executable, ...args] = parseCommand(test.command);
      if (!config.testing.allowedCommands.includes(executable!)) throw new Error(`Denied: executable ${executable} is not in testing.allowedCommands`);
      const cwd = await containedDirectory(change.repository.root, test.cwd);
      const result = await runProcess(executable!, args, { cwd, timeoutMs: config.testing.timeoutMs,
        maxOutputBytes: config.testing.maxOutputBytes, env: testEnvironment() });
      const passed = result.exitCode === 0 && !result.timedOut && !result.outputLimitExceeded;
      evidence = { ...common, status: passed ? 'passed' : 'failed',
        summary: result.timedOut ? 'Command timed out' : result.outputLimitExceeded ? 'Output size limit exceeded' : `Command exited with code ${result.exitCode}`,
        rawOutput: `${result.stdout}${result.stderr}`, exitCode: result.exitCode, durationMs: result.durationMs,
        timedOut: result.timedOut, outputLimitExceeded: result.outputLimitExceeded };
    }
  } catch (error) {
    evidence = { ...common, status: 'failed', summary: error instanceof Error ? error.message : String(error), exitCode: null };
  }
  logger.emit('test.completed', { changeId: change.id, testId: test.id, status: evidence.status, exitCode: evidence.exitCode });
  return evidence;
}
