import { uuidv7 } from '@earendil-works/pi-ai';

import type { Attachment, ChatMessage } from '@pi-code/shared/core/types';

export class ReplyQueue {
  private messages: readonly ChatMessage[] = [];

  public constructor(private readonly onChange: (messages: readonly ChatMessage[]) => void) {}

  public get size(): number {
    return this.messages.length;
  }

  public all(): readonly ChatMessage[] {
    // A snapshot, not the live array: callers hold this across awaits while
    // edits and removals arrive from the webview, and a drain must not act on a
    // row the user has already deleted.
    return [...this.messages];
  }

  public add(text: string, attachments?: readonly Attachment[]): void {
    const msg: ChatMessage = {
      id: uuidv7(),
      sender: 'queue',
      text,
      attachments,
      timestamp: Date.now(),
    };
    this.replace([...this.messages, msg]);
  }

  public edit(id: string, text: string): void {
    this.replace(this.messages.map((m) => (m.id === id ? { ...m, text } : m)));
  }

  public remove(id: string): void {
    this.replace(this.messages.filter((m) => m.id !== id));
  }

  public clear(): void {
    this.replace([]);
  }

  public retain(messages: readonly ChatMessage[]): void {
    this.replace(messages);
  }

  public retainExcept(ids: ReadonlySet<string>): void {
    this.replace(this.messages.filter((m) => !ids.has(m.id)));
  }

  private replace(messages: readonly ChatMessage[]): void {
    this.messages = messages;
    this.onChange(messages);
  }
}
