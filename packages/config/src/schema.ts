import { z } from 'zod';
import { PlannedTestSchema } from '../../core/src/domain.js';
import { ReleasePolicySchema } from '../../core/src/policy.js';
export { ReleasePolicySchema } from '../../core/src/policy.js';
const executor = z.discriminatedUnion('executor', [
  z.object({ executor: z.literal('mock') }).strict(),
  z.object({ executor: z.literal('command'), command: z.string().min(1), args: z.array(z.string()).optional(),
    timeoutMs: z.number().int().min(100).max(3_600_000).default(120_000),
    maxOutputBytes: z.number().int().min(256).max(10_000_000).default(1_000_000),
  }).strict(),
]);
export const CatalogTestSchema = PlannedTestSchema.omit({ reason: true }).extend({
  command: z.string().min(1), required: z.boolean().default(true),
  files: z.array(z.string().min(1)).default(['**/*']), always: z.boolean().default(false),
}).strict();
export const ReviewPolicySchema = z.object({
  focus: z.array(z.string().min(1)).default(['bugs', 'security', 'compatibility', 'data migrations', 'reliability', 'observability', 'maintainability']),
}).strict();
export const TestingPolicySchema = z.object({
  allowedCommands: z.array(z.string().min(1)).default(['pnpm', 'npm', 'npx', 'pytest']),
  timeoutMs: z.number().int().min(100).max(3_600_000).default(120_000),
  maxOutputBytes: z.number().int().min(256).max(10_000_000).default(1_000_000),
}).strict();
export const ConfigSchema = z.object({
  version: z.literal(1), project: z.object({ name: z.string().min(1) }).strict(),
  provider: z.discriminatedUnion('type', [
    z.object({ type: z.literal('local-git') }).strict(),
    z.object({ type: z.literal('github'), repository: z.string().regex(/^[\w.-]+\/[\w.-]+$/).optional() }).strict(),
    z.object({ type: z.literal('azure-devops') }).strict(),
  ]).default({ type: 'local-git' }),
  lifecycle: z.object({ review: z.boolean().default(true), testPlanning: z.boolean().default(true),
    testExecution: z.boolean().default(true), releaseAssurance: z.boolean().default(true),
  }).strict().default({}),
  agents: z.object({ review: executor.default({ executor: 'mock' }), testPlanning: executor.default({ executor: 'mock' }) }).strict().default({}),
  policies: z.object({ release: ReleasePolicySchema.default({}) }).strict().default({}),
  testing: TestingPolicySchema.extend({
    discovery: z.object({ mode: z.enum(['automatic', 'configured']).default('automatic') }).strict().default({}),
    commands: z.array(CatalogTestSchema).max(200).default([]),
  }).strict().default({}),
}).strict().superRefine((value, ctx) => {
  if (new Set(value.testing.commands.map(t => t.id)).size !== value.testing.commands.length)
    ctx.addIssue({ code: 'custom', message: 'Configured test IDs must be unique' });
});
export type Config = z.infer<typeof ConfigSchema>;
export type ExecutorConfig = z.infer<typeof executor>;
export type CatalogTest = z.infer<typeof CatalogTestSchema>;
export type ReleasePolicy = z.infer<typeof ReleasePolicySchema>;
