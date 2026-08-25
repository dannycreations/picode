import { PROMPT_COMMAND_PREFIX, SKILL_COMMAND_PREFIX } from '@pi-code/extension/structures/chat-command/invocation';
import { BUILTIN_COMMANDS } from '@pi-code/shared/utilities/commands';

import type { ResourceLoader } from '@earendil-works/pi-coding-agent';
import type { CommandItem } from '@pi-code/shared/core/protocol';

const PROMPT_NAME_PREFIX = PROMPT_COMMAND_PREFIX.slice(1);
const SKILL_NAME_PREFIX = SKILL_COMMAND_PREFIX.slice(1);

export function collectCommands(loader: ResourceLoader): CommandItem[] {
  const builtins = BUILTIN_COMMANDS.map<CommandItem>((command) => ({
    name: command.name,
    source: 'builtin',
    description: command.description,
  }));

  const prompts = loader.getPrompts().prompts.map<CommandItem>((prompt) => ({
    name: `${PROMPT_NAME_PREFIX}${prompt.name}`,
    source: 'prompt',
    description: prompt.description,
  }));

  const skills = loader.getSkills().skills.map<CommandItem>((skill) => ({
    name: `${SKILL_NAME_PREFIX}${skill.name}`,
    source: 'skill',
    description: skill.description,
    detail: skill.filePath,
  }));

  return [...builtins, ...prompts, ...skills].sort((a, b) => a.name.localeCompare(b.name));
}
