import type { AgentExecutor, AgentTask } from '../../core/src/index.js';
import type { AgentContext } from './context.js';

export class MockAgentExecutor implements AgentExecutor {
  readonly name = 'mock';
  constructor(private readonly fixtures?: Partial<Record<'review' | 'test-planning', unknown>>) {}
  async execute<TInput, TOutput>(task: AgentTask<TInput, TOutput>): Promise<TOutput> {
    const context = task.input as unknown as AgentContext;
    const output = this.fixtures?.[task.kind] ?? (task.kind === 'review' ? {
      summary: 'MOCK review fixture: no semantic code review was performed.', risks: [], findings: [],
    } : {
      rationale: 'MOCK deterministic plan: select configured tests matching changed paths, plus always-required checks.',
      tests: context.candidateTests.map(test => ({ id: test.id, type: test.type, command: test.command, cwd: test.cwd,
        description: test.description, required: test.required,
        reason: test.always ? 'Repository-wide validation required by policy' : `Changed files match ${test.files.join(', ')}` })),
    });
    return task.outputSchema.parse(output);
  }
}
