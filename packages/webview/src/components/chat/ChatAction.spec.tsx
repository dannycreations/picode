import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ChatAction } from '@pi-code/webview/components/chat/ChatAction';

import type { ComponentProps } from 'react';

const settledTaskProps: ComponentProps<typeof ChatAction> = {
  hasTask: true,
  isArchived: false,
  isComposerHidden: false,
  scrollTarget: null,
  isRunning: false,
  isCompacting: false,
  isAwaitingApproval: false,
  onScrollTo: vi.fn(),
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

describe('ChatAction scroll button', () => {
  it('stays hidden at the bottom of the chat', () => {
    render(<ChatAction {...settledTaskProps} />);

    expect(screen.queryByRole('button')).toBeNull();
  });

  it('scrolls to top when the last gesture was upward', () => {
    const onScrollTo = vi.fn();
    render(<ChatAction {...settledTaskProps} scrollTarget="top" onScrollTo={onScrollTo} />);

    const button = screen.getByRole('button', { name: 'Scroll to top of chat' });
    expect(button.querySelector('.codicon-chevron-up')).not.toBeNull();
    fireEvent.click(button);
    expect(onScrollTo).toHaveBeenCalledWith('top');
  });

  it('scrolls to bottom when the container is away from the bottom', () => {
    const onScrollTo = vi.fn();
    render(<ChatAction {...settledTaskProps} scrollTarget="bottom" onScrollTo={onScrollTo} />);

    const button = screen.getByRole('button', { name: 'Scroll to bottom of chat' });
    expect(button.querySelector('.codicon-chevron-down')).not.toBeNull();
    fireEvent.click(button);
    expect(onScrollTo).toHaveBeenCalledWith('bottom');
  });

  it('stays available in archived tasks while mutating actions remain hidden', () => {
    const onScrollTo = vi.fn();
    render(
      <ChatAction
        {...settledTaskProps}
        isArchived
        isRunning
        scrollTarget="top"
        onScrollTo={onScrollTo}
        onCloseTask={vi.fn()}
        onContinueTask={vi.fn()}
      />,
    );

    expect(screen.getByRole('button', { name: 'Scroll to top of chat' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Close' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Continue' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Cancel Task' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Scroll to top of chat' }));
    expect(onScrollTo).toHaveBeenCalledWith('top');
  });

  it('hides the whole bar in archived tasks with nothing to scroll to', () => {
    render(<ChatAction {...settledTaskProps} isArchived isRunning onCloseTask={vi.fn()} onContinueTask={vi.fn()} />);

    expect(screen.queryByRole('button')).toBeNull();
  });

  it('adds bottom spacing when the composer is hidden, as in archived and read-only sub-agent views', () => {
    const { container } = render(<ChatAction {...settledTaskProps} isArchived isComposerHidden scrollTarget="top" />);

    expect((container.firstChild as HTMLElement).className).toContain('pb-2');
  });

  it('lets the composer provide the bottom spacing when it is visible', () => {
    const { container } = render(<ChatAction {...settledTaskProps} scrollTarget="top" />);

    expect((container.firstChild as HTMLElement).className).not.toContain('pb-2');
  });
});
