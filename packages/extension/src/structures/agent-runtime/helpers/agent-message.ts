import { parseAttachments } from '@pi-code/extension/utilities/codec';
import { wrapCodeBlock } from '@pi-code/shared/utilities/markdown';

import type { Message } from '@earendil-works/pi-ai';
import type { AgentSession, CustomMessage } from '@earendil-works/pi-coding-agent';
import type { ExpandedMentions } from '@pi-code/extension/structures/chat-command/mention';
import type { Attachment } from '@pi-code/shared/core/types';

function appendAgentMessage(session: AgentSession, message: Message | CustomMessage): string {
  session.agent.state.messages.push(message);

  if (message.role === 'custom') {
    return session.sessionManager.appendCustomMessageEntry(message.customType, message.content, message.display, message.details);
  }

  return session.sessionManager.appendMessage(message);
}

export function appendHiddenMessage(session: AgentSession, customType: string, content: string): void {
  appendAgentMessage(session, {
    role: 'custom',
    customType,
    content,
    display: false,
    details: undefined,
    timestamp: Date.now(),
  });
}

export function appendUserTurn(
  session: AgentSession,
  expanded: ExpandedMentions,
  attachments: readonly Attachment[] | undefined,
  timestamp: number,
): void {
  appendAgentMessage(session, {
    role: 'user',
    content: [{ type: 'text', text: expanded.text }, ...parseAttachments(attachments)],
    timestamp,
  });

  for (const attachment of attachments ?? []) {
    if (attachment.kind === 'text') {
      appendHiddenMessage(session, 'text_attachment', wrapCodeBlock(attachment.content, attachment.language));
    }
  }

  if (expanded.mentionContent) {
    appendHiddenMessage(session, 'mention_content', expanded.mentionContent);
  }
}
