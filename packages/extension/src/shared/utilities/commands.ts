const BUILTIN_COMMAND_PATTERN = /^\/(\S+)$/;

export const BUILTIN_COMMANDS = [
  { name: 'reload', description: 'Reload context files, templates, and configuration.' },
  { name: 'compact', description: 'Summarize the current conversation to free up context.' },
  { name: 'update', description: 'Fetch and apply the latest model catalog from providers.' },
] as const satisfies ReadonlyArray<{ name: string; description: string }>;

const BUILTIN_COMMAND_NAMES = new Set<string>(BUILTIN_COMMANDS.map((command) => command.name));

type BuiltinCommandName = (typeof BUILTIN_COMMANDS)[number]['name'];

export function parseBuiltinCommand(text: string): BuiltinCommandName | null {
  const match = BUILTIN_COMMAND_PATTERN.exec(text.trim());
  if (!match) return null;

  const name = match[1] as BuiltinCommandName;
  return BUILTIN_COMMAND_NAMES.has(name) ? name : null;
}
