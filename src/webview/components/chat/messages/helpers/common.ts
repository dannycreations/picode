export function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

export function getToolLanguage(toolName?: string, toolText?: string): string {
  if (toolName === 'execute_command') {
    return 'shell';
  }
  if (toolName === 'read_file' && toolText) {
    const match = toolText.match(/(?:\.([^./\\]+))$/);
    return match ? match[1] : 'text';
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
    case 'ask_question':
      return { label: 'User Response', icon: 'comment' };
    case 'delete_file':
      return { label: 'Execution Output', icon: 'trash' };
    default:
      return { label: 'File Changes Diff', icon: 'diff' };
  }
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
      if (parsed?.details && typeof parsed.details.result === 'string') {
        return parsed.details.result;
      }
      if (Array.isArray(parsed?.content) && parsed.content[0] && typeof parsed.content[0].text === 'string') {
        return parsed.content[0].text;
      }
    } catch {
      return diff;
    }
  }

  return '';
}
