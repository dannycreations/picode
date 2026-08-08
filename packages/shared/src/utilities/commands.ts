const BUILTIN_COMMAND_PATTERN = /^\/(\S+)\s*$/;

export const BUILTIN_COMMANDS = [
  { name: 'reload', description: 'Reload skills, context files, and configuration without restarting.' },
  { name: 'compact', description: 'Summarize the current conversation to free up context.' },
] as const satisfies ReadonlyArray<{ name: string; description: string }>;

type BuiltinCommandName = (typeof BUILTIN_COMMANDS)[number]['name'];

function isBuiltinCommand(name: string): name is BuiltinCommandName {
  return BUILTIN_COMMANDS.some((command) => command.name === name);
}

export function parseBuiltinCommand(text: string): BuiltinCommandName | null {
  const match = BUILTIN_COMMAND_PATTERN.exec(text.trim());
  if (!match) return null;

  const name = match[1];
  return isBuiltinCommand(name) ? name : null;
}
