import { describe, expect, it } from 'vitest';

import { parseCommand } from '@pi-code/shared/utilities/command';

describe('parseCommand', () => {
  it('should correctly parse command chains', () => {
    const subCmds = parseCommand('git status && git pull || echo failed');
    expect(subCmds).toEqual(['git status', 'git pull', 'echo failed']);
  });

  it('should split on a single ampersand, the way the policy engine does', () => {
    expect(parseCommand('echo hi & rm -rf /')).toEqual(['echo hi', 'rm -rf /']);
  });

  it('should preserve glob tokens correctly without substituting "glob"', () => {
    const subCmds = parseCommand('ls *.ts');
    expect(subCmds).toEqual(['ls *.ts']);
  });

  it('should ignore shell comments', () => {
    const subCmds = parseCommand('npm test # run test suite');
    expect(subCmds).toEqual(['npm test']);
  });

  it('should split newline-separated input into independent sub-commands', () => {
    expect(parseCommand('git status\ngit pull')).toEqual(['git status', 'git pull']);
    expect(parseCommand('git status\r\ngit pull')).toEqual(['git status', 'git pull']);
  });

  it('should handle empty or whitespace-only inputs', () => {
    expect(parseCommand('')).toEqual([]);
    expect(parseCommand('   ')).toEqual([]);
  });

  it('should throw when tokenization fails', () => {
    const brokenTokenizer = () => {
      throw new Error('boom');
    };
    expect(() => parseCommand('echo hi', brokenTokenizer)).toThrow('Command could not be parsed into tokens.');
  });
});
