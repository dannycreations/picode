import { getAgentDir, SettingsManager } from '@earendil-works/pi-coding-agent';
import { ConfigurationTarget, workspace } from 'vscode';

import { isProjectTrusted } from '@pi-code/extension/utilities/vscode';
import { DEFAULT_APP_ID } from '@pi-code/shared/core/constants';
import { isThinkingLevel, parseModelSelection } from '@pi-code/shared/core/protocol';
import { coerceSettings, SETTING_KEYS } from '@pi-code/shared/core/settings';
import { BYTES_PER_KILOBYTE } from '@pi-code/shared/utilities/common';

import type { WorkspaceConfiguration } from 'vscode';
import type { OutputLimits } from '@pi-code/extension/utilities/truncate';
import type { ModelSelection } from '@pi-code/shared/core/protocol';
import type { AppSettings } from '@pi-code/shared/core/settings';
import type { ModelThinkingLevel } from '@pi-code/shared/core/types';

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
  const raw: Record<string, unknown> = {};
  for (const key of SETTING_KEYS) {
    raw[key] = config.get(key);
  }
  cachedSettings = coerceSettings(raw) as AppSettings;
  return cachedSettings;
}

// Every tool result shares one truncation budget derived from the settings snapshot.
export function readOutputLimits(): OutputLimits {
  const settings = readAppSettings();
  return { maxLines: settings.maxToolOutputLines, maxBytes: settings.maxToolOutputSizeKb * BYTES_PER_KILOBYTE };
}

// An empty string means "not configured", which callers translate into the
// selection the chat is currently running.
export function readCommitMessageModelSelection(): ModelSelection | undefined {
  return parseModelSelection(readAppSettings().commitMessageModel);
}

export function readDelegationTaskModelSelection(): ModelSelection | undefined {
  return parseModelSelection(readAppSettings().delegationTaskModel);
}

function readThinkingLevel(value: string): ModelThinkingLevel | undefined {
  return isThinkingLevel(value) ? value : undefined;
}

export function readCommitMessageThinkingLevel(): ModelThinkingLevel | undefined {
  return readThinkingLevel(readAppSettings().commitMessageThinkingLevel);
}

export function readDelegationTaskThinkingLevel(): ModelThinkingLevel | undefined {
  return readThinkingLevel(readAppSettings().delegationTaskThinkingLevel);
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
