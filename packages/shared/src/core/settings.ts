export interface AppSettings {
  readonly enableTodoTool: boolean;
  readonly enableAskQuestionTool: boolean;
  readonly enableAgentRules: boolean;
  readonly enableSkillDiscovery: boolean;

  readonly autoApproveRead: boolean;
  readonly autoApproveSkillReads: boolean;
  readonly autoApproveWrite: boolean;
  readonly autoApproveDelete: boolean;
  readonly autoApproveExecute: boolean;
  readonly allowedReadPaths: readonly string[];
  readonly deniedReadPaths: readonly string[];
  readonly allowedWritePaths: readonly string[];
  readonly deniedWritePaths: readonly string[];
  readonly allowedDeletePaths: readonly string[];
  readonly deniedDeletePaths: readonly string[];
  readonly allowedExecuteCommands: readonly string[];
  readonly deniedExecuteCommands: readonly string[];

  readonly autoCompactContext: boolean;
  readonly autoCompactContextPercent: number;
  readonly maxOpenTabsContext: number;
  readonly maxWorkspaceFiles: number;
  readonly excludeIgnoredFiles: boolean;
  readonly maxGitStatusFiles: number;
  readonly maxConcurrentFileReads: number;
  readonly maxToolOutputLines: number;
  readonly maxToolOutputSizeKb: number;
}
