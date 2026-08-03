import { readdir } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { AgentSession } from '@earendil-works/pi-coding-agent';
import { TabInputText, window } from 'vscode';

import { spawnGit } from '@extension/structures/commit-message/git';

import type { AgentToolState, EnvironmentMessage, EnvironmentMessageContent } from '@extension/types/extension';

interface TodoItem {
  readonly content: string;
  readonly status: 'pending' | 'completed' | 'in_progress';
}

export function parseTodoList(todoListStr: string): TodoItem[] {
  const lines = todoListStr.split(/\r?\n/);
  const list: TodoItem[] = [];
  for (const line of lines) {
    const match = line.match(/^(?:-\s*)?\[\s*([ xX\-~])\s*\]\s*(.+)$/);
    if (match) {
      const indicator = match[1].toLowerCase();
      const status = indicator === 'x' ? 'completed' : indicator === '-' || indicator === '~' ? 'in_progress' : 'pending';
      list.push({ content: match[2].trim(), status });
    }
  }
  return list;
}

const STATUS_MAP: Record<TodoItem['status'], string> = {
  pending: 'Pending',
  in_progress: 'In Progress',
  completed: 'Completed',
};

export function formatReminderSection(todoList?: TodoItem[]): string {
  const lines: string[] = ['### Reminders', '\n\n'];

  if (!todoList || todoList.length === 0) {
    lines.push('You have not created a todo list yet. Create one with `update_todo` if your task is complicated or involves multiple steps.');
    return lines.join('\n');
  }

  lines.push('Below is your current list of reminders for this task. Keep them updated as you progress.', '');
  lines.push('| # | Content | Status |');
  lines.push('|---|---------|--------|');
  todoList.forEach((item, idx) => {
    const escapedContent = item.content.replace(/\\/g, '\\\\').replace(/\|/g, '\\|');
    lines.push(`| ${idx + 1} | ${escapedContent} | ${STATUS_MAP[item.status] || item.status} |`);
  });
  lines.push('');

  lines.push('IMPORTANT: When task status changes, remember to call the `update_todo` tool to update your progress.');
  return lines.join('\n');
}

const IGNORE_LIST = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  'out',
  '.vscode',
  '.idea',
  '.pnpm-store',
  'package-lock.json',
  'pnpm-lock.yaml',
  'yarn.lock',
  'bun.lockb',
]);

async function listFiles(cwd: string, limit = 200): Promise<{ paths: string[]; hitLimit: boolean }> {
  const resultPaths: string[] = [];
  let hitLimit = false;

  async function walk(dir: string) {
    if (resultPaths.length >= limit) {
      hitLimit = true;
      return;
    }

    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }

    // Sort to put directories first, then files
    entries.sort((a, b) => {
      if (a.isDirectory() && !b.isDirectory()) return -1;
      if (!a.isDirectory() && b.isDirectory()) return 1;
      return a.name.localeCompare(b.name);
    });

    for (const entry of entries) {
      if (resultPaths.length >= limit) {
        hitLimit = true;
        return;
      }

      if (IGNORE_LIST.has(entry.name) || entry.name.startsWith('.')) {
        continue;
      }

      const fullPath = join(dir, entry.name);
      const relPath = relative(cwd, fullPath).replace(/\\/g, '/');

      if (entry.isDirectory()) {
        resultPaths.push(relPath + '/');
        await walk(fullPath);
      } else {
        resultPaths.push(relPath);
      }
    }
  }

  await walk(cwd);
  return { paths: resultPaths, hitLimit };
}

export function getLatestTodoList(messages: readonly EnvironmentMessage[]): string | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.role === 'toolResult' && msg.toolName === 'update_todo') {
      const details = msg.details as { todos?: string } | null | undefined;
      if (details?.todos) {
        return details.todos;
      }
      const content = msg.content;
      if (Array.isArray(content)) {
        const textContent = content.find((c: EnvironmentMessageContent) => c.type === 'text') as EnvironmentMessageContent | undefined;
        if (textContent?.text) {
          return textContent.text;
        }
      } else if (typeof content === 'string') {
        return content;
      }
    }
  }
  return undefined;
}

