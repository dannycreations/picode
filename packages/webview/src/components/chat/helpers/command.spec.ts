import { describe, expect, it } from 'vitest';

import { applyCommand, matchCommands, readCommandQuery, readCommandToken, splitCommand } from '@pi-code/webview/components/chat/helpers/command';

import type { CommandItem } from '@pi-code/shared/protocol';

const COMMANDS: CommandItem[] = [
  { name: 'skill:pdf-form', source: 'skill', description: 'Fill PDF forms' },
  { name: 'skill:commit-helper', source: 'skill', description: 'Write commits' },
  { name: 'skill:api-docs', source: 'skill', description: 'Generate API docs' },
];

describe('readCommandToken', () => {
  it('should read the leading token up to the first whitespace', () => {
    expect(readCommandToken('/skill:pdf-form fill it')).toEqual({ name: 'skill:pdf-form', end: 15 });
    expect(readCommandToken('/skill:pdf-form')).toEqual({ name: 'skill:pdf-form', end: 15 });
    expect(readCommandToken('/')).toEqual({ name: '', end: 1 });
  });

  it('should reject text that does not start with a slash', () => {
    // The agent only expands prompts that literally start with "/", so a
    // leading space must not be treated as a command.
    expect(readCommandToken(' /skill:pdf-form')).toBeNull();
    expect(readCommandToken('run /skill:pdf-form')).toBeNull();
    expect(readCommandToken('')).toBeNull();
  });
});

describe('readCommandQuery', () => {
  it('should expose the text typed before the caret', () => {
    expect(readCommandQuery('/skill:pdf', 4)?.query).toBe('ski');
    expect(readCommandQuery('/skill:pdf', 10)?.query).toBe('skill:pdf');
    expect(readCommandQuery('/', 1)?.query).toBe('');
  });

  it('should close once the caret leaves the token', () => {
    expect(readCommandQuery('/skill:pdf', 0)).toBeNull();
    expect(readCommandQuery('/skill:pdf args', 12)).toBeNull();
    expect(readCommandQuery('hello', 3)).toBeNull();
  });
});

describe('matchCommands', () => {
  it('should return everything for an empty query', () => {
    expect(matchCommands(COMMANDS, '')).toHaveLength(3);
  });

  it('should rank prefix matches above word-boundary and subsequence matches', () => {
    expect(matchCommands(COMMANDS, 'skill:a')[0].name).toBe('skill:api-docs');
    expect(matchCommands(COMMANDS, 'pdf')[0].name).toBe('skill:pdf-form');
    expect(matchCommands(COMMANDS, 'form')[0].name).toBe('skill:pdf-form');
  });

  it('should match case-insensitively and fall back to a subsequence', () => {
    expect(matchCommands(COMMANDS, 'PDF')[0].name).toBe('skill:pdf-form');
    expect(matchCommands(COMMANDS, 'cmthlp').map((c) => c.name)).toEqual(['skill:commit-helper']);
  });

  it('should return nothing when the query cannot match', () => {
    expect(matchCommands(COMMANDS, 'zzz')).toEqual([]);
  });
});

describe('applyCommand', () => {
  it('should replace a partial token and park the caret before the arguments', () => {
    expect(applyCommand('/pdf', 'skill:pdf-form')).toEqual({ text: '/skill:pdf-form ', caret: 16 });
  });

  it('should preserve existing arguments and their separator', () => {
    expect(applyCommand('/pdf fill it', 'skill:pdf-form')).toEqual({ text: '/skill:pdf-form fill it', caret: 16 });
    expect(applyCommand('/pdf\nfill it', 'skill:pdf-form')).toEqual({ text: '/skill:pdf-form\nfill it', caret: 16 });
  });
});

describe('splitCommand', () => {
  it('should split only when the token resolves to a known command', () => {
    expect(splitCommand('/skill:pdf-form fill it', COMMANDS)).toEqual({ command: '/skill:pdf-form', rest: ' fill it' });
    expect(splitCommand('/skill:pdf-fo', COMMANDS)).toBeNull();
    expect(splitCommand('/skill:unknown', COMMANDS)).toBeNull();
    expect(splitCommand('plain text', COMMANDS)).toBeNull();
  });
});
