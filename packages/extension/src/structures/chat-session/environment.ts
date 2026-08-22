import { basename } from 'node:path';
import ignore from 'ignore';
import { FileType, TabInputText, Uri, window, workspace } from 'vscode';

import { readAppSettings } from '@pi-code/extension/core/settings';
import { excludeVcsEntries } from '@pi-code/extension/utilities/fs';
import { getGitRepository, getIgnoredPaths } from '@pi-code/extension/utilities/git';
import { toRelativePath, toWorkspaceRelativePath } from '@pi-code/extension/utilities/vscode';

import type { Change, Repository } from '@pi-code/extension/types/git';
import type { FileChild } from '@pi-code/extension/utilities/fs';

const MAX_WALK_DEPTH = 64;
const WALK_CONCURRENCY = 10;

interface LocalIgnore {
  readonly relativeDir: string;
  readonly filter: ReturnType<typeof ignore>;
}

interface UriNode {
  readonly uri: Uri;
  readonly relative: string;
  readonly depth: number;
  readonly ignores: readonly LocalIgnore[];
}

interface WalkEntry {
  readonly child: FileChild;
  readonly uri: Uri;
  readonly fsPath: string;
}

const textDecoder = new TextDecoder();
const pathCollator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

async function loadGitignoreFilter(gitignoreUri: Uri): Promise<ReturnType<typeof ignore> | null> {
  try {
    const contentBytes = await workspace.fs.readFile(gitignoreUri);
    const content = textDecoder.decode(contentBytes);
    return ignore().add(content);
  } catch {
    return null;
  }
}

function isIgnoredByLocalRules(childRelative: string, isDir: boolean, ignores: readonly LocalIgnore[]): boolean {
  for (let i = 0; i < ignores.length; i++) {
    const { relativeDir, filter } = ignores[i];
    let testPath = childRelative;

    if (relativeDir !== '') {
      if (childRelative === relativeDir) {
        testPath = '';
      } else if (childRelative.startsWith(`${relativeDir}/`)) {
        testPath = childRelative.slice(relativeDir.length + 1);
      } else {
        continue;
      }
    }

    if (testPath === '') continue;

    const pathToTest = isDir ? `${testPath}/` : testPath;
    if (filter.ignores(pathToTest)) return true;
  }
  return false;
}

async function walkConcurrently<T>(seed: readonly T[], concurrency: number, process: (item: T) => Promise<T[]>): Promise<void> {
  const queue: T[] = seed.slice();
  let active = 0;

  return new Promise<void>((resolve, reject) => {
    let settled = false;

    const fail = (err: unknown) => {
      if (!settled) {
        settled = true;
        reject(err);
      }
    };

    const pump = () => {
      if (settled) return;
      if (queue.length === 0 && active === 0) {
        settled = true;
        resolve();
        return;
      }
      while (active < concurrency && queue.length > 0) {
        const item = queue.pop()!;
        active++;
        process(item)
          .then((children) => {
            active--;
            // Avoid `queue.push(...children)`: spreading a large array as call
            // arguments risks a stack overflow and is slower than a plain loop.
            for (let i = 0; i < children.length; i++) queue.push(children[i]);
            pump();
          })
          .catch(fail);
      }
    };

    pump();
  });
}

export async function walkWorkspace(
  cwd: string,
  limit: number,
  excludeIgnoredFiles: boolean,
  sharedRepo?: Repository | null,
): Promise<{ paths: string[]; hitLimit: boolean }> {
  const rootUri = Uri.file(cwd);
  const repo = excludeIgnoredFiles ? (sharedRepo ?? (await getGitRepository(rootUri).catch(() => null))) : null;
  const useLocalGitignore = excludeIgnoredFiles && !repo;

  const fileResults: string[] = [];

  const processNode = async (node: UriNode): Promise<UriNode[]> => {
    const { uri, relative, depth, ignores } = node;

    let children: FileChild[];
    try {
      const raw = await workspace.fs.readDirectory(uri);
      children = excludeVcsEntries(
        raw.map(([name, type]): FileChild => ({
          name,
          isDir: !!(type & FileType.Directory),
          isFile: !!(type & FileType.File),
          isSymlink: !!(type & FileType.SymbolicLink),
        })),
      );
    } catch {
      return [];
    }

    const childCount = children.length;
    if (childCount === 0) return [];

    const entries: WalkEntry[] = children.map((child) => {
      const childUri = Uri.joinPath(uri, child.name);
      return { child, uri: childUri, fsPath: childUri.fsPath };
    });

    let localIgnores = ignores;
    if (useLocalGitignore) {
      const gitignore = entries.find((entry) => entry.child.name === '.gitignore' && entry.child.isFile);
      if (gitignore) {
        const filter = await loadGitignoreFilter(gitignore.uri);
        if (filter) localIgnores = [...ignores, { relativeDir: relative, filter }];
      }
    }

    const ignoredPaths =
      repo && childCount > 0
        ? await getIgnoredPaths(
            repo,
            entries.map((entry) => entry.fsPath),
          )
        : null;

    const nextNodes: UriNode[] = [];
    const relativePrefix = relative === '' ? '' : `${relative}/`;

    for (const { child, uri: childUri, fsPath } of entries) {
      const childRelative = relativePrefix + child.name;

      if (repo) {
        if (ignoredPaths?.has(fsPath)) continue;
      } else if (excludeIgnoredFiles && localIgnores.length > 0) {
        if (isIgnoredByLocalRules(childRelative, child.isDir, localIgnores)) continue;
      }

      if (child.isDir) {
        if (depth < MAX_WALK_DEPTH && !child.isSymlink) {
          nextNodes.push({ uri: childUri, relative: childRelative, depth: depth + 1, ignores: localIgnores });
        }
        continue;
      }

      if (child.isFile) fileResults.push(childRelative);
    }

    return nextNodes;
  };

  await walkConcurrently<UriNode>([{ uri: rootUri, relative: '', depth: 0, ignores: [] }], WALK_CONCURRENCY, processNode);

  fileResults.sort((a, b) => pathCollator.compare(a, b));

  // More matches existed than we show; slicing to `limit` never under-delivers.
  return { paths: fileResults.slice(0, limit), hitLimit: fileResults.length > limit };
}

