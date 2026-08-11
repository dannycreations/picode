import { basename } from 'node:path';
import { AgentSession } from '@earendil-works/pi-coding-agent';
import { RelativePattern, TabInputText, Uri, window, workspace } from 'vscode';

import { readAppSettings } from '@pi-code/extension/core/settings';
import { getGitRepository, getIgnoredPaths } from '@pi-code/extension/utilities/git';
import { toRelativePath, toWorkspaceRelativePath } from '@pi-code/extension/utilities/vscode';

import type { AgentMessage } from '@earendil-works/pi-agent-core';
import type { Change, Repository } from '@pi-code/extension/types/git';
import type { TodoItem } from '@pi-code/shared/utilities/todo';

const STATUS_MAP: Record<TodoItem['status'], string> = {
  pending: 'Pending',
  in_progress: 'In Progress',
  completed: 'Completed',
};

const GITIGNORE_OVERSCAN = 2000;

function formatReminderSection(todoList?: TodoItem[]): string {
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

async function listFiles(cwd: string, limit = 200, excludeIgnoredFiles = true): Promise<{ paths: string[]; hitLimit: boolean }> {
  const maxResults = excludeIgnoredFiles ? limit + GITIGNORE_OVERSCAN : limit + 1;
  const found = await workspace.findFiles(new RelativePattern(cwd, '**/*'), undefined, maxResults);

  let uris = found;
  if (excludeIgnoredFiles) {
    const repo = await getGitRepository(Uri.file(cwd));
    if (repo) {
      const ignored = await getIgnoredPaths(
        repo,
        found.map((uri) => uri.fsPath),
      );
      uris = found.filter((uri) => !ignored.has(uri.fsPath));
    }
  }

  const paths = uris.map((uri) => toRelativePath(uri));
  paths.sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));
  return { paths: paths.slice(0, limit), hitLimit: uris.length > limit };
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
    for (let i = 0; i < segments.length; i++) {
      const segment = segments[i];
      const isLast = i === segments.length - 1;
      let child = node.children.get(segment);
      if (!child) {
        child = { name: segment, isDir: !isLast, children: new Map() };
        node.children.set(segment, child);
      } else if (!isLast) {
        child.isDir = true;
      }
      node = child;
    }
    if (isDir) {
      node.isDir = true;
    }
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

function getLatestTodoList(messages: readonly AgentMessage[]): TodoItem[] | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.role === 'toolResult' && msg.toolName === 'update_todo') {
      const details: { todos?: TodoItem[] } | undefined = msg.details;
      if (details?.todos) return details.todos;
    }
  }
  return undefined;
}

async function getGitStatusLines(cwd: string): Promise<string[]> {
  const repo: Repository | null = await getGitRepository(Uri.file(cwd));
  if (!repo) return [];

  const describe = (change: Change, label: string): string => `${label} ${toRelativePath(change.uri)}`;

  return [
    ...repo.state.indexChanges.map((c) => describe(c, 'staged   ')),
    ...repo.state.mergeChanges.map((c) => describe(c, 'conflict ')),
    ...repo.state.workingTreeChanges.map((c) => describe(c, 'modified ')),
    ...repo.state.untrackedChanges.map((c) => describe(c, 'untracked')),
  ];
}

export async function getEnvironmentDetails(session: AgentSession, cwd: string, includeFileDetails = false): Promise<string> {
  let details = '';
  const settings = readAppSettings();

  // VS Code Visible Files
  const visibleFilePaths = window.visibleTextEditors
    .map((editor) => editor.document?.uri)
    .filter((uri) => uri !== undefined)
    .map((uri) => toWorkspaceRelativePath(uri))
    .filter((path) => path !== undefined);

  if (visibleFilePaths.length > 0) {
    details += '\n\n### VS Code Visible Files\n\n';
    details += visibleFilePaths.map((p) => `- ${p}`).join('\n');
  }

  // VS Code Open Tabs
  const maxOpenTabsContext = settings.maxOpenTabsContext;
  let openTabPaths = window.tabGroups.all
    .flatMap((group) => group.tabs)
    .filter((tab) => tab.input instanceof TabInputText)
    .map((tab) => toWorkspaceRelativePath((tab.input as TabInputText).uri))
    .filter((path) => path !== undefined);

  if (maxOpenTabsContext > 0 && openTabPaths.length > 0) {
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
  const timeZoneOffset =
    new Intl.DateTimeFormat(undefined, { timeZoneName: 'longOffset' })
      .formatToParts(now)
      .find((part) => part.type === 'timeZoneName')
      ?.value?.replace('GMT', 'UTC') ?? '';
  details += `\n\n### Current Time\n\n- **UTC**: ${now.toISOString()}\n- **User Time Zone**: ${timeZone} (${timeZoneOffset})`;

  // Git Status
  const maxGitStatusFiles = settings.maxGitStatusFiles;
  if (maxGitStatusFiles > 0) {
    try {
      const lines = await getGitStatusLines(cwd);
      if (lines.length > 0) {
        details += '\n\n### Git Status\n\n```\n';
        details += lines.slice(0, maxGitStatusFiles).join('\n');
        if (lines.length > maxGitStatusFiles) {
          details += `\n... and ${lines.length - maxGitStatusFiles} more files`;
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
        const { paths, hitLimit } = await listFiles(cwd, maxWorkspaceFiles, settings.excludeIgnoredFiles);
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
    const messages = session.messages;
    const todoList = getLatestTodoList(messages);
    reminderSection = formatReminderSection(todoList);
  }

  const trimmedDetails = details.trim();
  const body = trimmedDetails ? `${trimmedDetails}\n\n${reminderSection}` : reminderSection;
  return `## Environment Details\n\n${body}`.trim();
}
