import { describe, expect, it, vi } from 'vitest';

import { ReplyQueue } from '@pi-code/extension/structures/agent-runtime/core/reply-queue';

function makeQueue() {
  const onChange = vi.fn();
  return { queue: new ReplyQueue(onChange), onChange };
}

describe('ReplyQueue', () => {
  it('adds, edits, removes, and clears while notifying after each change', () => {
    const { queue, onChange } = makeQueue();

    queue.add('Hello World');
    expect(queue.all()).toHaveLength(1);
    expect(queue.all()[0]).toMatchObject({ sender: 'queue', text: 'Hello World' });

    const id = queue.all()[0].id;
    queue.edit(id, 'Edited');
    expect(queue.all()[0].text).toBe('Edited');

    queue.add('Second');
    queue.remove(id);
    expect(queue.all().map((m) => m.text)).toEqual(['Second']);

    queue.clear();
    expect(queue.all()).toEqual([]);
    expect(onChange).toHaveBeenCalledTimes(5);
  });

  it('retain replaces the contents with only the undelivered entries', () => {
    const { queue, onChange } = makeQueue();
    queue.add('a');
    queue.add('b');
    onChange.mockClear();

    queue.retain([queue.all()[1]]);
    expect(queue.all().map((m) => m.text)).toEqual(['b']);
    expect(onChange).toHaveBeenCalledTimes(1);
  });
});
