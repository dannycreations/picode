import type { ChatMessage, ToolArguments, ToolChatMessage, ToolName, ToolSection, ToolStatus } from '@pi-code/shared/core/types';

interface ToolMeta {
  readonly fileIcon: string;
  readonly language: string;
  readonly fileTitle: {
    readonly running: string;
    readonly approval: string;
    readonly denied: string;
    readonly done: string;
  };
}

const DEFAULT_TOOL_META: ToolMeta = {
  fileIcon: 'file',
  language: 'text',
  fileTitle: {
    running: 'File operation',
    approval: 'File operation',
    denied: 'File operation',
    done: 'File operation',
  },
};

const TOOL_META: Readonly<Record<string, ToolMeta>> = {
  execute_command: {
    ...DEFAULT_TOOL_META,
    fileIcon: 'terminal',
    language: 'shell',
    fileTitle: {
      running: 'Running command',
      approval: 'Wants to run command',
      denied: 'Command denied',
      done: 'Ran command',
    },
  },
  read_file: {
    ...DEFAULT_TOOL_META,
    fileTitle: {
      running: 'Reading file',
      approval: 'Wants to read file',
      denied: 'Read denied',
      done: 'Read file',
    },
  },
  write_file: {
    ...DEFAULT_TOOL_META,
    fileIcon: 'new-file',
    language: 'diff',
    fileTitle: {
      running: 'Writing file',
      approval: 'Wants to write file',
      denied: 'Write denied',
      done: 'Wrote file',
    },
  },
  edit_file: {
    ...DEFAULT_TOOL_META,
    fileIcon: 'edit',
    language: 'diff',
    fileTitle: {
      running: 'Editing file',
      approval: 'Wants to edit file',
      denied: 'Edit denied',
      done: 'Edited file',
    },
  },
  delete_file: {
    ...DEFAULT_TOOL_META,
    fileIcon: 'trash',
    fileTitle: {
      running: 'Deleting file',
      approval: 'Wants to delete file',
      denied: 'Delete denied',
      done: 'Deleted file',
    },
  },
  spawn_subagent: {
    ...DEFAULT_TOOL_META,
    fileIcon: 'organization',
    fileTitle: {
      running: 'Spawning sub-agent',
      approval: 'Wants to spawn sub-agent',
      denied: 'Sub-agent denied',
      done: 'Ran sub-agent',
    },
  },
  mcp: {
    ...DEFAULT_TOOL_META,
    fileIcon: 'plug',
    fileTitle: {
      running: 'Calling MCP',
      approval: 'Wants to call MCP',
      denied: 'MCP call denied',
      done: 'Called MCP',
    },
  },
};

// Tools whose result messages render as expandable sections in the webview.
const GROUP_TOOL_NAMES = [
  'execute_command',
  'read_file',
  'write_file',
  'edit_file',
  'delete_file',
  'spawn_subagent',
  'mcp',
] as const satisfies readonly ToolName[];

export const GROUP_TOOLS: ReadonlySet<ToolName> = new Set(GROUP_TOOL_NAMES);

function toolMeta(toolName?: string): ToolMeta {
  return TOOL_META[toolName ?? ''] ?? DEFAULT_TOOL_META;
}

function getToolLanguage(toolName?: string): string {
  return toolMeta(toolName).language;
}

function getToolFilePath(toolArgs?: ToolArguments): string | undefined {
  if (!toolArgs) return undefined;
  if ('path' in toolArgs && typeof toolArgs.path === 'string') return toolArgs.path;
  if ('file_path' in toolArgs && typeof toolArgs.file_path === 'string') return toolArgs.file_path;
  if ('files' in toolArgs && Array.isArray(toolArgs.files)) {
    const first = toolArgs.files[0];
    if (first && typeof first.path === 'string') return first.path;
  }
  return undefined;
}

function commandSection(message: ToolChatMessage): ToolSection[] {
  const args = message.toolArgs;
  const command = args && 'command' in args && typeof args.command === 'string' ? args.command : undefined;

  if (command === undefined && message.diff === undefined) return [];

  let title: string;
  if (command !== undefined) {
    title = command;
  } else if (message.text !== message.toolName) {
    title = message.text;
  } else {
    title = 'Command';
  }

  return [{ title, content: message.diff, language: 'shell' }];
}

