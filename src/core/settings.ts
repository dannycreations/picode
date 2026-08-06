import assert from 'node:assert';
import { getAgentDir, SettingsManager } from '@earendil-works/pi-coding-agent';
import { isObjectLike } from 'es-toolkit/compat';

import { isProjectTrusted } from '@extension/utilities/vscode';

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
  readonly maxGitStatusFiles: number;
  readonly maxConcurrentFileReads: number;
}

export const DEFAULT_SETTINGS: AppSettings = {
  enableTodoTool: true,
  enableAskQuestionTool: true,
  enableAgentRules: true,
  enableSkillDiscovery: true,

  autoApproveRead: false,
  autoApproveSkillReads: false,
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

  autoCompactContext: true,
  autoCompactContextPercent: 80,
  maxOpenTabsContext: 20,
  maxWorkspaceFiles: 100,
  maxGitStatusFiles: 20,
  maxConcurrentFileReads: 10,
};

function parseBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function parseStringArray(value: unknown, fallback: readonly string[]): readonly string[] {
  if (!Array.isArray(value)) return fallback;
  return value.filter((item): item is string => typeof item === 'string');
}

function parseBoundedNumber(value: unknown, fallback: number, options: { min?: number; max?: number } = {}): number {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return fallback;
  }
  const { min = -Infinity, max = Infinity } = options;
  return Math.max(min, Math.min(max, value));
}

function parseAppSettings(input?: unknown, base = DEFAULT_SETTINGS): AppSettings {
  const raw = (isObjectLike(input) ? input : {}) as AppSettings;
  return {
    enableTodoTool: parseBoolean(raw.enableTodoTool, base.enableTodoTool),
    enableAskQuestionTool: parseBoolean(raw.enableAskQuestionTool, base.enableAskQuestionTool),
    enableAgentRules: parseBoolean(raw.enableAgentRules, base.enableAgentRules),
    enableSkillDiscovery: parseBoolean(raw.enableSkillDiscovery, base.enableSkillDiscovery),

    autoApproveRead: parseBoolean(raw.autoApproveRead, base.autoApproveRead),
    autoApproveSkillReads: parseBoolean(raw.autoApproveSkillReads, base.autoApproveSkillReads),
    autoApproveWrite: parseBoolean(raw.autoApproveWrite, base.autoApproveWrite),
    autoApproveDelete: parseBoolean(raw.autoApproveDelete, base.autoApproveDelete),
    autoApproveExecute: parseBoolean(raw.autoApproveExecute, base.autoApproveExecute),
    allowedReadPaths: parseStringArray(raw.allowedReadPaths, base.allowedReadPaths),
    deniedReadPaths: parseStringArray(raw.deniedReadPaths, base.deniedReadPaths),
    allowedWritePaths: parseStringArray(raw.allowedWritePaths, base.allowedWritePaths),
    deniedWritePaths: parseStringArray(raw.deniedWritePaths, base.deniedWritePaths),
    allowedDeletePaths: parseStringArray(raw.allowedDeletePaths, base.allowedDeletePaths),
    deniedDeletePaths: parseStringArray(raw.deniedDeletePaths, base.deniedDeletePaths),
    allowedExecuteCommands: parseStringArray(raw.allowedExecuteCommands, base.allowedExecuteCommands),
    deniedExecuteCommands: parseStringArray(raw.deniedExecuteCommands, base.deniedExecuteCommands),

    autoCompactContext: parseBoolean(raw.autoCompactContext, base.autoCompactContext),
    autoCompactContextPercent: parseBoundedNumber(raw.autoCompactContextPercent, base.autoCompactContextPercent, { min: 0, max: 100 }),
    maxOpenTabsContext: parseBoundedNumber(raw.maxOpenTabsContext, base.maxOpenTabsContext, { min: 0 }),
    maxWorkspaceFiles: parseBoundedNumber(raw.maxWorkspaceFiles, base.maxWorkspaceFiles, { min: 0 }),
    maxGitStatusFiles: parseBoundedNumber(raw.maxGitStatusFiles, base.maxGitStatusFiles, { min: 0 }),
    maxConcurrentFileReads: parseBoundedNumber(raw.maxConcurrentFileReads, base.maxConcurrentFileReads, { min: 1 }),
  };
}

