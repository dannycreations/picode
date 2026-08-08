import { createAgentResources } from '@pi-code/extension/structures/agent-runtime/resource';
import { BUILTIN_COMMANDS } from '@pi-code/shared/commands';

import type { ResourceLoader } from '@earendil-works/pi-coding-agent';
import type { CommandItem } from '@pi-code/shared/protocol';

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
