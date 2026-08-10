import { DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES, getAgentDir, SettingsManager } from '@earendil-works/pi-coding-agent';
import { ConfigurationTarget, workspace } from 'vscode';

import { isProjectTrusted } from '@pi-code/extension/utilities/vscode';
import manifest from '../../package.json' with { type: 'json' };

import type { WorkspaceConfiguration } from 'vscode';
import type { AppSettings } from '@pi-code/shared/core/settings';

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
  excludeIgnoredFiles: true,
  maxGitStatusFiles: 20,
  maxConcurrentFileReads: 10,
  maxToolOutputLines: DEFAULT_MAX_LINES,
  maxToolOutputSizeKb: DEFAULT_MAX_BYTES / 1024,
};

export const SETTING_KEYS = Object.keys(DEFAULT_SETTINGS) as ReadonlyArray<keyof AppSettings>;

function coerce<K extends keyof AppSettings>(key: K, value: unknown): AppSettings[K] {
  const fallback = DEFAULT_SETTINGS[key];
  if (Array.isArray(fallback)) {
    return (Array.isArray(value) ? value.filter((item) => typeof item === 'string') : fallback) as AppSettings[K];
  }
  if (typeof value !== typeof fallback || (typeof value === 'number' && Number.isNaN(value))) {
    return fallback;
  }
  return value as AppSettings[K];
}

export function readAppSettings(): AppSettings {
  const config = workspace.getConfiguration(manifest.name);
  const settings: Record<string, unknown> = {};
  for (const key of SETTING_KEYS) {
    settings[key] = coerce(key, config.get(key));
  }
  return settings as unknown as AppSettings;
}

function resolveConfigurationTarget(config: WorkspaceConfiguration, key: string): ConfigurationTarget {
  const inspected = config.inspect(key);
  if (inspected?.workspaceFolderValue !== undefined) return ConfigurationTarget.WorkspaceFolder;
  if (inspected?.workspaceValue !== undefined) return ConfigurationTarget.Workspace;
  return ConfigurationTarget.Global;
}

export async function writeAppSettings(partial: Partial<AppSettings>): Promise<void> {
  const config = workspace.getConfiguration(manifest.name);
  for (const [key, value] of Object.entries(partial)) {
    if (!SETTING_KEYS.includes(key as keyof AppSettings)) continue;
    await config.update(key, value, resolveConfigurationTarget(config, key));
  }
}

export class SettingsService {
  private static readonly instances = new Map<string, SettingsService>();

  private manager: SettingsManager | null = null;

  public static getInstance(cwd: string): SettingsService {
    let instance = this.instances.get(cwd);
    if (!instance) {
      instance = new SettingsService(cwd);
      this.instances.set(cwd, instance);
    }
    return instance;
  }

  private constructor(private readonly cwd: string) {}

  public getSettingsManager(): SettingsManager {
    this.manager ??= SettingsManager.create(this.cwd, getAgentDir(), {
      projectTrusted: isProjectTrusted(this.cwd),
    });
    return this.manager;
  }

  public setProjectTrusted(trusted: boolean): void {
    this.getSettingsManager().setProjectTrusted(trusted);
  }

  public async load(): Promise<AppSettings> {
    return readAppSettings();
  }

  public async getDefaultModel(): Promise<string | undefined> {
    const manager = this.getSettingsManager();
    await manager.reload();
    return manager.getDefaultModel();
  }

  public async updateSettings(partial: Partial<AppSettings>): Promise<AppSettings> {
    await writeAppSettings(partial);
    return readAppSettings();
  }
}
