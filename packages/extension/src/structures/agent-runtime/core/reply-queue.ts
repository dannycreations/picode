import { uuidv7 } from '@earendil-works/pi-ai';

import type { Attachment, ChatMessage } from '@pi-code/shared/core/types';

// Holds replies typed while a task runs, delivering them into the next turn as
// steering messages instead of starting a new task.
export class ReplyQueue {
  private messages: ChatMessage[] = [];

  public constructor(private readonly onChange: (messages: readonly ChatMessage[]) => void) {}

  public all(): readonly ChatMessage[] {
    return this.messages;
  }

  public add(text: string, attachments?: readonly Attachment[]): void {
    const msg: ChatMessage = {
      id: uuidv7(),
      sender: 'queue',
      text,
      attachments,
      timestamp: Date.now(),
    };
    this.messages.push(msg);
    this.onChange(this.messages);
  }

  public edit(id: string, text: string): void {
    this.messages = this.messages.map((m) => (m.id === id ? { ...m, text } : m));
    this.onChange(this.messages);
  }

  public remove(id: string): void {
    this.messages = this.messages.filter((m) => m.id !== id);
    this.onChange(this.messages);
  }

  public clear(): void {
    this.messages = [];
    this.onChange(this.messages);
  }

  // Keeps only undelivered entries after a steering pass; delivered ones are
  // replaced by their user-rendered twins in the transcript itself.
  public retain(messages: readonly ChatMessage[]): void {
    this.messages = [...messages];
    this.onChange(this.messages);
  }
}
