import { describe, expect, it } from 'vitest';

import { FileMutex } from '@pi-code/extension/structures/tool-call/helpers/mutex';

describe('FileMutex', () => {
  it('should run operations on the same path sequentially in order', async () => {
    const mutex = new FileMutex();
    const order: number[] = [];

    const p1 = (async () => {
      const release = await mutex.acquire('file.txt');
      order.push(1);
      await new Promise((resolve) => setTimeout(resolve, 50));
      order.push(1.5);
      release();
    })();

    const p2 = (async () => {
      const release = await mutex.acquire('file.txt');
      order.push(2);
      await new Promise((resolve) => setTimeout(resolve, 10));
      order.push(2.5);
      release();
    })();

    const p3 = (async () => {
      const release = await mutex.acquire('file.txt');
      order.push(3);
      release();
    })();

    await Promise.all([p1, p2, p3]);

    expect(order).toEqual([1, 1.5, 2, 2.5, 3]);
  });

  it('should run operations on different paths concurrently', async () => {
    const mutex = new FileMutex();
    const startTimes: Record<string, number> = {};

    const p1 = (async () => {
      const release = await mutex.acquire('file1.txt');
      startTimes['file1'] = Date.now();
      await new Promise((resolve) => setTimeout(resolve, 50));
      release();
    })();

    const p2 = (async () => {
      const release = await mutex.acquire('file2.txt');
      startTimes['file2'] = Date.now();
      release();
    })();

    await Promise.all([p1, p2]);

    // file2 should start immediately without waiting for file1 to complete
    const diff = Math.abs(startTimes['file1'] - startTimes['file2']);
    expect(diff).toBeLessThan(30); // they should start almost at the same time
  });

  it('should allow subsequent operations to run even if a previous operation threw an error', async () => {
    const mutex = new FileMutex();
    const order: string[] = [];

    const p1 = (async () => {
      const release = await mutex.acquire('file.txt');
      order.push('start-1');
      try {
        throw new Error('Some error');
      } finally {
        release();
      }
    })();

    const p2 = (async () => {
      const release = await mutex.acquire('file.txt');
      order.push('start-2');
      release();
    })();

    await Promise.all([p1.catch(() => {}), p2]);

    expect(order).toEqual(['start-1', 'start-2']);
  });
});
