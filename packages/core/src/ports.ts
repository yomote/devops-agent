import type { z } from 'zod';
import type { ChangedFile, Diff, RepositoryRef, ReviewResult } from './domain.js';

export interface ChangeRef { base?: string; head?: string; pullRequest?: number; }
export interface ChangeSource {
  id: string; repository: RepositoryRef; sourceRevision: string; targetRevision: string;
  title?: string; description?: string;
}
export interface SourceControlProvider {
  getChange(ref: ChangeRef): Promise<ChangeSource>;
  getDiff(ref: ChangeRef): Promise<Diff>;
  getChangedFiles(ref: ChangeRef): Promise<ChangedFile[]>;
  publishReview?(ref: ChangeRef, review: ReviewResult): Promise<void>;
}
export interface CommentPublisher { publishComment(ref: ChangeRef, body: string): Promise<void>; }
export interface CIProvider {
  getChecks(ref: ChangeRef): Promise<Array<{ name: string; status: 'passed' | 'failed' | 'pending'; url?: string }>>;
}
export interface AgentTask<TInput, TOutput> {
  kind: 'review' | 'test-planning'; input: TInput; outputSchema: z.ZodType<TOutput, z.ZodTypeDef, unknown>;
}
export interface AgentExecutor {
  readonly name: string;
  execute<TInput, TOutput>(task: AgentTask<TInput, TOutput>): Promise<TOutput>;
}
export interface EventLogger { emit(event: string, fields?: Record<string, unknown>): void; }
