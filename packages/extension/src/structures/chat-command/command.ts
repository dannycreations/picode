import { BUILTIN_COMMANDS } from '@pi-code/shared/utilities/commands';

import type { ResourceLoader } from '@earendil-works/pi-coding-agent';
import type { CommandItem } from '@pi-code/shared/core/protocol';

export function collectCommands(loader: ResourceLoader): CommandItem[] {
  const builtins = BUILTIN_COMMANDS.map<CommandItem>((command) => ({
    name: command.name,
    source: 'builtin',
    description: command.description,
  }));

  const prompts = loader.getPrompts().prompts.map<CommandItem>((prompt) => ({
    name: `prompt:${prompt.name}`,
    source: 'prompt',
    description: prompt.description,
  }));

  const skills = loader.getSkills().skills.map<CommandItem>((skill) => ({
    name: `skill:${skill.name}`,
    source: 'skill',
    description: skill.description,
    detail: skill.filePath,
  }));

  return [...builtins, ...prompts, ...skills].sort((a, b) => a.name.localeCompare(b.name));
}
