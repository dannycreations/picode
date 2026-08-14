import { uuidv7 } from '@earendil-works/pi-ai';

import { createRequestRegistry } from '@pi-code/extension/structures/agent-runtime/brokers/registry';

import type { ExtensionToWebviewMessage } from '@pi-code/shared/core/protocol';
import type { ToolName } from '@pi-code/shared/core/types';

interface ApprovalRequest {
  readonly id: string;
  readonly toolName: ToolName;
  readonly args: unknown;
  readonly subagent?: string;
}

type ApprovalPresenter = (request: ApprovalRequest) => void;

const approvals = createRequestRegistry<boolean>();

let presenter: ApprovalPresenter | null = null;

type SubagentEventCallback = (event: ExtensionToWebviewMessage) => void;
let subagentEventCallback: SubagentEventCallback | null = null;

export function setSubagentEventCallback(callback: SubagentEventCallback): () => void {
  subagentEventCallback = callback;
  return () => {
    if (subagentEventCallback === callback) {
      subagentEventCallback = null;
    }
  };
}

export function notifySubagentEvent(event: ExtensionToWebviewMessage): void {
  subagentEventCallback?.(event);
}

export function setApprovalPresenter(next: ApprovalPresenter): () => void {
  presenter = next;
  return () => {
    if (presenter === next) {
      presenter = null;
    }
  };
}

export function requestApproval(toolName: ToolName, toolCallId: string | undefined, args: unknown, subagent?: string): Promise<boolean> {
  const currentPresenter = presenter;
  if (!currentPresenter) {
    return Promise.resolve(false);
  }

  const id = toolCallId || uuidv7();
  return new Promise<boolean>((resolve) => {
    approvals.register(id, resolve);
    currentPresenter({ id, toolName, args, subagent });
  });
}

export function approveApproval(id: string): void {
  approvals.resolve(id, true);
}

export function denyApproval(id: string): void {
  approvals.resolve(id, false);
}

export function cancelAllApprovals(): void {
  approvals.cancelAll(false);
}
