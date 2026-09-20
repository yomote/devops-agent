import type { Change, ChangeStatus } from './domain.js';

const transitions: Record<ChangeStatus, readonly ChangeStatus[]> = {
  CREATED: ['UNDER_REVIEW', 'TEST_PLANNED', 'ASSESSED', 'BLOCKED'],
  UNDER_REVIEW: ['REVIEWED', 'REVIEW_FAILED'],
  REVIEWED: ['UNDER_REVIEW', 'TEST_PLANNED', 'ASSESSED', 'BLOCKED'],
  TEST_PLANNED: ['UNDER_REVIEW', 'TEST_PLANNED', 'VALIDATING', 'ASSESSED', 'BLOCKED'],
  VALIDATING: ['VALIDATING', 'TEST_PLANNED', 'UNDER_REVIEW', 'ASSESSED', 'VALIDATION_FAILED', 'BLOCKED'],
  ASSESSED: ['UNDER_REVIEW', 'TEST_PLANNED', 'VALIDATING', 'ASSESSED', 'BLOCKED'],
  REVIEW_FAILED: ['UNDER_REVIEW', 'BLOCKED'],
  VALIDATION_FAILED: ['UNDER_REVIEW', 'TEST_PLANNED', 'VALIDATING', 'ASSESSED', 'BLOCKED'],
  BLOCKED: ['UNDER_REVIEW', 'TEST_PLANNED', 'VALIDATING', 'ASSESSED', 'BLOCKED'],
};
export function canTransition(from: ChangeStatus, to: ChangeStatus): boolean { return transitions[from].includes(to); }
export function transition(change: Change, next: ChangeStatus): void {
  if (!canTransition(change.status, next)) throw new Error(`Invalid lifecycle transition: ${change.status} -> ${next}`);
  change.status = next;
}
