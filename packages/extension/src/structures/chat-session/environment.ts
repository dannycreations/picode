import { access, readdir, readFile } from 'node:fs/promises';
import { basename, join, relative } from 'node:path';
import { AgentSession } from '@earendil-works/pi-coding-agent';
import ignore from 'ignore';
import { TabInputText, window } from 'vscode';

import { SettingsService } from '@pi-code/extension/core/settings';
import { spawnGit } from '@pi-code/extension/structures/commit-message/git';

import type { Ignore } from 'ignore';
import type { EnvironmentMessage } from '@pi-code/extension/types/extension';
import type { TodoItem } from '@pi-code/shared/utilities/todo';

const STATUS_MAP: Record<TodoItem['status'], string> = {
  pending: 'Pending',
  in_progress: 'In Progress',
  completed: 'Completed',
};

export function formatReminderSection(todoList?: TodoItem[]): string {
  const lines: string[] = ['### Reminders\n'];

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

interface IgnoreLink {
  readonly basePath: string;
  readonly ignoreInstance: Ignore;
}

async function loadGitignore(dir: string): Promise<Ignore | null> {
  const gitignorePath = join(dir, '.gitignore');
  try {
    await access(gitignorePath);
    const content = await readFile(gitignorePath, 'utf8');
    return ignore().add(content);
  } catch {
    return null;
  }
}

export async function listFiles(cwd: string, limit = 200): Promise<{ paths: string[]; hitLimit: boolean }> {
  const resultPaths: string[] = [];
  let hitLimit = false;

  const rootIgnore = await loadGitignore(cwd);
  const initialChain: IgnoreLink[] = rootIgnore ? [{ basePath: cwd, ignoreInstance: rootIgnore }] : [];

  async function walk(dir: string, chain: IgnoreLink[]) {
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

    let currentChain = chain;
    if (dir !== cwd) {
      const localIgnore = await loadGitignore(dir);
      if (localIgnore) {
        currentChain = [...chain, { basePath: dir, ignoreInstance: localIgnore }];
      }
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

      if (entry.name.startsWith('.')) {
        continue;
      }

      const fullPath = join(dir, entry.name);
      const relPath = relative(cwd, fullPath).replace(/\\/g, '/');

      // Check against current .gitignore chain
      let isIgnored = false;
      for (const link of currentChain) {
        const pathRelativeToLink = relative(link.basePath, fullPath).replace(/\\/g, '/');
        const checkPath = entry.isDirectory() ? pathRelativeToLink + '/' : pathRelativeToLink;
        if (link.ignoreInstance.ignores(checkPath)) {
          isIgnored = true;
          break;
        }
      }

      if (isIgnored) {
        continue;
      }

      if (entry.isDirectory()) {
        resultPaths.push(relPath + '/');
        await walk(fullPath, currentChain);
      } else {
        resultPaths.push(relPath);
      }
    }
  }

  await walk(cwd, initialChain);
  return { paths: resultPaths, hitLimit };
}

interface FileTreeNode {
  readonly name: string;
  isDir: boolean;
  readonly children: Map<string, FileTreeNode>;
}

export function buildFileTree(paths: readonly string[]): FileTreeNode {
  const root: FileTreeNode = { name: '', isDir: true, children: new Map() };
  for (const raw of paths) {
    const isDir = raw.endsWith('/');
    const segments = raw.replace(/\/+$/, '').split('/');
    let node = root;
    for (const segment of segments) {
      let child = node.children.get(segment);
      if (!child) {
        child = { name: segment, isDir: false, children: new Map() };
        node.children.set(segment, child);
      }
      node = child;
    }
    node.isDir = isDir;
  }
  return root;
}

function sortTreeNodes(nodes: FileTreeNode[]): FileTreeNode[] {
  return [...nodes].sort((a, b) => {
    if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
    return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
  });
}

export function renderFileTree(root: FileTreeNode, rootLabel: string): string {
  const lines: string[] = [rootLabel];

  function walk(node: FileTreeNode, prefix: string): void {
    const children = sortTreeNodes([...node.children.values()]);
    children.forEach((child, index) => {
      const isLast = index === children.length - 1;
      const connector = isLast ? '└─ ' : '├─ ';
      lines.push(`${prefix}${connector}${child.name}${child.isDir ? '/' : ''}`);
      if (child.isDir) {
        walk(child, prefix + (isLast ? '   ' : '│  '));
      }
    });
  }

  walk(root, '');
  return lines.join('\n');
}

export function getLatestTodoList(messages: readonly EnvironmentMessage[]): TodoItem[] | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.role === 'toolResult' && msg.toolName === 'update_todo') {
      const details = msg.details as { todos?: TodoItem[] } | null | undefined;
      if (details?.todos) return details.todos;
    }
  }
  return undefined;
}

