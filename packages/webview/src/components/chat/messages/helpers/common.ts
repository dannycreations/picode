export function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

export function getToolLanguage(toolName?: string): string {
  if (toolName === 'execute_command') {
    return 'shell';
  }
  if (toolName === 'write_file' || toolName === 'edit_file') {
    return 'diff';
  }
  return 'text';
}

export function getToolDiffMeta(toolName?: string): { label: string; icon: string } {
  switch (toolName) {
    case 'execute_command':
      return { label: 'Command Output', icon: 'terminal' };
    case 'read_file':
      return { label: 'File Contents', icon: 'file' };
    case 'delete_file':
      return { label: 'Execution Output', icon: 'trash' };
    case 'spawn_subagent':
      return { label: 'Sub-agent Report', icon: 'organization' };
    default:
      return { label: 'File Changes', icon: 'diff' };
  }
}

export function getToolFilePath(toolArgs?: string): string | undefined {
  if (!toolArgs) return undefined;
  try {
    const parsed = JSON.parse(toolArgs) as Record<string, unknown> | null;
    if (!parsed || typeof parsed !== 'object') return undefined;

    for (const key of ['path', 'file_path']) {
      if (typeof parsed[key] === 'string') return parsed[key];
    }

    const files = parsed['files'];
    if (Array.isArray(files) && typeof files[0]?.path === 'string') {
      return files[0].path;
    }
  } catch {}
  return undefined;
}

export interface FileSection {
  readonly path: string;
  readonly content: string;
}

export interface FileToolMeta {
  readonly title: string;
  readonly icon: string;
  readonly language: string;
}

export function getFileToolMeta(toolName: string | undefined, status?: string): FileToolMeta {
  const running = status === 'running';
  const wants = status === 'approval';
  const denied = status === 'denied';

  switch (toolName) {
    case 'read_file':
      return {
        title: running ? 'Reading file' : wants ? 'Wants to read file' : denied ? 'Read denied' : 'Read file',
        icon: 'file',
        language: 'text',
      };
    case 'write_file':
      return {
        title: running ? 'Writing file' : wants ? 'Wants to write file' : denied ? 'Write denied' : 'Wrote file',
        icon: 'new-file',
        language: 'diff',
      };
    case 'edit_file':
      return {
        title: running ? 'Editing file' : wants ? 'Wants to edit file' : denied ? 'Edit denied' : 'Edited file',
        icon: 'edit',
        language: 'diff',
      };
    case 'delete_file':
      return {
        title: running ? 'Deleting file' : wants ? 'Wants to delete file' : denied ? 'Delete denied' : 'Deleted file',
        icon: 'trash',
        language: 'text',
      };
    default:
      return { title: 'File operation', icon: 'file', language: 'text' };
  }
}

// A tool result is either `{ details: { result | response } }` or an
// Anthropic-style `{ content: [{ text }] }`. Return the first human text.
export function extractResultText(parsed: unknown): string {
  if (!parsed || typeof parsed !== 'object') return '';
  const result = parsed as { details?: { result?: unknown; response?: unknown }; content?: unknown };
  if (typeof result.details?.result === 'string') return result.details.result;
  if (typeof result.details?.response === 'string') return result.details.response;
  if (Array.isArray(result.content) && typeof result.content[0]?.text === 'string') return result.content[0].text;
  return '';
}

export function parseCompletionResult(toolArgs?: string, diff?: string): string {
  if (toolArgs) {
    try {
      const parsed = JSON.parse(toolArgs);
      if (parsed && typeof parsed.result === 'string') {
        return parsed.result;
      }
    } catch {}
  }

  if (diff) {
    try {
      const parsed = JSON.parse(diff);
      const text = extractResultText(parsed);
      if (text) return text;
    } catch {
      return diff;
    }
  }

  return '';
}
