import { getAgentDir, SettingsManager } from '@earendil-works/pi-coding-agent';

export interface AppSettings {
  readonly maxOpenTabsContext: number;
  readonly maxWorkspaceFiles: number;
  readonly maxGitStatusFiles: number;
  readonly maxConcurrentFileReads: number;
  readonly autoCondenseContext: boolean;
  readonly autoCondenseContextPercent: number;
}

export const DEFAULT_SETTINGS: AppSettings = {
  maxOpenTabsContext: 20,
  maxWorkspaceFiles: 200,
  maxGitStatusFiles: 20,
  maxConcurrentFileReads: 10,
  autoCondenseContext: true,
  autoCondenseContextPercent: 80,
};

export function parseVSCodeSettings(obj: AppSettings): AppSettings {
  const settings = { ...DEFAULT_SETTINGS };
  if (obj && typeof obj === 'object') {
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
    if (typeof obj.autoCondenseContext === 'boolean') {
      settings.autoCondenseContext = obj.autoCondenseContext;
    }
    if (typeof obj.autoCondenseContextPercent === 'number' && !isNaN(obj.autoCondenseContextPercent)) {
      settings.autoCondenseContextPercent = Math.max(0, Math.min(100, obj.autoCondenseContextPercent));
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
    this.manager = SettingsManager.create(resolvedCwd, agentDir);
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

    const parsedGlobal = parseVSCodeSettings(globalSettings.vscode);

    const projectSettings = this.manager.getProjectSettings();
    if (projectSettings && projectSettings.vscode !== undefined) {
      const parsedProject = parseVSCodeSettings(projectSettings.vscode);
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
