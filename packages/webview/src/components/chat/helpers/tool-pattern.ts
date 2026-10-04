import { parseCommand } from '@pi-code/shared/utilities/command';
import { normalizeSeparators } from '@pi-code/shared/utilities/common';
import { getToolFilePaths } from '@pi-code/shared/utilities/tool';

import type { AppSettings, SettingKey } from '@pi-code/shared/core/settings';
import type { ToolChatMessage } from '@pi-code/shared/core/types';

const PATH_TOOL_KEYS: Readonly<Record<string, { readonly allow: SettingKey; readonly deny: SettingKey }>> = {
  read_file: { allow: 'allowedReadPaths', deny: 'deniedReadPaths' },
  write_file: { allow: 'allowedWritePaths', deny: 'deniedWritePaths' },
  edit_file: { allow: 'allowedWritePaths', deny: 'deniedWritePaths' },
  delete_file: { allow: 'allowedDeletePaths', deny: 'deniedDeletePaths' },
};

function extractCommandPatterns(command: string): readonly string[] {
  if (!command || !command.trim()) return [];

  let subCommands: string[];
  try {
    subCommands = parseCommand(command);
  } catch {
    // The host asks the user rather than matching patterns when tokenization
    // fails, so offer the raw command as the single candidate.
    subCommands = [command.trim()];
  }

  // Each sub-command and its base command, so the user can allow this one call
  // or every call to the same tool.
  return collectUnique(subCommands.map((sub) => [sub, sub.split(/\s+/)[0]]));
}

function collectUnique(groups: ReadonlyArray<readonly string[]>): string[] {
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const group of groups) {
    for (const item of group) {
      if (!item || seen.has(item)) continue;
      seen.add(item);
      unique.push(item);
    }
  }
  return unique;
}

interface ToolPatternConfig {
  readonly patterns: readonly string[];
  readonly allowedPatterns: readonly string[];
  readonly deniedPatterns: readonly string[];
  readonly allowKey: SettingKey;
  readonly denyKey: SettingKey;
}

export function extractPathPatterns(filePath: string): readonly string[] {
  // The host matches these patterns against normalizeSeparators(filePath), so
  // the separator must be normalized here too or a Windows path never matches.
  const normalized = normalizeSeparators(filePath.trim()).replace(/\/+$/, '');
  if (!normalized) return [];

  const lastSlash = normalized.lastIndexOf('/');
  const dir = lastSlash > 0 ? normalized.slice(0, lastSlash) : '';

  // The exact path plus a glob covering everything under its directory.
  return dir ? [normalized, `${dir}/**`] : [normalized];
}

export function getToolPatternConfig(message: ToolChatMessage, settings: AppSettings | null): ToolPatternConfig | null {
  if (message.toolName === 'execute_command') {
    const commands: string[] = [];
    const args = message.toolArgs;
    const command = args && 'command' in args && typeof args.command === 'string' ? args.command : undefined;
    if (command) commands.push(command);
    for (const section of message.toolSections ?? []) {
      if (section.title) commands.push(section.title);
    }
    const patterns = collectUnique(commands.map((command) => extractCommandPatterns(command)));
    if (patterns.length === 0) return null;

    return {
      patterns,
      allowedPatterns: settings?.allowedExecuteCommands ?? [],
      deniedPatterns: settings?.deniedExecuteCommands ?? [],
      allowKey: 'allowedExecuteCommands',
      denyKey: 'deniedExecuteCommands',
    };
  }

  const keys = PATH_TOOL_KEYS[message.toolName ?? ''];
  if (!keys) return null;

  const paths = [...getToolFilePaths(message)];
  for (const section of message.toolSections ?? []) {
    if (section.openPath) paths.push(section.openPath);
  }

  const patterns = collectUnique(paths.map((path) => extractPathPatterns(path)));
  if (patterns.length === 0) return null;

  return {
    patterns,
    allowedPatterns: (settings?.[keys.allow] as readonly string[] | undefined) ?? [],
    deniedPatterns: (settings?.[keys.deny] as readonly string[] | undefined) ?? [],
    allowKey: keys.allow,
    denyKey: keys.deny,
  };
}
