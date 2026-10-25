import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ChatHeader } from '@pi-code/webview/components/chat/ChatHeader';

import type { ComponentProps } from 'react';

const baseProps: Omit<ComponentProps<typeof ChatHeader>, 'contextTokens'> = {
  title: 'Task',
  label: 'Task',
  tokensIn: 100,
  tokensOut: 50,
  totalCost: 0.1,
  contextLimit: 1_000_000,
  onClose: vi.fn(),
  closeTooltip: 'Close',
  onSearchOpen: vi.fn(),
};

function renderHeader(contextTokens: number | null): void {
  render(<ChatHeader {...baseProps} contextTokens={contextTokens} />);
}

describe('ChatHeader context gauge', () => {
  it('shows the measured share of the context window', () => {
    renderHeader(650_000);

    expect(screen.getByText('Context: 65%')).toBeTruthy();
  });

  it('reads as unknown while the context has no measured size', () => {
    // A compacted context has no size until the next request measures it, so
    // the gauge must not claim the context is empty.
    renderHeader(null);

    expect(screen.getByText('Context: ?')).toBeTruthy();
    expect(screen.queryByText('Context: 0%')).toBeNull();
  });
});
