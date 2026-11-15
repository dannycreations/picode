import { describe, expect, it } from 'vitest';

import { applyMention, applyTag, readTagQuery, toCommitTagItem } from '@pi-code/webview/components/chat/helpers/mention';

describe('readTagQuery', () => {
  it('reads the query after a # token at the caret', () => {
    expect(readTagQuery('compare with #4e7c', 18)).toBe('4e7c');
    expect(readTagQuery('#wor', 4)).toBe('wor');
  });

  it('reads a partially typed token', () => {
    expect(readTagQuery('fix #work', 7)).toBe('wo');
  });

  it('returns null when the caret leaves the token or no # is present', () => {
    expect(readTagQuery('fix #work', 2)).toBeNull();
    expect(readTagQuery('fix @work', 9)).toBeNull();
    expect(readTagQuery('heading # like this', 10)).toBeNull();
  });
});

describe('applyTag', () => {
  it('replaces the active token with the chosen value', () => {
    expect(applyTag('compare #4e rest', 11, '4e7c64ae11111111111111111111111111111111')).toEqual({
      text: 'compare #4e7c64ae11111111111111111111111111111111  rest',
      caret: '#4e7c64ae11111111111111111111111111111111'.length + 'compare '.length + 1,
    });
  });

  it('leaves text without an active token untouched', () => {
    expect(applyTag('plain text', 5, 'working')).toEqual({ text: 'plain text', caret: 5 });
  });
});

describe('applyMention', () => {
  it('finishes a file mention with a space', () => {
    expect(applyMention('check @ind', 10, 'src/index.ts')).toEqual({
      text: 'check @src/index.ts ',
      caret: 'check @src/index.ts '.length,
    });
  });

  it('keeps a folder token open for the next path segment', () => {
    expect(applyMention('check @sr', 9, 'src/')).toEqual({
      text: 'check @src/',
      caret: 'check @src/'.length,
    });
  });
});

describe('toCommitTagItem', () => {
  it('formats the commit detail line and inserts the short hash', () => {
    const commit = {
      hash: '4e7c64ae11111111111111111111111111111111',
      shortHash: '4e7c64ae',
      subject: 'refactor: delegate',
      author: 'dannycreations',
      date: '2026-08-25',
    };
    expect(toCommitTagItem(commit)).toEqual({
      value: '4e7c64ae',
      label: 'refactor: delegate',
      description: '4e7c64ae by dannycreations on 2026-08-25',
    });
  });

  it('omits missing author and date fields', () => {
    const commit = { hash: '2a1b881f22222222222222222222222222222222', shortHash: '2a1b881f', subject: 'chore: bump' };
    expect(toCommitTagItem(commit).description).toBe('2a1b881f');
  });
});
