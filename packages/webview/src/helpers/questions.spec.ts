import { describe, expect, it } from 'vitest';

import { findPendingQuestion, parseQuestionData } from '@pi-code/webview/helpers/questions';

import type { ChatMessage, ToolArguments } from '@pi-code/shared/core/types';

function createMessage(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: 'tc-1',
    sender: 'tool',
    text: 'ask_question',
    timestamp: 1,
    toolName: 'ask_question',
    ...overrides,
  } as ChatMessage;
}

describe('parseQuestionData', () => {
  it('should extract the question and suggestion texts', () => {
    const args: ToolArguments = {
      question: 'Which package manager should I use?',
      follow_up: [{ text: 'Use pnpm' }, { text: 'Use npm' }],
    };

    expect(parseQuestionData(args)).toEqual({
      question: 'Which package manager should I use?',
      suggestions: ['Use pnpm', 'Use npm'],
    });
  });

  it('should drop blank and empty suggestions', () => {
    const args: ToolArguments = { question: 'Continue?', follow_up: [{ text: 'Yes' }, { text: '  ' }, { text: '' }] };

    expect(parseQuestionData(args)).toEqual({ question: 'Continue?', suggestions: ['Yes'] });
  });

  it('should return undefined for missing or unrelated arguments', () => {
    expect(parseQuestionData(undefined)).toBeUndefined();
    expect(parseQuestionData({ path: 'unrelated.ts' })).toBeUndefined();
  });
});

describe('findPendingQuestion', () => {
  it('should return the latest unanswered question', () => {
    const messages = [createMessage({ id: 'tc-1', toolStatus: 'completed' }), createMessage({ id: 'tc-2', toolStatus: 'running' })];

    expect(findPendingQuestion(messages)?.id).toBe('tc-2');
  });

  it('should ignore other running tools and answered questions', () => {
    const messages = [
      createMessage({ id: 'tc-1', toolStatus: 'completed' }),
      createMessage({ id: 'tc-2', toolName: 'execute_command', toolStatus: 'running' }),
    ];

    expect(findPendingQuestion(messages)).toBeUndefined();
    expect(findPendingQuestion([])).toBeUndefined();
  });
});
