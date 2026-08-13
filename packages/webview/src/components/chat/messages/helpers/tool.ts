import { safeJsonParse } from '@pi-code/webview/components/chat/messages/helpers/common';

import type { ChatMessage, ToolName, ToolSection } from '@pi-code/shared/core/types';

export const GROUP_TOOLS: ReadonlySet<ToolName> = new Set([
  'read_file',
  'write_file',
  'edit_file',
  'delete_file',
  'execute_command',
  'spawn_subagent',
]);

interface ToolMeta {
  readonly diffLabel: string;
  readonly diffIcon: string;
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
  diffLabel: 'File Changes',
  diffIcon: 'diff',
  fileIcon: 'file',
  language: 'text',
  fileTitle: { running: 'File operation', approval: 'File operation', denied: 'File operation', done: 'File operation' },
};

const TOOL_META: Readonly<Record<string, ToolMeta>> = {
  execute_command: {
    ...DEFAULT_TOOL_META,
    diffLabel: 'Command Output',
    diffIcon: 'terminal',
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
    diffLabel: 'File Contents',
    diffIcon: 'file',
    fileTitle: {
      running: 'Reading file',
      approval: 'Wants to read file',
      denied: 'Read denied',
      done: 'Read file',
    },
  },
  write_file: {
    ...DEFAULT_TOOL_META,
    diffIcon: 'diff',
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
    diffIcon: 'diff',
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
    diffLabel: 'Execution Output',
    diffIcon: 'trash',
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
    diffLabel: 'Sub-agent Report',
    diffIcon: 'organization',
    fileIcon: 'organization',
    fileTitle: {
      running: 'Spawning sub-agent',
      approval: 'Wants to spawn sub-agent',
      denied: 'Sub-agent denied',
      done: 'Ran sub-agent',
    },
  },
};

function toolMeta(toolName?: string): ToolMeta {
  return (toolName && TOOL_META[toolName]) || DEFAULT_TOOL_META;
}

export function getToolLanguage(toolName?: string): string {
  return toolMeta(toolName).language;
}

export function getToolDiffMeta(toolName?: string): { label: string; icon: string } {
  const meta = toolMeta(toolName);
  return { label: meta.diffLabel, icon: meta.diffIcon };
}

export function getToolFilePath(toolArgs?: string): string | undefined {
  const parsed = safeJsonParse<Record<string, unknown>>(toolArgs);
  if (!parsed || typeof parsed !== 'object') return undefined;

  for (const key of ['path', 'file_path']) {
    if (typeof parsed[key] === 'string') return parsed[key];
  }

  const files = parsed['files'];
  if (Array.isArray(files) && typeof files[0]?.path === 'string') {
    return files[0].path;
  }

  return undefined;
}

function parseToolArgs(toolArgs?: string): Record<string, unknown> | undefined {
  const parsed = safeJsonParse<Record<string, unknown>>(toolArgs);
  return parsed && typeof parsed === 'object' ? parsed : undefined;
}

function commandSection(message: ChatMessage): ToolSection[] {
  if (message.diff === undefined) return [];

  const args = parseToolArgs(message.toolArgs);
  const command = typeof args?.['command'] === 'string' ? args['command'] : undefined;
  const title = command ?? (message.text !== message.toolName ? message.text : undefined) ?? 'Command';

  return [{ title, content: message.diff, language: 'shell' }];
}

function subagentSection(message: ChatMessage): ToolSection[] {
  const args = parseToolArgs(message.toolArgs);
  const agent = typeof args?.['agent'] === 'string' ? args['agent'] : message.subagent;
  const description = typeof args?.['description'] === 'string' ? args['description'] : undefined;
  return [{ title: description ?? agent ?? 'Sub-agent', subtitle: agent, content: message.diff, language: 'text' }];
}

function fileToolSections(message: ChatMessage): ToolSection[] {
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
  if (message.toolName === 'execute_command') return commandSection(message);
  if (message.toolName === 'spawn_subagent') return subagentSection(message);
  return fileToolSections(message);
}

export function getFileToolMeta(toolName: string | undefined, status?: string): { title: string; icon: string; language: string } {
  const meta = toolMeta(toolName);
  const title =
    status === 'running'
      ? meta.fileTitle.running
      : status === 'approval'
        ? meta.fileTitle.approval
        : status === 'denied'
          ? meta.fileTitle.denied
          : meta.fileTitle.done;

  return { title, icon: meta.fileIcon, language: meta.language };
}
