import type { ChatMessage, ToolChatMessage, ToolName, ToolSection, ToolStatus } from '@pi-code/shared/core/types';

interface ToolMeta {
  readonly fileIcon: string;
  readonly language: string;
  readonly fileTitle: {
    readonly running: string;
    readonly approval: string;
    readonly denied: string;
    readonly failed: string;
    readonly done: string;
    readonly cancelled?: string;
  };
}

const DEFAULT_TOOL_META: ToolMeta = {
  fileIcon: 'file',
  language: 'text',
  fileTitle: {
    running: 'Running tool call',
    approval: 'Wants to call tool',
    denied: 'Tool call denied',
    failed: 'Tool call failed',
    done: 'Tool call success',
  },
};

// Tools whose result messages render as expandable sections in the webview.
// Each key here is both a valid tool name and a groupable tool.
const TOOL_META = {
  execute_command: {
    ...DEFAULT_TOOL_META,
    fileIcon: 'terminal',
    language: 'shell',
    fileTitle: {
      running: 'Running command',
      approval: 'Wants to run command',
      denied: 'Command denied',
      failed: 'Command failed',
      done: 'Ran command',
      cancelled: 'Command cancelled',
    },
  },
  read_file: {
    ...DEFAULT_TOOL_META,
    fileTitle: {
      running: 'Reading file',
      approval: 'Wants to read file',
      denied: 'Read denied',
      failed: 'Read failed',
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
      failed: 'Write failed',
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
      failed: 'Edit failed',
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
      failed: 'Delete failed',
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
      failed: 'Sub-agent failed',
      done: 'Ran sub-agent',
      cancelled: 'Sub-agent cancelled',
    },
  },
  mcp: {
    ...DEFAULT_TOOL_META,
    fileIcon: 'plug',
    fileTitle: {
      running: 'Calling MCP',
      approval: 'Wants to call MCP',
      denied: 'MCP call denied',
      failed: 'MCP call failed',
      done: 'Called MCP',
    },
  },
} satisfies Partial<Record<ToolName, ToolMeta>>;

type GroupToolName = keyof typeof TOOL_META;

export const GROUP_TOOLS: ReadonlySet<ToolName> = new Set(Object.keys(TOOL_META) as GroupToolName[]);

export const CANCELLABLE_TOOLS: ReadonlySet<ToolName> = new Set(['execute_command', 'spawn_subagent']);

function hasToolMeta(toolName: ToolName): toolName is GroupToolName {
  return toolName in TOOL_META;
}

function toolMeta(toolName?: ToolName): ToolMeta {
  if (toolName === undefined || !hasToolMeta(toolName)) return DEFAULT_TOOL_META;
  return TOOL_META[toolName];
}

export function getToolCommand(message: ToolChatMessage): string | undefined {
  const args = message.toolArgs;
  return args && 'command' in args && typeof args.command === 'string' ? args.command : undefined;
}

export function getToolFilePaths(message: ToolChatMessage): readonly string[] {
  const resultPaths = (message.files ?? []).map((file) => file.path);
  if (resultPaths.length > 0) return resultPaths;

  const args = message.toolArgs;
  if (!args) return [];
  if ('path' in args && typeof args.path === 'string' && args.path) return [args.path];

  const requested = 'files' in args && Array.isArray(args.files) ? args.files[0] : undefined;
  return requested && typeof requested.path === 'string' ? [requested.path] : [];
}

function commandSection(message: ToolChatMessage): ToolSection[] {
  const command = getToolCommand(message);

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
  const description = args && 'description' in args && typeof args.description === 'string' ? args.description : undefined;
  return [{ title: description || 'Sub-agent', subtitle: message.subtitle, content: message.diff, language: 'text' }];
}

function stringifyArguments(callArguments: unknown): string {
  try {
    return JSON.stringify(callArguments, null, 2);
  } catch {
    return String(callArguments);
  }
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

  // The arguments only stand in for a result that has not arrived yet.
  const content = message.diff ?? (callArguments === undefined ? undefined : stringifyArguments(callArguments));
  return [{ title, subtitle: message.subtitle, content, language: message.diff === undefined ? 'json' : 'text' }];
}

function fileToolSections(message: ToolChatMessage): ToolSection[] {
  if (message.files && message.files.length > 0) {
    return message.files.map((file) => ({
      title: file.path,
      content: file.content,
      language: toolMeta(message.toolName).language,
      openPath: file.path,
    }));
  }

  const [path] = getToolFilePaths(message);
  if (path || message.diff) {
    return [{ title: path ?? 'File', content: message.diff, language: toolMeta(message.toolName).language, openPath: path }];
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
    timestamp: message.timestamp,
    duration: message.duration,
    status: message.toolStatus,
    ...(message.exitCode !== undefined ? { exitCode: message.exitCode } : {}),
  }));

  if (message.toolStatus !== 'approval') return withMeta;
  if (withMeta.length > 0) {
    return withMeta.map((section) => ({ ...section, approvalMessage: message }));
  }
  return [
    {
      title: message.toolName ?? 'Tool',
      id: message.id,
      timestamp: message.timestamp,
      duration: message.duration,
      status: 'approval',
      approvalMessage: message,
    },
  ];
}

export function getToolHeaderMeta(toolName: ToolName | undefined, status?: ToolStatus, exitCode?: number | null): { title: string; icon: string } {
  const meta = toolMeta(toolName);
  // 'denied' carries two meanings: a call the user rejected, and one that ran
  // and failed. Only a call that reached a process records an exit code, so its
  // presence is what separates the two. A transcript saved before the code was
  // recorded leaves it missing and keeps the older wording.
  const ranThenFailed = status === 'denied' && exitCode !== undefined;
  const state = ranThenFailed ? 'failed' : status === undefined || status === 'completed' ? 'done' : status;
  // A call the user stopped is neither a denial nor a failure, so it keeps its
  // own wording.
  const title = state === 'cancelled' ? (meta.fileTitle.cancelled ?? 'Tool call cancelled') : meta.fileTitle[state];
  return { title, icon: meta.fileIcon };
}

interface DiffStat {
  readonly added: number;
  readonly removed: number;
}

const FIRST_DIFF_LINE = /^[+-][^\S\r\n]*(\d+)/m;

export function getFirstDiffLine(diff?: string): number | undefined {
  if (!diff) return undefined;

  const match = FIRST_DIFF_LINE.exec(diff);
  if (!match) return undefined;

  const lineNum = Number.parseInt(match[1], 10);
  return lineNum > 0 ? lineNum : undefined;
}

export function getDiffStat(diff?: string): DiffStat | undefined {
  if (!diff) return undefined;

  let added = 0;
  let removed = 0;

  for (const line of diff.split('\n')) {
    if (line.startsWith('+++ ') || line.startsWith('--- ')) continue;
    if (line.startsWith('+')) added++;
    else if (line.startsWith('-')) removed++;
  }

  if (added === 0 && removed === 0) return undefined;
  return { added, removed };
}
