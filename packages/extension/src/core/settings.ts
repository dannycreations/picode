import { getAgentDir, SettingsManager } from '@earendil-works/pi-coding-agent';
import { ConfigurationTarget, workspace } from 'vscode';

import { isProjectTrusted } from '@pi-code/extension/utilities/vscode';
import { DEFAULT_APP_ID } from '@pi-code/shared/core/constants';
import { coerceSetting, coerceSettings, SETTING_KEYS } from '@pi-code/shared/core/settings';

import type { WorkspaceConfiguration } from 'vscode';
import type { ModelSelection } from '@pi-code/shared/core/protocol';
import type { AppSettings } from '@pi-code/shared/core/settings';

// VS Code settings are read from the editor on demand and only change in
// response to `onDidChangeConfiguration`, so the snapshot is memoized and invalidated
// from that single listener instead of being re-read on every tool call, turn, and tool result.
let cachedSettings: AppSettings | null = null;

export function invalidateAppSettings(): void {
  cachedSettings = null;
}

export function readAppSettings(): AppSettings {
  if (cachedSettings) return cachedSettings;

  const config = workspace.getConfiguration(DEFAULT_APP_ID);
  const settings: Record<string, unknown> = {};
  for (const key of SETTING_KEYS) {
    settings[key] = coerceSetting(key, config.get(key));
  }
  cachedSettings = settings as unknown as AppSettings;
  return cachedSettings;
}

function resolveConfigurationTarget(config: WorkspaceConfiguration, key: string): ConfigurationTarget {
  const inspected = config.inspect(key);
  if (inspected?.workspaceFolderValue !== undefined) return ConfigurationTarget.WorkspaceFolder;
  if (inspected?.workspaceValue !== undefined) return ConfigurationTarget.Workspace;
  return ConfigurationTarget.Global;
}

export async function writeAppSettings(partial: Partial<AppSettings>): Promise<void> {
  const config = workspace.getConfiguration(DEFAULT_APP_ID);
  for (const [key, value] of Object.entries(coerceSettings(partial))) {
    await config.update(key, value, resolveConfigurationTarget(config, key));
  }
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

// Provider and model are always needed together to identify a model
// unambiguously, so both are read from a single reload of the agent settings.
export async function getDefaultModelSelection(cwd: string): Promise<Partial<ModelSelection>> {
  const manager = getSettingsManager(cwd);
  await manager.reload();

  const id = manager.getDefaultModel();
  const provider = manager.getDefaultProvider();
  return { id, provider };
}
