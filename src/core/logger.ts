import type { OutputChannel } from 'vscode';

export class Logger {
  public constructor(
    private readonly channel: OutputChannel,
    private readonly scope: string,
  ) {}

  public show(preserveFocus?: boolean): void {
    this.channel.show(preserveFocus);
  }

  public info(message: string): void {
    this.channel.appendLine(`[${this.scope}] ${message}`);
  }
}
