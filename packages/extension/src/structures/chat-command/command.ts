import { createAgentResources } from '@pi-code/extension/structures/agent-runtime/resource';
import { BUILTIN_COMMANDS } from '@pi-code/shared/utilities/commands';

import type { ResourceLoader } from '@earendil-works/pi-coding-agent';
import type { CommandItem } from '@pi-code/shared/core/protocol';

export function collectCommands(loader: ResourceLoader): CommandItem[] {
  const builtins = BUILTIN_COMMANDS.map<CommandItem>((command) => ({
    name: command.name,
    source: 'builtin',
    description: command.description,
  }));

  const skills = loader.getSkills().skills.map<CommandItem>((skill) => ({
    name: `skill:${skill.name}`,
    source: 'skill',
    description: skill.description,
    detail: skill.filePath,
  }));

  const prompts = loader.getPrompts().prompts.map<CommandItem>((prompt) => ({
    name: prompt.name,
    source: 'prompt',
    description: prompt.description,
  }));

  return [...builtins, ...skills, ...prompts].sort((a, b) => a.name.localeCompare(b.name));
}

export async function listCommands(cwd: string): Promise<CommandItem[]> {
  const { services } = await createAgentResources(cwd);
  return collectCommands(services.resourceLoader);
}
