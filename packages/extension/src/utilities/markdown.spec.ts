import { describe, expect, it } from 'vitest';

import { extractCodeFenceMessage, stripCodeFence } from '@pi-code/extension/utilities/markdown';

describe('stripCodeFence', () => {
  it('returns unfenced content verbatim', () => {
    const content = '\nconst a = 1;\n\n';
    expect(stripCodeFence(content)).toBe(content);
  });

  it('unwraps a fenced block with an info string', () => {
    expect(stripCodeFence('```ts\nconst a = 1;\n```')).toBe('const a = 1;');
  });

  it('keeps nested fences inside markdown content', () => {
    const body = '# Title\n\n```ts\nconst a = 1;\n```\n\nDone.';
    expect(stripCodeFence(`\`\`\`md\n${body}\n\`\`\``)).toBe(body);
  });

  it('handles longer and tilde fences', () => {
    expect(stripCodeFence('~~~\nvalue\n~~~')).toBe('value');
    expect(stripCodeFence('````md\n```\nvalue\n```\n````')).toBe('```\nvalue\n```');
  });

  it('keeps content after an unterminated opening fence', () => {
    expect(stripCodeFence('```ts\nconst a = 1;')).toBe('const a = 1;');
  });

  it('preserves inner blank lines and indentation', () => {
    expect(stripCodeFence('```\nfoo\n\n  bar\n```')).toBe('foo\n\n  bar');
  });

  it('leaves content that merely ends with a fence untouched', () => {
    const content = 'const a = 1;\n```';
    expect(stripCodeFence(content)).toBe(content);
  });
});

describe('extractCodeBlockMessage', () => {
  it('trims plain answers', () => {
    expect(extractCodeFenceMessage('  feat: add thing  ')).toBe('feat: add thing');
  });

  it('unwraps a fenced answer', () => {
    expect(extractCodeFenceMessage('```\nfeat: add thing\n```')).toBe('feat: add thing');
  });

  it('unwraps a fenced answer that follows prose', () => {
    expect(extractCodeFenceMessage('Here is the message:\n\n```text\nfeat: add thing\n```')).toBe('feat: add thing');
  });

  it('drops wrapping quotes', () => {
    expect(extractCodeFenceMessage('"feat: add thing"')).toBe('feat: add thing');
    expect(extractCodeFenceMessage('```\n`feat: add thing`\n```')).toBe('feat: add thing');
  });

  it('keeps a multi-line body', () => {
    expect(extractCodeFenceMessage('```\nfeat: add thing\n\nDetails here.\n```')).toBe('feat: add thing\n\nDetails here.');
  });
});