export async function getEnvironmentDetails(session: AgentSession, cwd: string, includeFileDetails = false): Promise<string> {
  let details = '';

  // 1. VS Code Visible Files
  const visibleFilePaths = window.visibleTextEditors
    ?.map((editor) => editor.document?.uri?.fsPath)
    .filter(Boolean)
    .map((absolutePath) => relative(cwd, absolutePath).replace(/\\/g, '/'))
    .filter((p) => p && !p.startsWith('..'));

  if (visibleFilePaths && visibleFilePaths.length > 0) {
    details += '\n\n### VS Code Visible Files\n\n';
    details += visibleFilePaths.map((p) => `- ${p}`).join('\n');
  }

  // 2. VS Code Open Tabs
  const openTabPaths = window.tabGroups.all
    .flatMap((group) => group.tabs)
    .filter((tab) => tab.input instanceof TabInputText)
    .map((tab) => (tab.input as TabInputText).uri.fsPath)
    .filter(Boolean)
    .map((absolutePath) => relative(cwd, absolutePath).replace(/\\/g, '/'))
    .filter((p) => p && !p.startsWith('..'));

  if (openTabPaths && openTabPaths.length > 0) {
    details += '\n\n### VS Code Open Tabs\n\n';
    details += openTabPaths.map((p) => `- ${p}`).join('\n');
  }

  // 3. Current Time
  const now = new Date();
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const timeZoneOffset = -now.getTimezoneOffset() / 60;
  const timeZoneOffsetHours = Math.floor(Math.abs(timeZoneOffset));
  const timeZoneOffsetMinutes = Math.abs(Math.round((Math.abs(timeZoneOffset) - timeZoneOffsetHours) * 60));
  const timeZoneOffsetStr = `${timeZoneOffset >= 0 ? '+' : '-'}${timeZoneOffsetHours}:${timeZoneOffsetMinutes.toString().padStart(2, '0')}`;
  details += `\n\n### Current Time\n\n- **UTC**: ${now.toISOString()}\n- **User Time Zone**: ${timeZone} (UTC${timeZoneOffsetStr})`;

  // 4. Git Status
  try {
    const gitStatus = spawnGit(['status', '--porcelain'], cwd).trim();
    if (gitStatus) {
      details += `\n\n### Git Status\n\n\`\`\`\n${gitStatus}\n\`\`\``;
    }
  } catch {
    // Not a git repository or git fails, ignore
  }

  // 5. Current Mode
  const modelId = session.agent?.state?.model?.id || 'unknown';
  const activeTools = session.agent?.state?.tools?.map((t: AgentToolState) => t.name).join(', ') || '';
  const thinkingLevel = session.agent?.state?.thinkingLevel || 'off';
  details += `\n\n### Current Mode\n\n- **Model**: ${modelId}\n- **Thinking Level**: ${thinkingLevel}\n- **Active Tools**: ${activeTools}`;

  // 6. Current Workspace Directory Files
  if (includeFileDetails) {
    details += `\n\n### Workspace Files (${cwd.replace(/\\/g, '/')})\n\n`;
    const isDesktop = cwd.replace(/\\/g, '/').toLowerCase().endsWith('/desktop');
    if (isDesktop) {
      details += 'Desktop files not shown automatically. Use execute_command to explore if needed.';
    } else {
      const { paths, hitLimit } = await listFiles(cwd, 200);
      const sorted = paths.sort((a, b) => {
        const aParts = a.split('/');
        const bParts = b.split('/');
        for (let i = 0; i < Math.min(aParts.length, bParts.length); i++) {
          if (aParts[i] !== bParts[i]) {
            if (i + 1 === aParts.length && i + 1 < bParts.length) {
              return -1;
            }
            if (i + 1 === bParts.length && i + 1 < aParts.length) {
              return 1;
            }
            return aParts[i].localeCompare(bParts[i], undefined, { numeric: true, sensitivity: 'base' });
          }
        }
        return aParts.length - bParts.length;
      });
      details += sorted.map((p) => `- ${p}`).join('\n');
      if (hitLimit) {
        details += '\n\n*(File list truncated. Use execute_command to list files in specific subdirectories if you need to explore further.)*';
      }
    }
  }

  // 7. Todo list / Reminder Section
  const messages = session.agent?.state?.messages || [];
  const todoListStr = getLatestTodoList(messages);
  const todoList = todoListStr ? parseTodoList(todoListStr) : undefined;
  const reminderSection = formatReminderSection(todoList);

  const trimmedDetails = details.trim();
  const body = trimmedDetails ? `${trimmedDetails}\n\n${reminderSection}` : reminderSection;
  return `## Environment Details\n\n${body}`;
}
