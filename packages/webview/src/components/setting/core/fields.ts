import { Database, ShieldCheck, Sparkles } from 'lucide-react';

import { getSettingSpec, SETTING_KEYS } from '@pi-code/shared/core/settings';

import type { SettingKey } from '@pi-code/shared/core/settings';
import type { SettingFieldRegistry, SettingsTab, SettingsTabId } from '@pi-code/webview/components/setting/core/types';

export const SETTINGS_TABS: readonly SettingsTab[] = [
  {
    id: 'ability',
    label: 'Ability',
    icon: Sparkles,
    description: 'Choose which optional abilities the agent can use while working on your tasks.',
  },
  {
    id: 'approval',
    label: 'Approval',
    icon: ShieldCheck,
    description: 'Configure auto-approval settings for agent actions to balance speed and safety.',
  },
  {
    id: 'context',
    label: 'Context',
    icon: Database,
    description: 'Control what information is included in the context window, affecting token usage and response quality.',
  },
];

export const SETTING_FIELDS: SettingFieldRegistry = {
  enableTodoTool: { tab: 'ability', label: 'Task Planning' },
  enableAskQuestionTool: { tab: 'ability', label: 'Clarifying Questions' },
  enableSubagentTool: { tab: 'ability', label: 'Task Delegation' },
  enableAgentRules: { tab: 'ability', label: 'Project Rules' },
  enableSkillDiscovery: { tab: 'ability', label: 'Skill Discovery' },
  enableMcpTool: { tab: 'ability', label: 'Model Context Protocol' },

  yolo: { tab: 'approval', label: 'YOLO Mode' },
  yoloRespectDenied: { tab: 'approval', label: 'Respect Denied Tools', parent: 'yolo' },

  autoApproveRead: { tab: 'approval', label: 'Read Files' },
  autoApproveSkillReads: { tab: 'approval', label: 'Skill Reading', parent: 'autoApproveRead' },
  allowedReadPaths: { tab: 'approval', label: 'Allowed Read Paths', parent: 'autoApproveRead', placeholder: 'e.g. src/**/*.ts' },
  deniedReadPaths: { tab: 'approval', label: 'Denied Read Paths', parent: 'autoApproveRead', placeholder: 'e.g. env/*.env' },

  autoApproveWrite: { tab: 'approval', label: 'Write & Edit Files' },
  allowedWritePaths: { tab: 'approval', label: 'Allowed Write Paths', parent: 'autoApproveWrite', placeholder: 'e.g. src/**/*.ts' },
  deniedWritePaths: { tab: 'approval', label: 'Denied Write Paths', parent: 'autoApproveWrite', placeholder: 'e.g. package.json' },

  autoApproveDelete: { tab: 'approval', label: 'Delete Files' },
  allowedDeletePaths: { tab: 'approval', label: 'Allowed Delete Paths', parent: 'autoApproveDelete', placeholder: 'e.g. temp/**/*.log' },
  deniedDeletePaths: { tab: 'approval', label: 'Denied Delete Paths', parent: 'autoApproveDelete', placeholder: 'e.g. src/**/*.ts' },

  autoApproveExecute: { tab: 'approval', label: 'Execute Commands' },
  allowedExecuteCommands: { tab: 'approval', label: 'Allowed Commands', parent: 'autoApproveExecute', placeholder: 'e.g. npm' },
  deniedExecuteCommands: { tab: 'approval', label: 'Denied Commands', parent: 'autoApproveExecute', placeholder: 'e.g. rm -rf' },

  autoCompactContext: { tab: 'context', label: 'Automatic trigger compaction' },
  autoCompactContextPercent: { tab: 'context', label: 'Compaction threshold', parent: 'autoCompactContext' },
  maxOpenTabsContext: { tab: 'context', label: 'Open tabs context limit' },
  maxWorkspaceFiles: { tab: 'context', label: 'Workspace files context limit' },
  excludeIgnoredFiles: { tab: 'context', label: 'Exclude ignored files', parent: 'maxWorkspaceFiles' },
  maxGitStatusFiles: { tab: 'context', label: 'Git status max files' },
  maxConcurrentFileReads: { tab: 'context', label: 'Concurrent file reads limit' },
  maxToolOutputLines: { tab: 'context', label: 'Tool output line limit' },
  maxToolOutputSizeKb: { tab: 'context', label: 'Tool output size limit' },
};

export function getRootFieldKeys(tab: SettingsTabId): readonly SettingKey[] {
  return SETTING_KEYS.filter((key) => SETTING_FIELDS[key].tab === tab && !SETTING_FIELDS[key].parent);
}

export function getChildFieldKeys(parent: SettingKey): readonly SettingKey[] {
  return SETTING_KEYS.filter((key) => SETTING_FIELDS[key].parent === parent);
}

export function matchesQuery(key: SettingKey, query: string): boolean {
  const q = query.toLowerCase().trim();
  if (!q) return true;

  const field = SETTING_FIELDS[key];
  const spec = getSettingSpec(key);

  const label = field?.label || '';
  const description = spec?.description || '';

  return key.toLowerCase().includes(q) || label.toLowerCase().includes(q) || description.toLowerCase().includes(q);
}

export function isFieldVisible(key: SettingKey, query: string, parentMatched = false): boolean {
  if (!query.trim()) return true;

  const matched = parentMatched || matchesQuery(key, query);
  if (matched) return true;

  const childKeys = getChildFieldKeys(key);
  return childKeys.some((childKey) => isFieldVisible(childKey, query, matched));
}
