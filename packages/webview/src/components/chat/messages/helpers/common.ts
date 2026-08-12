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