export class SettingsRepository {
  private readonly manager: SettingsManager;

  public constructor(cwd: string) {
    const agentDir = getAgentDir();
    const isTrusted = isProjectTrusted(cwd);
    this.manager = SettingsManager.create(cwd, agentDir, {
      projectTrusted: isTrusted,
    });

    assert(this.manager['globalSettings'], 'SettingsManager.globalSettings not found');
    assert(this.manager['markModified'], 'SettingsManager.markModified not found');
    assert(this.manager['save'], 'SettingsManager.save not found');
  }

  public async reload(): Promise<void> {
    await this.manager.reload();
  }

  public getGlobalSettings(): unknown {
    return this.manager.getGlobalSettings()?.vscode;
  }

  public getProjectSettings(): unknown {
    return this.manager.getProjectSettings()?.vscode;
  }

  public getDefaultModel(): string | undefined {
    return this.manager.getDefaultModel();
  }

  public async initializeDefaults(defaults: AppSettings): Promise<void> {
    this.manager['globalSettings'].vscode = { ...defaults };
    this.manager['markModified']('vscode');
    this.manager.setCompactionEnabled(defaults.autoCompactContext);
    this.manager['save']();
    await this.manager.flush();
  }

  public async updateSetting<K extends keyof AppSettings>(key: K, value: AppSettings[K]): Promise<void> {
    if (!isObjectLike(this.manager['globalSettings'].vscode)) {
      this.manager['globalSettings'].vscode = {};
    }

    const vscodeSettings = this.manager['globalSettings'].vscode;
    vscodeSettings[key] = value;

    this.manager['markModified']('vscode');
    this.manager['save']();
    await this.manager.flush();
  }

  public setCompactionEnabled(enabled: boolean): void {
    this.manager.setCompactionEnabled(enabled);
  }
}

export class SettingsService {
  private static readonly instances = new Map<string, SettingsService>();

  private defaultModel: string | undefined = undefined;

  public static getInstance(cwd?: string): SettingsService {
    const resolvedCwd = cwd || process.cwd();
    let instance = this.instances.get(resolvedCwd);
    if (!instance) {
      const repository = new SettingsRepository(resolvedCwd);
      instance = new SettingsService(repository);
      this.instances.set(resolvedCwd, instance);
    }
    return instance;
  }

  public constructor(private readonly repository: SettingsRepository) {}

  public async load(): Promise<AppSettings> {
    await this.repository.reload();

    let rawGlobal = this.repository.getGlobalSettings();

    if (rawGlobal === undefined) {
      await this.repository.initializeDefaults(DEFAULT_SETTINGS);
      rawGlobal = DEFAULT_SETTINGS;
    }

    const parsedGlobal = parseAppSettings(rawGlobal, DEFAULT_SETTINGS);
    const rawProject = this.repository.getProjectSettings();

    const settings = rawProject !== undefined ? parseAppSettings(rawProject, parsedGlobal) : parsedGlobal;
    this.defaultModel = this.repository.getDefaultModel();
    return settings;
  }

  public async getDefaultModel(): Promise<string | undefined> {
    if (this.defaultModel === undefined) {
      await this.load();
    }
    return this.defaultModel;
  }

  public async update<K extends keyof AppSettings>(key: K, value: AppSettings[K]): Promise<AppSettings> {
    await this.repository.reload();
    await this.repository.updateSetting(key, value);

    if (key === 'autoCompactContext') {
      this.repository.setCompactionEnabled(value === true);
    }

    return this.load();
  }
}

declare module '@earendil-works/pi-coding-agent' {
  interface SettingsManager {
    getGlobalSettings(): { vscode: AppSettings };
    getProjectSettings(): { vscode: AppSettings };
  }
}
