import type { CustomMessage } from '@earendil-works/pi-agent-core';
import type { Message } from '@earendil-works/pi-ai';
import type { AgentSession } from '@earendil-works/pi-coding-agent';

export function appendAgentMessage(session: AgentSession, message: Message | CustomMessage): string {
  session.agent.state.messages.push(message);

  if (message.role === 'custom') {
    return session.sessionManager.appendCustomMessageEntry(message.customType, message.content, message.display, message.details);
  }

  return session.sessionManager.appendMessage(message);
}