export async function getEnvironmentDetails(session: AgentSession, cwd: string, includeFileDetails = false): Promise<string> {
  let details = '';
  const settingsService = SettingsService.getInstance(cwd);
  const settings = await settingsService.load();

  // VS Code Visible Files
  const visibleFilePaths = window.visibleTextEditors
    ?.map((editor) => editor.document?.uri?.fsPath)
    .filter(Boolean)
    .map((absolutePath) => relative(cwd, absolutePath).replace(/\\/g, '/'))
    .filter((p) => p && !p.startsWith('..'));

  if (visibleFilePaths && visibleFilePaths.length > 0) {
    details += '\n\n### VS Code Visible Files\n\n';
    details += visibleFilePaths.map((p) => `- ${p}`).join('\n');
  }

  // VS Code Open Tabs
  const maxOpenTabsContext = settings.maxOpenTabsContext;
  let openTabPaths = window.tabGroups.all
    .flatMap((group) => group.tabs)
    .filter((tab) => tab.input instanceof TabInputText)
    .map((tab) => (tab.input as TabInputText).uri.fsPath)
    .filter(Boolean)
    .map((absolutePath) => relative(cwd, absolutePath).replace(/\\/g, '/'))
    .filter((p) => p && !p.startsWith('..'));

  if (maxOpenTabsContext > 0 && openTabPaths && openTabPaths.length > 0) {
    const totalOpenTabs = openTabPaths.length;
    if (openTabPaths.length > maxOpenTabsContext) {
      openTabPaths = openTabPaths.slice(0, maxOpenTabsContext);
    }
    details += '\n\n### VS Code Open Tabs\n\n';
    details += openTabPaths.map((p) => `- ${p}`).join('\n');
    if (totalOpenTabs > maxOpenTabsContext) {
      details += `\n*(Truncated. Showing first ${maxOpenTabsContext} of ${totalOpenTabs} open tabs)*`;
    }
  }

  // Current Time
  const now = new Date();
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const timeZoneOffset = -now.getTimezoneOffset() / 60;
  const timeZoneOffsetHours = Math.floor(Math.abs(timeZoneOffset));
  const timeZoneOffsetMinutes = Math.abs(Math.round((Math.abs(timeZoneOffset) - timeZoneOffsetHours) * 60));
  const timeZoneOffsetStr = `${timeZoneOffset >= 0 ? '+' : '-'}${timeZoneOffsetHours}:${timeZoneOffsetMinutes.toString().padStart(2, '0')}`;
  details += `\n\n### Current Time\n\n- **UTC**: ${now.toISOString()}\n- **User Time Zone**: ${timeZone} (UTC${timeZoneOffsetStr})`;

  // Git Status
  const maxGitStatusFiles = settings.maxGitStatusFiles;
  if (maxGitStatusFiles > 0) {
    try {
      const gitStatus = spawnGit(['status', '--porcelain'], cwd).trim();
      if (gitStatus) {
        const lines = gitStatus.split(/\r?\n/);
        details += '\n\n### Git Status\n\n```\n';
        if (lines.length > maxGitStatusFiles) {
          details += lines.slice(0, maxGitStatusFiles).join('\n');
          details += `\n... and ${lines.length - maxGitStatusFiles} more files`;
        } else {
          details += gitStatus;
        }
        details += '\n```';
      }
    } catch {}
  }

  // Current Workspace Directory Files
  if (includeFileDetails) {
    const maxWorkspaceFiles = settings.maxWorkspaceFiles;
    if (maxWorkspaceFiles > 0) {
      details += `\n\n### Workspace Files (${cwd.replace(/\\/g, '/')})\n\n`;
      const isDesktop = cwd.replace(/\\/g, '/').toLowerCase().endsWith('/desktop');
      if (isDesktop) {
        details += 'Desktop files not shown automatically. Use `execute_command` to explore if needed.';
      } else {
        const { paths, hitLimit } = await listFiles(cwd, maxWorkspaceFiles);
        details += renderFileTree(buildFileTree(paths), basename(cwd));
        if (hitLimit) {
          details += '\n\n*(File list truncated. Use `execute_command` to list files in specific subdirectories if you need to explore further.)*';
        }
      }
    }
  }

  // Reminder Section / Todo list
  let reminderSection = '';
  if (settings.enableTodoTool) {
    const messages = session.agent?.state?.messages || [];
    const todoList = getLatestTodoList(messages);
    reminderSection = formatReminderSection(todoList);
  }

  const trimmedDetails = details.trim();
  const body = trimmedDetails ? `${trimmedDetails}\n\n${reminderSection}` : reminderSection;
  return `## Environment Details\n\n${body}`.trim();
}
