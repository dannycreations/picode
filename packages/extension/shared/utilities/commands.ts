const BUILTIN_COMMAND_PATTERN = /^\/(\S+)$/;

export const BUILTIN_COMMANDS = [
  { name: 'reload', description: 'Reload context files, templates, and configuration.' },
  { name: 'compact', description: 'Summarize the current conversation to free up context.' },
  { name: 'update', description: 'Fetch and apply the latest model catalog from providers.' },
  { name: 'fork', description: 'Create a new session from the current session file.' },
] as const satisfies ReadonlyArray<{ name: string; description: string }>;

export type BuiltinCommandName = (typeof BUILTIN_COMMANDS)[number]['name'];

export function parseBuiltinCommand(text: string): BuiltinCommandName | null {
  const match = BUILTIN_COMMAND_PATTERN.exec(text.trim());
  if (!match) return null;

  return BUILTIN_COMMANDS.find((command) => command.name === match[1])?.name ?? null;
}
