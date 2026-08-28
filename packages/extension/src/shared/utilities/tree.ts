import { pathCollator } from '@pi-code/shared/utilities/common';

export interface FileTreeNode {
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
