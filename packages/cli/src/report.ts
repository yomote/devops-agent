import type { Run } from '../../application/src/store.js';
export function report(run: Run): string {
  const change = run.change;
  const rank = { low: 1, medium: 2, high: 3, critical: 4 };
  const risk = [...change.risks].sort((a, b) => rank[b.severity] - rank[a.severity])[0]?.severity ?? 'none';
  const lines = [`CHANGE: ${change.title ?? change.id}`, `ID: ${change.id}`, `STATE: ${change.status}`,
    `REVISIONS: ${change.targetRevision.slice(0, 12)}...${change.sourceRevision.slice(0, 12)}`,
    ...(Object.values(run.executors).includes('mock') ? ['MODE: MOCK — fixture output, not a semantic review'] : []),
    `RISK: ${risk.toUpperCase()}`, 'REVIEW',
    `  Critical findings: ${change.findings.filter(f => f.severity === 'critical').length}`,
    `  Errors: ${change.findings.filter(f => f.severity === 'error').length}`,
    `  Warnings: ${change.findings.filter(f => f.severity === 'warning').length}`,
    `  ${run.review?.summary ?? 'Review not completed'}`,
  ];
  for (const finding of change.findings) lines.push(`  [${finding.severity}] ${finding.title}${finding.file ? ` (${finding.file}${finding.line ? ':' + finding.line : ''})` : ''}`);
  if (change.testPlan) {
    lines.push('VALIDATION', `  ${change.testPlan.rationale}`);
    for (const test of change.testPlan.tests) {
      const evidence = change.evidence.filter(e => e.testId === test.id).at(-1);
      lines.push(`  ${evidence?.status === 'passed' ? '✓' : evidence?.status === 'failed' ? '✗' : '⚠'} ${test.id} [${test.required ? 'required' : 'optional'}]: ${evidence?.summary ?? test.reason}`);
    }
  }
  if (change.releaseAssessment) {
    lines.push('RELEASE READINESS', change.releaseAssessment.status.toUpperCase(), change.releaseAssessment.summary);
    if (change.releaseAssessment.blockers.length) lines.push('Blockers:', ...change.releaseAssessment.blockers.map(b => `- ${b}`));
    if (change.releaseAssessment.warnings.length) lines.push('Warnings:', ...change.releaseAssessment.warnings.map(w => `- ${w}`));
  }
  if (run.lastError) lines.push(`ERROR: ${run.lastError}`);
  return lines.join('\n');
}
