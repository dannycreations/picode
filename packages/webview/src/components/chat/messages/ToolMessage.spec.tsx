import { act, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { defaultSettings } from '@pi-code/shared/core/settings';
import { ToolMessage } from '@pi-code/webview/components/chat/messages/ToolMessage';
import { useChatStore } from '@pi-code/webview/stores/useChatStore';

import type { AppSettings } from '@pi-code/shared/core/settings';
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

const writeMessage: ToolChatMessage = {
  id: 'call-2',
  sender: 'tool',
  text: 'write_file',
  toolName: 'write_file',
  toolArgs: { path: 'app.ts' },
  toolStatus: 'denied',
  timestamp: 1_700_000_000_000,
};

// The settings snapshot the store holds is complete, so a test starts from the
// schema defaults and overrides only the lists it cares about.
function settingsWith(allowed: string[], denied: string[]): AppSettings {
  return { ...defaultSettings(), allowedWritePaths: allowed, deniedWritePaths: denied };
}

describe('ToolMessage auto-approval patterns', () => {
  it('drops only the denied pattern from the allowed list', () => {
    // Denying one pattern must not rewrite the whole allow list, or the
    // remaining approvals are lost and denied patterns gain an approval.
    const send = vi.fn();
    useChatStore.setState({ send, settings: settingsWith(['app.ts', 'other.ts'], ['rm -rf']) });

    render(<ToolMessage message={writeMessage} onRespondTool={vi.fn()} />);
    act(() => {
      screen.getByLabelText('Add to denied').click();
    });

    expect(send).toHaveBeenCalledWith({
      type: 'update_settings',
      settings: { allowedWritePaths: ['other.ts'], deniedWritePaths: ['rm -rf', 'app.ts'] },
    });
  });

  it('drops the denied pattern from the denied list when it is allowed', () => {
    const send = vi.fn();
    useChatStore.setState({ send, settings: settingsWith([], ['app.ts']) });

    render(<ToolMessage message={writeMessage} onRespondTool={vi.fn()} />);
    act(() => {
      screen.getByLabelText('Add to allowed').click();
    });

    expect(send).toHaveBeenCalledWith({
      type: 'update_settings',
      settings: { allowedWritePaths: ['app.ts'], deniedWritePaths: [] },
    });
  });
});
