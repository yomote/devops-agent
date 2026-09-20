import type { ChangeRef, ChangeSource, ChangedFile, Diff, SourceControlProvider } from '../../core/src/index.js';

/** Extension boundary only. v0.1 does not call Azure DevOps. */
export class AzureDevOpsProvider implements SourceControlProvider {
  async getChange(_ref: ChangeRef): Promise<ChangeSource> { throw new Error('Azure DevOps adapter is not implemented in v0.1'); }
  async getDiff(_ref: ChangeRef): Promise<Diff> { throw new Error('Azure DevOps adapter is not implemented in v0.1'); }
  async getChangedFiles(_ref: ChangeRef): Promise<ChangedFile[]> { throw new Error('Azure DevOps adapter is not implemented in v0.1'); }
}
