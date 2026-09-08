import { describe, expect, it } from 'vitest';

import { extractCodeBlock, stripCodeBlock, wrapCodeBlock } from '@pi-code/shared/utilities/markdown';

describe('stripCodeBlock', () => {
  it('returns unfenced content verbatim', () => {
    const content = '\nconst a = 1;\n\n';
    expect(stripCodeBlock(content)).toBe(content);
  });

  it('unwraps a fenced block with an info string', () => {
    expect(stripCodeBlock('```ts\nconst a = 1;\n```')).toBe('const a = 1;');
  });

  it('keeps nested fences inside markdown content', () => {
    const body = '# Title\n\n```ts\nconst a = 1;\n```\n\nDone.';
    expect(stripCodeBlock(`\`\`\`md\n${body}\n\`\`\``)).toBe(body);
  });

  it('handles longer and tilde fences', () => {
    expect(stripCodeBlock('~~~\nvalue\n~~~')).toBe('value');
    expect(stripCodeBlock('````md\n```\nvalue\n```\n````')).toBe('```\nvalue\n```');
  });

  it('keeps content after an unterminated opening fence', () => {
    expect(stripCodeBlock('```ts\nconst a = 1;')).toBe('const a = 1;');
  });

  it('preserves inner blank lines and indentation', () => {
    expect(stripCodeBlock('```\nfoo\n\n  bar\n```')).toBe('foo\n\n  bar');
  });

  it('leaves content that merely ends with a fence untouched', () => {
    const content = 'const a = 1;\n```';
    expect(stripCodeBlock(content)).toBe(content);
  });
});

describe('wrapCodeBlock', () => {
  it('wraps a plain body in a markdown-tagged fence', () => {
    expect(wrapCodeBlock('  Read the diff.\n', 'markdown')).toBe('```markdown\nRead the diff.\n```');
  });

  it('upgrades to a four-backtick fence when the body itself contains ```', () => {
    expect(wrapCodeBlock('# Title\n\n```ts\nconst a = 1;\n```', 'markdown')).toBe('````markdown\n# Title\n\n```ts\nconst a = 1;\n```\n````');
  });
});

describe('extractCodeBlock', () => {
  it('trims plain answers', () => {
    expect(extractCodeBlock('  feat: add thing  ')).toBe('feat: add thing');
  });

  it('unwraps a fenced answer', () => {
    expect(extractCodeBlock('```\nfeat: add thing\n```')).toBe('feat: add thing');
  });

  it('unwraps a fenced answer that follows prose', () => {
    expect(extractCodeBlock('Here is the message:\n\n```text\nfeat: add thing\n```')).toBe('feat: add thing');
  });

  it('preserves backticks inside a fenced code block', () => {
    expect(extractCodeBlock('"feat: add thing"')).toBe('feat: add thing');
    expect(extractCodeBlock('```\n`feat: add thing`\n```')).toBe('`feat: add thing`');
    expect(extractCodeBlock('```\n```function()```\n```')).toBe('```function()```');
  });

  it('keeps a multi-line body', () => {
    expect(extractCodeBlock('```\nfeat: add thing\n\nDetails here.\n```')).toBe('feat: add thing\n\nDetails here.');
  });
});
