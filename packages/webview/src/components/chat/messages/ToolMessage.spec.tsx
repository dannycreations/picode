import { act, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ToolMessage } from '@pi-code/webview/components/chat/messages/ToolMessage';
import { useChatStore } from '@pi-code/webview/stores/useChatStore';

import type { ToolChatMessage } from '@pi-code/shared/core/types';

const subagentMessage: ToolChatMessage = {
  id: 'call-1',
  sender: 'tool',
  text: 'spawn_subagent',
  toolName: 'spawn_subagent',
  toolArgs: { agent: 'explore', description: 'find the leak', task: 'find the leak' },
  toolStatus: 'running',
  timestamp: 1_700_000_000_000,
};

const renderMessage = (): void => {
  render(<ToolMessage message={subagentMessage} onRespondTool={vi.fn()} />);
};

describe('ToolMessage sub-agent session button', () => {
  it('offers the button only while the extension still holds the session', () => {
    // A transcript read back from disk names a sub-agent whose in-memory
    // session is gone, and there is nothing to open for it.
    useChatStore.setState({ openableSubagents: [] });
    renderMessage();

    expect(screen.queryByLabelText('Open sub-agent session')).toBeNull();
  });

  it('offers the button once the extension reports the session', () => {
    useChatStore.setState({ openableSubagents: [] });
    renderMessage();

    act(() => {
      useChatStore.setState({ openableSubagents: ['call-1'] });
    });

    expect(screen.getByLabelText('Open sub-agent session')).toBeTruthy();
  });

  it('takes the button away again when the session is released', () => {
    useChatStore.setState({ openableSubagents: ['call-1'] });
    renderMessage();

    expect(screen.getByLabelText('Open sub-agent session')).toBeTruthy();

    act(() => {
      useChatStore.setState({ openableSubagents: [] });
    });

    expect(screen.queryByLabelText('Open sub-agent session')).toBeNull();
  });
});