interface FileTreeNode {
  readonly name: string;
  readonly isDir: boolean;
  readonly children: Map<string, FileTreeNode>;
}

export function buildFileTree(paths: readonly string[]): FileTreeNode {
  const root = { name: '', isDir: true, children: new Map() } satisfies FileTreeNode;
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
    return pathCollator.compare(a.name, b.name);
  });
}

export function renderFileTree(root: FileTreeNode, rootLabel: string): string {
  const lines: string[] = [rootLabel];

  function walk(node: FileTreeNode, prefix: string): void {
    const children = sortTreeNodes([...node.children.values()]);
    children.forEach((child, index) => {
      const isLast = index === children.length - 1;
      const connector = isLast ? '└─ ' : '├─ ';
      const label = `${child.name}${child.isDir ? '/' : ''}`;
      lines.push(`${prefix}${connector}${label}`);
      if (child.isDir) {
        walk(child, prefix + (isLast ? '   ' : '│  '));
      }
    });
  }

  walk(root, '');
  return lines.join('\n');
}

async function getGitStatusLines(cwd: string, sharedRepo?: Repository | null): Promise<string[]> {
  const repo = sharedRepo ?? (await getGitRepository(Uri.file(cwd)));
  if (!repo) return [];

  const describe = (change: Change, label: string): string => `${label} ${toRelativePath(change.uri)}`;

  return [
    ...repo.state.indexChanges.map((c) => describe(c, 'staged   ')),
    ...repo.state.mergeChanges.map((c) => describe(c, 'conflict ')),
    ...repo.state.workingTreeChanges.map((c) => describe(c, 'modified ')),
    ...repo.state.untrackedChanges.map((c) => describe(c, 'untracked')),
  ];
}

export async function getEnvironmentDetails(cwd: string, includeFileDetails = false): Promise<string> {
  let details = '';
  const settings = readAppSettings();

  const maxOpenTabsContext = settings.maxOpenTabsContext;

  if (maxOpenTabsContext > 0) {
    // VS Code Visible Files
    const allVisibleFilePaths = window.visibleTextEditors
      .map((editor) => editor.document?.uri)
      .filter((uri) => uri !== undefined)
      .map((uri) => toWorkspaceRelativePath(uri))
      .filter((path) => path !== undefined);

    if (allVisibleFilePaths.length > 0) {
      const visibleFilePaths = allVisibleFilePaths.slice(0, maxOpenTabsContext);
      details += '\n\n### VS Code Visible Files\n\n';
      details += visibleFilePaths.map((p) => `- ${p}`).join('\n');
      if (allVisibleFilePaths.length > maxOpenTabsContext) {
        details += `\n*(Truncated. Showing first ${maxOpenTabsContext} of ${allVisibleFilePaths.length} visible files)*`;
      }
    }

    // VS Code Open Tabs
    let openTabPaths = window.tabGroups.all
      .flatMap((group) => group.tabs)
      .filter((tab) => tab.input instanceof TabInputText)
      .map((tab) => toWorkspaceRelativePath((tab.input as TabInputText).uri))
      .filter((path) => path !== undefined);

    if (openTabPaths.length > 0) {
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

  // Git Status and the workspace file listing are independent, so build them
  // together. Resolve the git repository once and share it between the two
  // passes so the git extension is not activated twice per environment build.
  const maxGitStatusFiles = settings.maxGitStatusFiles;
  const maxWorkspaceFiles = settings.maxWorkspaceFiles;
  const gitStatusEnabled = maxGitStatusFiles > 0;
  const workspaceFilesEnabled = includeFileDetails && maxWorkspaceFiles > 0;

  const repo =
    gitStatusEnabled || (workspaceFilesEnabled && settings.excludeIgnoredFiles) ? await getGitRepository(Uri.file(cwd)).catch(() => null) : null;

  const [gitLines, listing] = await Promise.all([
    gitStatusEnabled ? getGitStatusLines(cwd, repo).catch(() => []) : Promise.resolve<string[]>([]),
    workspaceFilesEnabled
      ? walkWorkspace(cwd, maxWorkspaceFiles, settings.excludeIgnoredFiles, repo)
      : Promise.resolve({ paths: [], hitLimit: false }),
  ]);

  if (gitStatusEnabled && gitLines.length > 0) {
    details += '\n\n### Git Status\n\n```\n';
    details += gitLines.slice(0, maxGitStatusFiles).join('\n');
    if (gitLines.length > maxGitStatusFiles) {
      details += `\n... and ${gitLines.length - maxGitStatusFiles} more files`;
    }
    details += '\n```';
  }

  if (workspaceFilesEnabled) {
    details += `\n\n### Workspace Files (${cwd.replace(/\\/g, '/')})\n\n`;
    details += renderFileTree(buildFileTree(listing.paths), basename(cwd));
    if (listing.hitLimit) {
      details += '\n\n*(File list truncated. Use `execute_command` to list files in specific subdirectories if you need to explore further.)*';
    }
  }

  const trimmedDetails = details.trim();
  return `## Environment Details\n\n${trimmedDetails}`.trim();
}
