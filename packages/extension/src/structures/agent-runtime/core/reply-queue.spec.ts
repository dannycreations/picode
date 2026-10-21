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

  it('hands out a snapshot that later edits and removals do not change', () => {
    const { queue } = makeQueue();
    queue.add('first');
    queue.add('second');

    const snapshot = queue.all();
    queue.remove(snapshot[0].id);

    expect(snapshot.map((m) => m.text)).toEqual(['first', 'second']);
    expect(queue.all().map((m) => m.text)).toEqual(['second']);
  });

  it('reports its size without handing out a snapshot', () => {
    const { queue } = makeQueue();
    expect(queue.size).toBe(0);
    queue.add('a');
    queue.add('b');
    expect(queue.size).toBe(2);
    queue.remove(queue.all()[0].id);
    expect(queue.size).toBe(1);
  });

  it('hands the notified list over without letting later changes touch it', () => {
    const { queue, onChange } = makeQueue();
    queue.add('a');
    const notified = onChange.mock.calls[0][0] as readonly { id: string; text: string }[];

    queue.add('b');
    queue.remove(notified[0].id);

    expect(notified.map((m) => m.text)).toEqual(['a']);
  });
});
