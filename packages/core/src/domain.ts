import { z } from 'zod';

const id = z.string().min(1).max(256);
export const SeveritySchema = z.enum(['low', 'medium', 'high', 'critical']);
export const FindingSeveritySchema = z.enum(['info', 'warning', 'error', 'critical']);
export const ChangeStatusSchema = z.enum(['CREATED', 'UNDER_REVIEW', 'REVIEWED', 'TEST_PLANNED', 'VALIDATING', 'ASSESSED', 'REVIEW_FAILED', 'VALIDATION_FAILED', 'BLOCKED']);
export const RepositoryRefSchema = z.object({
  provider: z.enum(['local-git', 'github', 'azure-devops']),
  name: z.string().min(1), root: z.string().min(1), url: z.string().url().optional(),
}).strict();
export const ChangedFileSchema = z.object({
  path: z.string().min(1), previousPath: z.string().optional(),
  status: z.enum(['added', 'modified', 'deleted', 'renamed', 'copied', 'unmerged', 'unknown']),
  additions: z.number().int().nonnegative().optional(), deletions: z.number().int().nonnegative().optional(),
}).strict();
export const DiffSchema = z.object({ text: z.string(), baseRevision: id, headRevision: id }).strict();
export const RiskSchema = z.object({
  id, area: z.enum(['security', 'compatibility', 'data', 'performance', 'reliability', 'observability', 'maintainability', 'functional', 'other']),
  severity: SeveritySchema, description: z.string().min(1), relatedFiles: z.array(z.string()).optional(),
}).strict();
export const FindingSchema = z.object({
  id, severity: FindingSeveritySchema, category: z.string().min(1), title: z.string().min(1), description: z.string().min(1),
  file: z.string().optional(), line: z.number().int().positive().optional(), evidence: z.string().optional(), recommendation: z.string().optional(),
}).strict();
export const PlannedTestSchema = z.object({
  id, type: z.enum(['unit', 'integration', 'e2e', 'smoke', 'regression', 'security', 'performance', 'custom']),
  command: z.string().min(1).optional(), cwd: z.string().default('.'),
  description: z.string().min(1), reason: z.string().min(1), required: z.boolean(),
}).strict();
export const TestPlanSchema = z.object({
  rationale: z.string().min(1), tests: z.array(PlannedTestSchema).max(200),
}).strict().superRefine((value, ctx) => {
  if (new Set(value.tests.map(t => t.id)).size !== value.tests.length)
    ctx.addIssue({ code: 'custom', message: 'Test IDs must be unique' });
});
export const ReviewResultSchema = z.object({
  summary: z.string().min(1), risks: z.array(RiskSchema).max(500), findings: z.array(FindingSchema).max(500),
}).strict();
export const EvidenceSchema = z.object({
  id, type: z.enum(['test', 'review', 'static-analysis', 'manual', 'other']), source: z.string().min(1),
  status: z.enum(['passed', 'failed', 'warning', 'unknown']), summary: z.string().min(1), rawOutput: z.string().optional(),
  testId: id.optional(), command: z.string().optional(), cwd: z.string().optional(),
  exitCode: z.number().int().nullable().optional(), durationMs: z.number().nonnegative().optional(),
  timedOut: z.boolean().optional(), outputLimitExceeded: z.boolean().optional(),
  sourceRevision: id.optional(), targetRevision: id.optional(), recordedAt: z.string().datetime().optional(),
}).strict();
export const ReleaseAssessmentSchema = z.object({
  status: z.enum(['ready', 'blocked', 'needs-review']), summary: z.string().min(1),
  blockers: z.array(z.string()), warnings: z.array(z.string()),
}).strict();
export const ChangeSchema = z.object({
  id, repository: RepositoryRefSchema, sourceRevision: id, targetRevision: id,
  title: z.string().optional(), description: z.string().optional(), files: z.array(ChangedFileSchema),
  status: ChangeStatusSchema, risks: z.array(RiskSchema), findings: z.array(FindingSchema),
  testPlan: TestPlanSchema.optional(), evidence: z.array(EvidenceSchema), releaseAssessment: ReleaseAssessmentSchema.optional(),
}).strict();
export type Change = z.infer<typeof ChangeSchema>;
export type ChangeStatus = z.infer<typeof ChangeStatusSchema>;
export type RepositoryRef = z.infer<typeof RepositoryRefSchema>;
export type ChangedFile = z.infer<typeof ChangedFileSchema>;
export type Diff = z.infer<typeof DiffSchema>;
export type Risk = z.infer<typeof RiskSchema>;
export type Finding = z.infer<typeof FindingSchema>;
export type PlannedTest = z.infer<typeof PlannedTestSchema>;
export type TestPlan = z.infer<typeof TestPlanSchema>;
export type ReviewResult = z.infer<typeof ReviewResultSchema>;
export type Evidence = z.infer<typeof EvidenceSchema>;
export type ReleaseAssessment = z.infer<typeof ReleaseAssessmentSchema>;
