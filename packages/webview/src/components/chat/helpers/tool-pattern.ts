import type { AppSettings, SettingKey } from '@pi-code/shared/core/settings';
import type { ToolChatMessage } from '@pi-code/shared/core/types';

const PATH_TOOL_KEYS: Readonly<Record<string, { readonly allow: SettingKey; readonly deny: SettingKey }>> = {
  read_file: { allow: 'allowedReadPaths', deny: 'deniedReadPaths' },
  write_file: { allow: 'allowedWritePaths', deny: 'deniedWritePaths' },
  edit_file: { allow: 'allowedWritePaths', deny: 'deniedWritePaths' },
  delete_file: { allow: 'allowedDeletePaths', deny: 'deniedDeletePaths' },
};

const CHAIN_SEPARATORS = /(?:\r?\n|&&|\|\||[|;])/;

function extractCommandPatterns(command: string): readonly string[] {
  if (!command || !command.trim()) return [];

  const seen = new Set<string>();
  const patterns: string[] = [];

  for (const raw of command.split(CHAIN_SEPARATORS)) {
    const sub = raw.trim();
    if (!sub) continue;

    if (!seen.has(sub)) {
      seen.add(sub);
      patterns.push(sub);
    }

    const base = sub.split(/\s+/)[0];
    if (base && !seen.has(base)) {
      seen.add(base);
      patterns.push(base);
    }
  }

  return patterns;
}

function mergeCommandPatterns(commands: readonly string[]): string[] {
  const seen = new Set<string>();
  const patterns: string[] = [];
  for (const command of commands) {
    for (const pattern of extractCommandPatterns(command)) {
      if (!seen.has(pattern)) {
        seen.add(pattern);
        patterns.push(pattern);
      }
    }
  }
  return patterns;
}

interface ToolPatternConfig {
  readonly patterns: readonly string[];
  readonly allowedPatterns: readonly string[];
  readonly deniedPatterns: readonly string[];
  readonly allowKey: SettingKey;
  readonly denyKey: SettingKey;
}

function extractToolPaths(message: ToolChatMessage): readonly string[] {
  const paths: string[] = [];

  if (message.files && message.files.length > 0) {
    for (const file of message.files) {
      if (file.path) paths.push(file.path);
    }
    if (paths.length > 0) return paths;
  }

  const args = message.toolArgs;
  if (args) {
    if ('path' in args && typeof args.path === 'string' && args.path) paths.push(args.path);
    else if ('file_path' in args && typeof args.file_path === 'string' && args.file_path) paths.push(args.file_path);
  }

  return paths;
}

export function extractPathPatterns(filePath: string): readonly string[] {
  const normalized = filePath.trim().replace(/\\/g, '/').replace(/\/+$/, '');
  if (!normalized) return [];

  const lastSlash = normalized.lastIndexOf('/');
  const dir = lastSlash > 0 ? normalized.slice(0, lastSlash) : '';
  const candidates = dir ? [normalized, `${dir}/**`] : [normalized];

  return Array.from(new Set(candidates));
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
    if (commands.length === 0) return null;

    const patterns = mergeCommandPatterns(commands);
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

  const paths = [...extractToolPaths(message)];
  for (const section of message.toolSections ?? []) {
    if (section.openPath) paths.push(section.openPath);
  }
  if (paths.length === 0) return null;

  const seen = new Set<string>();
  const patterns: string[] = [];
  for (const path of paths) {
    for (const candidate of extractPathPatterns(path)) {
      if (!seen.has(candidate)) {
        seen.add(candidate);
        patterns.push(candidate);
      }
    }
  }
  if (patterns.length === 0) return null;

  return {
    patterns,
    allowedPatterns: (settings?.[keys.allow] as readonly string[] | undefined) ?? [],
    deniedPatterns: (settings?.[keys.deny] as readonly string[] | undefined) ?? [],
    allowKey: keys.allow,
    denyKey: keys.deny,
  };
}
