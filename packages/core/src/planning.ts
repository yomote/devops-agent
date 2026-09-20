import { minimatch } from 'minimatch';
import { TestPlanSchema, type ChangedFile, type PlannedTest, type TestPlan } from './domain.js';

export interface CatalogEntry extends Omit<PlannedTest, 'reason'> { command: string; files: string[]; always: boolean; }
export function affectedTests(files: ChangedFile[], catalog: CatalogEntry[]): CatalogEntry[] {
  const paths = files.flatMap(file => [file.path, ...(file.previousPath ? [file.previousPath] : [])]);
  return catalog.filter(test => test.always || paths.some(file => test.files.some(pattern => minimatch(file, pattern, { dot: true }))));
}
/** Configured required validation cannot be removed or weakened by an agent. */
export function enforceRequiredTests(plan: TestPlan, candidates: CatalogEntry[]): TestPlan {
  const result = structuredClone(plan);
  for (const candidate of candidates.filter(test => test.required)) {
    const existing = result.tests.find(test => test.id === candidate.id);
    if (existing) {
      if (existing.command !== candidate.command || existing.cwd !== candidate.cwd)
        throw new Error(`Agent altered the registered command for required test ${candidate.id}`);
      existing.required = true;
    } else result.tests.push({ id: candidate.id, type: candidate.type, command: candidate.command, cwd: candidate.cwd,
      description: candidate.description, required: true, reason: 'Required by repository file-pattern policy' });
  }
  if (!result.tests.length) result.tests.push({ id: 'manual-change-validation', type: 'custom', cwd: '.',
    description: 'Define and run change-specific validation', reason: 'No executable validation was identified', required: true });
  return TestPlanSchema.parse(result);
}
