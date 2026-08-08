import type { ReactNode } from 'react';

export interface ParsedFileUri {
  readonly filePath: string;
  readonly line?: number;
}

export function parseFileUri(href: string): ParsedFileUri {
  let filePath = href.replace(/^file:\/\//, '');
  const match = filePath.match(/(.*):(\d+)(-\d+)?$/);
  let line: number | undefined;

  if (match) {
    filePath = match[1];
    line = parseInt(match[2], 10);
  }

  if (!filePath.startsWith('/') && !filePath.startsWith('./')) {
    filePath = './' + filePath;
  }

  return { filePath, line };
}

export function extractCodeFromChildren(children: ReactNode): { codeString: string; className: string } {
  if (!children || typeof children !== 'object' || !('props' in children)) {
    return { codeString: '', className: '' };
  }

  const props = (children as { props?: { className?: string; children?: ReactNode } }).props || {};
  const className = props.className || '';
  const codeChildren = props.children;

  let codeString = '';
  if (typeof codeChildren === 'string') {
    codeString = codeChildren;
  } else if (Array.isArray(codeChildren)) {
    codeString = codeChildren.filter((child) => typeof child === 'string').join('');
  }

  return { codeString, className };
}
