import { z } from 'zod';
import type { AgentExecutor, AgentTask } from '../../core/src/index.js';
import { parseCommand, runProcess } from '../../platform/src/process.js';
import { taskInstructions } from './context.js';

export class CommandAgentExecutor implements AgentExecutor {
  readonly name = 'command';
  constructor(private readonly options: {
    command: string; args?: string[]; cwd: string; timeoutMs: number; maxOutputBytes: number;
  }) {}
  async execute<TInput, TOutput>(task: AgentTask<TInput, TOutput>): Promise<TOutput> {
    const tokens = this.options.args ? [this.options.command, ...this.options.args] : parseCommand(this.options.command);
    const result = await runProcess(tokens[0]!, tokens.slice(1), { ...this.options,
      stdin: JSON.stringify({ protocolVersion: 1, task: task.kind, instructions: taskInstructions[task.kind], input: task.input }) });
    if (result.timedOut || result.outputLimitExceeded || result.exitCode !== 0)
      throw new Error(`Agent command failed (exit=${result.exitCode}, timeout=${result.timedOut}, outputLimit=${result.outputLimitExceeded})`);
    try { return task.outputSchema.parse(JSON.parse(result.stdout)); }
    catch (error) { throw new Error(`Malformed agent output for ${task.kind}: ${error instanceof z.ZodError ? error.message : 'stdout must contain exactly one JSON document'}`); }
  }
}
