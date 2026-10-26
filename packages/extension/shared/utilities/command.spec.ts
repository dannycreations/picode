import { describe, expect, it } from 'vitest';

import { parseCommand } from '@pi-code/shared/utilities/command';

describe('parseCommand', () => {
  it('should correctly parse command chains', () => {
    const subCmds = parseCommand('git status && git pull || echo failed');
    expect(subCmds.map((segment) => segment.text)).toEqual(['git status', 'git pull', 'echo failed']);
  });

  it('should split on a single ampersand, the way the policy engine does', () => {
    const subCmds = parseCommand('echo hi & rm -rf /');
    expect(subCmds.map((segment) => segment.text)).toEqual(['echo hi', 'rm -rf /']);
  });

  it('should preserve glob tokens correctly without substituting "glob"', () => {
    const subCmds = parseCommand('ls *.ts');
    expect(subCmds.map((segment) => segment.text)).toEqual(['ls *.ts']);
  });

  it('should ignore shell comments', () => {
    const subCmds = parseCommand('npm test # run test suite');
    expect(subCmds.map((segment) => segment.text)).toEqual(['npm test']);
  });

  it('should split newline-separated input into independent sub-commands', () => {
    const subCmds = parseCommand('git status\ngit pull');
    expect(subCmds.map((segment) => segment.text)).toEqual(['git status', 'git pull']);
    expect(parseCommand('git status\r\ngit pull').map((segment) => segment.text)).toEqual(['git status', 'git pull']);
  });

  it('should handle empty or whitespace-only inputs', () => {
    expect(parseCommand('')).toEqual([]);
    expect(parseCommand('   ')).toEqual([]);
  });

  it('should expose the words of every sub-command with quoting removed', () => {
    const segments = parseCommand('cd "c:/a/b" && cat .env 2>/dev/null');
    expect(segments.map((segment) => segment.tokens)).toEqual([
      ['cd', 'c:/a/b'],
      ['cat', '.env', '2', '>', '/dev/null'],
    ]);
  });

  it('should throw when tokenization fails', () => {
    // An empty parameter expansion is not valid shell, so the tokenizer
    // refuses it and the caller has to fall back to asking the user.
    expect(() => parseCommand('echo ${}')).toThrow('Command could not be parsed into tokens.');
  });
});
