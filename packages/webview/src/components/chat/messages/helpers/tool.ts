import { safeJsonParse } from '@pi-code/webview/components/chat/messages/helpers/common';

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
  execute_command: { ...DEFAULT_TOOL_META, diffLabel: 'Command Output', diffIcon: 'terminal', language: 'shell' },
  read_file: {
    ...DEFAULT_TOOL_META,
    diffLabel: 'File Contents',
    diffIcon: 'file',
    fileTitle: { running: 'Reading file', approval: 'Wants to read file', denied: 'Read denied', done: 'Read file' },
  },
  write_file: {
    ...DEFAULT_TOOL_META,
    diffIcon: 'diff',
    fileIcon: 'new-file',
    language: 'diff',
    fileTitle: { running: 'Writing file', approval: 'Wants to write file', denied: 'Write denied', done: 'Wrote file' },
  },
  edit_file: {
    ...DEFAULT_TOOL_META,
    diffIcon: 'diff',
    fileIcon: 'edit',
    language: 'diff',
    fileTitle: { running: 'Editing file', approval: 'Wants to edit file', denied: 'Edit denied', done: 'Edited file' },
  },
  delete_file: {
    ...DEFAULT_TOOL_META,
    diffLabel: 'Execution Output',
    diffIcon: 'trash',
    fileIcon: 'trash',
    fileTitle: { running: 'Deleting file', approval: 'Wants to delete file', denied: 'Delete denied', done: 'Deleted file' },
  },
  spawn_subagent: { ...DEFAULT_TOOL_META, diffLabel: 'Sub-agent Report', diffIcon: 'organization' },
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
