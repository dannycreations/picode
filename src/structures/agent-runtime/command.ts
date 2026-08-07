import { createAgentResources } from '@extension/structures/agent-runtime/resource';

import type { ResourceLoader } from '@earendil-works/pi-coding-agent';
import type { CommandItem } from '@extension/types/webview';

export const BUILTIN_COMMANDS: ReadonlyArray<{ name: CommandItem['name']; description: string }> = [
  { name: 'reload', description: 'Reload skills, context files, and configuration without restarting.' },
  { name: 'compact', description: 'Summarize the current conversation to free up context.' },
];

export function isBuiltinCommand(name: string): boolean {
  return BUILTIN_COMMANDS.some((command) => command.name === name);
}

export function parseBuiltinCommand(text: string): string | null {
  const match = /^\/(\S+)\s*$/.exec(text.trim());
  if (!match) return null;

  const name = match[1];
  return isBuiltinCommand(name) ? name : null;
}

export function collectCommands(loader: ResourceLoader): CommandItem[] {
  const skills = loader.getSkills().skills.map<CommandItem>((skill) => ({
    name: `skill:${skill.name}`,
    source: 'skill',
    description: skill.description,
    detail: skill.filePath,
  }));

  const builtins = BUILTIN_COMMANDS.map<CommandItem>((command) => ({
    name: command.name,
    source: 'builtin',
    description: command.description,
    builtin: true,
  }));

  return [...skills, ...builtins].sort((a, b) => a.name.localeCompare(b.name));
}

export async function listCommands(cwd: string): Promise<CommandItem[]> {
  const { resourceLoader } = await createAgentResources(cwd);
  return collectCommands(resourceLoader);
}
