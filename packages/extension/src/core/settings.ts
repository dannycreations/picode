import { getAgentDir, SettingsManager } from '@earendil-works/pi-coding-agent';
import { ConfigurationTarget, workspace } from 'vscode';

import { isProjectTrusted } from '@pi-code/extension/utilities/vscode';
import { coerceSetting, coerceSettings, SETTING_KEYS } from '@pi-code/shared/core/settings';
import manifest from '../../package.json' with { type: 'json' };

import type { WorkspaceConfiguration } from 'vscode';
import type { AppSettings } from '@pi-code/shared/core/settings';

export function readAppSettings(): AppSettings {
  const config = workspace.getConfiguration(manifest.name);
  const settings: Record<string, unknown> = {};
  for (const key of SETTING_KEYS) {
    settings[key] = coerceSetting(key, config.get(key));
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
  for (const [key, value] of Object.entries(coerceSettings(partial))) {
    await config.update(key, value, resolveConfigurationTarget(config, key));
  }
}

export async function updateAppSettings(partial: Partial<AppSettings>): Promise<AppSettings> {
  await writeAppSettings(partial);
  return readAppSettings();
}

// SettingsManager is the only settings state that is genuinely workspace bound,
// so it is memoized per cwd. Editor settings are read straight from VS Code.
const settingsManagers = new Map<string, SettingsManager>();

export function getSettingsManager(cwd: string): SettingsManager {
  let manager = settingsManagers.get(cwd);
  if (!manager) {
    manager = SettingsManager.create(cwd, getAgentDir(), { projectTrusted: isProjectTrusted(cwd) });
    settingsManagers.set(cwd, manager);
  }
  return manager;
}

export async function getDefaultModel(cwd: string): Promise<string | undefined> {
  const manager = getSettingsManager(cwd);
  await manager.reload();
  return manager.getDefaultModel();
}
