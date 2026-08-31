import { pathCollator } from '@pi-code/shared/utilities/common';

export interface FileTreeNode {
  readonly name: string;
  isDir: boolean;
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

interface StackItem {
  readonly node: FileTreeNode;
  readonly prefix: string;
  readonly isLast: boolean;
}

export function renderFileTree(root: FileTreeNode, rootLabel: string): string {
  const lines: string[] = [rootLabel];

  const stack: StackItem[] = [];
  const rootChildren = sortTreeNodes([...root.children.values()]);
  for (let i = rootChildren.length - 1; i >= 0; i--) {
    stack.push({
      node: rootChildren[i],
      prefix: '',
      isLast: i === rootChildren.length - 1,
    });
  }

  while (stack.length > 0) {
    const { node, prefix, isLast } = stack.pop()!;
    const connector = isLast ? '└─ ' : '├─ ';
    const label = `${node.name}${node.isDir ? '/' : ''}`;
    lines.push(`${prefix}${connector}${label}`);

    if (node.isDir) {
      const childPrefix = prefix + (isLast ? '   ' : '│  ');
      const children = sortTreeNodes([...node.children.values()]);
      for (let i = children.length - 1; i >= 0; i--) {
        stack.push({
          node: children[i],
          prefix: childPrefix,
          isLast: i === children.length - 1,
        });
      }
    }
  }

  return lines.join('\n');
}
