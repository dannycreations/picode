import { getAgentDir, SettingsManager } from '@earendil-works/pi-coding-agent';
import { isObjectLike } from 'es-toolkit/compat';

import { isProjectTrusted } from '@extension/utilities/vscode';

export interface AppSettings {
  // Approval Tab
  readonly autoApproveRead: boolean;
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

  // Context Tab
  readonly useAgentRules: boolean;
  readonly autoCondenseContext: boolean;
  readonly autoCondenseContextPercent: number;
  readonly maxOpenTabsContext: number;
  readonly maxWorkspaceFiles: number;
  readonly maxGitStatusFiles: number;
  readonly maxConcurrentFileReads: number;
}

export const DEFAULT_SETTINGS: AppSettings = {
  // Approval Tab
  autoApproveRead: false,
  autoApproveWrite: false,
  autoApproveDelete: false,
  autoApproveExecute: false,
  allowedReadPaths: [],
  deniedReadPaths: [],
  allowedWritePaths: [],
  deniedWritePaths: [],
  allowedDeletePaths: [],
  deniedDeletePaths: [],
  allowedExecuteCommands: [],
  deniedExecuteCommands: [],

  // Context Tab
  useAgentRules: true,
  autoCondenseContext: true,
  autoCondenseContextPercent: 80,
  maxOpenTabsContext: 20,
  maxWorkspaceFiles: 200,
  maxGitStatusFiles: 20,
  maxConcurrentFileReads: 10,
};

export function parseAppSettings(obj: AppSettings): AppSettings {
  const settings = { ...DEFAULT_SETTINGS };
  if (isObjectLike(obj)) {
    // Approval Tab
    if (typeof obj.autoApproveRead === 'boolean') {
      settings.autoApproveRead = obj.autoApproveRead;
    }
    if (typeof obj.autoApproveWrite === 'boolean') {
      settings.autoApproveWrite = obj.autoApproveWrite;
    }
    if (typeof obj.autoApproveDelete === 'boolean') {
      settings.autoApproveDelete = obj.autoApproveDelete;
    }
    if (typeof obj.autoApproveExecute === 'boolean') {
      settings.autoApproveExecute = obj.autoApproveExecute;
    }
    if (Array.isArray(obj.allowedReadPaths)) {
      settings.allowedReadPaths = obj.allowedReadPaths.filter((item): item is string => typeof item === 'string');
    }
    if (Array.isArray(obj.deniedReadPaths)) {
      settings.deniedReadPaths = obj.deniedReadPaths.filter((item): item is string => typeof item === 'string');
    }
    if (Array.isArray(obj.allowedWritePaths)) {
      settings.allowedWritePaths = obj.allowedWritePaths.filter((item): item is string => typeof item === 'string');
    }
    if (Array.isArray(obj.deniedWritePaths)) {
      settings.deniedWritePaths = obj.deniedWritePaths.filter((item): item is string => typeof item === 'string');
    }
    if (Array.isArray(obj.allowedDeletePaths)) {
      settings.allowedDeletePaths = obj.allowedDeletePaths.filter((item): item is string => typeof item === 'string');
    }
    if (Array.isArray(obj.deniedDeletePaths)) {
      settings.deniedDeletePaths = obj.deniedDeletePaths.filter((item): item is string => typeof item === 'string');
    }
    if (Array.isArray(obj.allowedExecuteCommands)) {
      settings.allowedExecuteCommands = obj.allowedExecuteCommands.filter((item): item is string => typeof item === 'string');
    }
    if (Array.isArray(obj.deniedExecuteCommands)) {
      settings.deniedExecuteCommands = obj.deniedExecuteCommands.filter((item): item is string => typeof item === 'string');
    }

    // Context Tab
    if (typeof obj.useAgentRules === 'boolean') {
      settings.useAgentRules = obj.useAgentRules;
    }
    if (typeof obj.autoCondenseContext === 'boolean') {
      settings.autoCondenseContext = obj.autoCondenseContext;
    }
    if (typeof obj.autoCondenseContextPercent === 'number' && !isNaN(obj.autoCondenseContextPercent)) {
      settings.autoCondenseContextPercent = Math.max(0, Math.min(100, obj.autoCondenseContextPercent));
    }
    if (typeof obj.maxOpenTabsContext === 'number' && !isNaN(obj.maxOpenTabsContext)) {
      settings.maxOpenTabsContext = Math.max(0, obj.maxOpenTabsContext);
    }
    if (typeof obj.maxWorkspaceFiles === 'number' && !isNaN(obj.maxWorkspaceFiles)) {
      settings.maxWorkspaceFiles = Math.max(0, obj.maxWorkspaceFiles);
    }
    if (typeof obj.maxGitStatusFiles === 'number' && !isNaN(obj.maxGitStatusFiles)) {
      settings.maxGitStatusFiles = Math.max(0, obj.maxGitStatusFiles);
    }
    if (typeof obj.maxConcurrentFileReads === 'number' && !isNaN(obj.maxConcurrentFileReads)) {
      settings.maxConcurrentFileReads = Math.max(1, obj.maxConcurrentFileReads);
    }
  }
  return settings;
}

export class SettingsService {
  private static readonly instances = new Map<string, SettingsService>();

  public static getInstance(cwd?: string): SettingsService {
    const resolvedCwd = cwd || process.cwd();
    let instance = this.instances.get(resolvedCwd);
    if (!instance) {
      instance = new SettingsService(resolvedCwd);
      this.instances.set(resolvedCwd, instance);
    }
    return instance;
  }

  private readonly manager: SettingsManager;

  private constructor(resolvedCwd: string) {
    const agentDir = getAgentDir();
    const isTrusted = isProjectTrusted(resolvedCwd);
    this.manager = SettingsManager.create(resolvedCwd, agentDir, { projectTrusted: isTrusted });
  }

  public async load(): Promise<AppSettings> {
    await this.manager.reload();

    const globalSettings = this.manager.getGlobalSettings();

    // Initialize "vscode" key to defaults if missing
    if (globalSettings.vscode === undefined) {
      globalSettings.vscode = { ...DEFAULT_SETTINGS };
      this.manager['markModified']('vscode');

      // Sync autoCondenseContext with compaction.enabled
      this.manager.setCompactionEnabled(DEFAULT_SETTINGS.autoCondenseContext);

      this.manager['save']();
      await this.manager.flush();
    }

    const parsedGlobal = parseAppSettings(globalSettings.vscode);

    const projectSettings = this.manager.getProjectSettings();
    if (projectSettings && projectSettings.vscode !== undefined) {
      const parsedProject = parseAppSettings(projectSettings.vscode);
      return { ...parsedGlobal, ...parsedProject };
    }
    return parsedGlobal;
  }

  public async update(key: keyof AppSettings, value: unknown): Promise<AppSettings> {
    await this.manager.reload();
    const globalSettings = this.manager['globalSettings'];

    if (!globalSettings.vscode || typeof globalSettings.vscode !== 'object') {
      globalSettings.vscode = {};
    }
    globalSettings.vscode[key] = value;
    this.manager['markModified']('vscode');

    if (key === 'autoCondenseContext') {
      this.manager.setCompactionEnabled(value === true);
    }

    this.manager['save']();
    await this.manager.flush();

    return this.load();
  }
}

declare module '@earendil-works/pi-coding-agent' {
  interface SettingsManager {
    getGlobalSettings(): { vscode: AppSettings };
    getProjectSettings(): { vscode: AppSettings };
  }
}
