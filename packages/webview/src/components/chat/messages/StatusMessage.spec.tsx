import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { ApiRequestMessage } from '@pi-code/webview/components/chat/messages/StatusMessage';

import type { ApiRequestChatMessage } from '@pi-code/shared/core/types';

const failed: ApiRequestChatMessage = {
  id: 'req-1',
  sender: 'api_request',
  text: 'API Request',
  timestamp: 1_700_000_000_000,
  toolStatus: 'denied',
  errorMessage: 'rate limited',
};

const isOpen = (): boolean => {
  const errorText = screen.getByText('rate limited');
  const grid = errorText.parentElement?.parentElement?.parentElement;
  return grid?.style.gridTemplateRows === '1fr';
};

describe('ApiRequestMessage expansion', () => {
  it('starts collapsed', () => {
    render(<ApiRequestMessage message={failed} />);
    expect(isOpen()).toBe(false);
  });

  it('expands and collapses on the header', () => {
    render(<ApiRequestMessage message={failed} />);
    fireEvent.click(screen.getByText('API Request Failed'));
    expect(isOpen()).toBe(true);
    fireEvent.click(screen.getByText('API Request Failed'));
    expect(isOpen()).toBe(false);
  });

  it('keeps the expansion when a retry reuses the row', () => {
    const { rerender } = render(<ApiRequestMessage message={failed} />);
    fireEvent.click(screen.getByText('API Request Failed'));
    expect(isOpen()).toBe(true);

    // A retry turns the row back into a running request, then fails again.
    rerender(<ApiRequestMessage message={{ ...failed, id: 'req-2', toolStatus: 'running', errorMessage: undefined }} />);
    rerender(<ApiRequestMessage message={{ ...failed, id: 'req-2', errorMessage: 'still rate limited' }} />);

    const errorText = screen.getByText('still rate limited');
    const grid = errorText.parentElement?.parentElement?.parentElement;
    expect(grid?.style.gridTemplateRows).toBe('1fr');
  });
});