function subagentSection(message: ToolChatMessage): ToolSection[] {
  const args = message.toolArgs;
  const agent = args && 'agent' in args && typeof args.agent === 'string' ? args.agent : message.subagent;
  const description = args && 'description' in args && typeof args.description === 'string' ? args.description : undefined;
  let title: string;
  if (agent && description) {
    title = `${agent}: ${description}`;
  } else if (agent) {
    title = agent;
  } else if (description) {
    title = description;
  } else {
    title = 'Sub-agent';
  }
  return [{ title, subtitle: message.subtitle, content: message.diff, language: 'text' }];
}

function mcpSection(message: ToolChatMessage): ToolSection[] {
  const args = message.toolArgs;
  const server = args && 'server' in args && typeof args.server === 'string' ? args.server : undefined;
  const tool = args && 'tool' in args && typeof args.tool === 'string' ? args.tool : undefined;
  const callArguments = args && 'arguments' in args && args.arguments !== undefined ? args.arguments : undefined;

  let title = 'List servers';
  if (server !== undefined) {
    title = tool === undefined ? `${server}: list tools` : `${server}: ${tool}`;
  }

  const pendingPayload = callArguments === undefined ? undefined : JSON.stringify(callArguments, null, 2);
  const content = message.diff ?? pendingPayload;

  return [{ title, subtitle: message.subtitle, content, language: message.diff === undefined ? 'json' : 'text' }];
}

function fileToolSections(message: ToolChatMessage): ToolSection[] {
  if (message.files && message.files.length > 0) {
    return message.files.map((file) => ({
      title: file.path,
      content: file.content,
      language: getToolLanguage(message.toolName),
      openPath: file.path,
    }));
  }

  const path = getToolFilePath(message.toolArgs);
  if (path || message.diff) {
    return [{ title: path ?? 'File', content: message.diff, language: getToolLanguage(message.toolName), openPath: path }];
  }

  return [];
}

export function buildToolSections(message: ChatMessage): ToolSection[] {
  if (message.sender !== 'tool') return [];

  let sections: ToolSection[];
  if (message.toolName === 'execute_command') sections = commandSection(message);
  else if (message.toolName === 'spawn_subagent') sections = subagentSection(message);
  else if (message.toolName === 'mcp') sections = mcpSection(message);
  else sections = fileToolSections(message);

  const withMeta = sections.map((section) => ({
    ...section,
    id: message.id,
    ts: message.ts,
    duration: message.duration,
    status: message.toolStatus,
  }));

  if (message.toolStatus !== 'approval') return withMeta;
  if (withMeta.length > 0) {
    return withMeta.map((section) => ({ ...section, approvalMessage: message }));
  }
  return [
    {
      title: message.toolName ?? 'Tool',
      id: message.id,
      ts: message.ts,
      duration: message.duration,
      status: 'approval',
      approvalMessage: message,
    },
  ];
}

export function getToolHeaderMeta(toolName: string | undefined, status?: ToolStatus): { title: string; icon: string } {
  const meta = toolMeta(toolName);
  const state = status === undefined || status === 'completed' ? 'done' : status;
  return { title: meta.fileTitle[state], icon: meta.fileIcon };
}

interface DiffStat {
  readonly added: number;
  readonly removed: number;
}

export function getFirstDiffLine(diff?: string): number | undefined {
  if (!diff) return undefined;
  const match = diff.match(/^@@ -\d+(?:,\d+)? \+(\d+)/m);
  if (!match) return undefined;
  const line = Number.parseInt(match[1], 10);
  return Number.isFinite(line) && line > 0 ? line : undefined;
}

export function getDiffStat(diff?: string): DiffStat | undefined {
  if (!diff) return undefined;
  let added = 0;
  let removed = 0;
  for (const line of diff.split('\n')) {
    if (/^\+\+\+ /.test(line) || /^--- /.test(line)) continue;
    if (line.startsWith('+')) added++;
    else if (line.startsWith('-')) removed++;
  }
  if (added === 0 && removed === 0) return undefined;
  return { added, removed };
}
