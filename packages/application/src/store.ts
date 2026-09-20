import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile, open, unlink } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { ChangeSchema, DiffSchema, ReviewResultSchema, TestPlanSchema, EvidenceSchema, ReleaseAssessmentSchema } from '../../core/src/index.js';

export const RunSchema = z.object({
  version: z.literal(1), change: ChangeSchema, diff: DiffSchema, configDigest: z.string(),
  review: ReviewResultSchema.optional(), testPlan: TestPlanSchema.optional(), evidence: z.array(EvidenceSchema),
  releaseAssessment: ReleaseAssessmentSchema.optional(),
  executors: z.object({ review: z.string().optional(), testPlanning: z.string().optional() }).strict(),
  skippedStages: z.array(z.string()), lastError: z.string().optional(),
  humanApproval: z.object({ approver: z.string().min(1), sourceRevision: z.string(), targetRevision: z.string(), at: z.string().datetime() }).strict().optional(),
  updatedAt: z.string().datetime(),
}).strict();
export type Run = z.infer<typeof RunSchema>;
export function digest(value: unknown): string { return createHash('sha256').update(JSON.stringify(value)).digest('hex'); }
export class RunStore {
  readonly directory: string;
  constructor(root: string) { this.directory = path.join(root, '.devops-agent', 'runs'); }
  async lock(): Promise<() => Promise<void>> {
    await mkdir(this.directory, { recursive: true });
    const lock = path.join(this.directory, '.lock');
    try {
      const handle = await open(lock, 'wx');
      await handle.writeFile(JSON.stringify({ pid: process.pid, at: new Date().toISOString() }));
      await handle.close();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new Error(`Another operation is active. If interrupted, confirm its PID is no longer running before removing ${lock}`);
      throw error;
    }
    return () => unlink(lock);
  }
  private runPath(id: string) {
    if (!/^[a-zA-Z0-9_-]+$/.test(id)) throw new Error('Invalid run ID');
    return path.join(this.directory, id, 'run.json');
  }
  private async atomic(file: string, value: unknown) {
    await mkdir(path.dirname(file), { recursive: true });
    const temporary = `${file}.${randomUUID()}.tmp`;
    await writeFile(temporary, JSON.stringify(value, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    await rename(temporary, file);
  }
  async save(run: Run): Promise<void> {
    run.updatedAt = new Date().toISOString();
    run.testPlan = run.change.testPlan; run.evidence = run.change.evidence; run.releaseAssessment = run.change.releaseAssessment;
    RunSchema.parse(run);
    await this.atomic(this.runPath(run.change.id), run);
    await this.atomic(path.join(this.directory, 'latest.json'), { id: run.change.id });
  }
  async load(id?: string): Promise<Run> {
    try {
      const target = id ?? z.object({ id: z.string() }).strict().parse(JSON.parse(await readFile(path.join(this.directory, 'latest.json'), 'utf8'))).id;
      const run = RunSchema.parse(JSON.parse(await readFile(this.runPath(target), 'utf8')));
      if (run.change.id !== target) throw new Error('Run ID mismatch');
      if (JSON.stringify(run.evidence) !== JSON.stringify(run.change.evidence) ||
        JSON.stringify(run.testPlan) !== JSON.stringify(run.change.testPlan) ||
        JSON.stringify(run.releaseAssessment) !== JSON.stringify(run.change.releaseAssessment)) throw new Error('Inconsistent persisted run');
      return run;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new Error('No saved Change found; run review first');
      throw error;
    }
  }
}
