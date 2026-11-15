import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ChatAction } from '@pi-code/webview/components/chat/ChatAction';

import type { ComponentProps } from 'react';

const settledTaskProps: ComponentProps<typeof ChatAction> = {
  hasTask: true,
  isArchived: false,
  showScrollToBottom: false,
  isRunning: false,
  isCompacting: false,
  isAwaitingApproval: false,
  onScrollToBottom: vi.fn(),
  onCancelTask: vi.fn(),
  closeLabel: 'Close',
};

describe('ChatAction close action', () => {
  it('leaves a settled session with no footer action when no close handler is offered', () => {
    render(<ChatAction {...settledTaskProps} />);

    expect(screen.queryByRole('button')).toBeNull();
  });

  it('still closes a live session from the action bar', () => {
    render(<ChatAction {...settledTaskProps} onCloseTask={vi.fn()} />);

    expect(screen.getByRole('button', { name: 'Close' })).toBeTruthy();
  });
});
