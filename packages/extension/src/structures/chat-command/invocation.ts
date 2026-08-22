import { readFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { parseCommandArgs, substituteArgs } from '@earendil-works/pi-agent-core';
import { stripFrontmatter } from '@earendil-works/pi-coding-agent';

import { logger } from '@pi-code/shared/core/logger';

import type { AgentSession, PromptTemplate, Skill } from '@earendil-works/pi-coding-agent';

const SKILL_COMMAND_PREFIX = '/skill:';
const PROMPT_COMMAND_PREFIX = '/prompt:';
const SKILL_CONTENT_TYPE = 'skill_content';
const PROMPT_CONTENT_TYPE = 'prompt_content';

export function matchSkillInvocation(text: string): string | null {
  if (!text.startsWith(SKILL_COMMAND_PREFIX)) return null;

  const remainder = text.slice(SKILL_COMMAND_PREFIX.length);
  const spaceIndex = remainder.indexOf(' ');
  if (spaceIndex === -1) return remainder;
  return remainder.slice(0, spaceIndex);
}

interface MatchedPrompt extends PromptTemplate {
  readonly args: string;
}

export function matchPromptInvocation(text: string, prompts: readonly PromptTemplate[]): MatchedPrompt | null {
  if (!text.startsWith(PROMPT_COMMAND_PREFIX)) return null;

  const remainder = text.slice(PROMPT_COMMAND_PREFIX.length);
  const spaceIndex = remainder.indexOf(' ');
  const name = spaceIndex === -1 ? remainder : remainder.slice(0, spaceIndex);
  if (name.length === 0) return null;

  const prompt = prompts.find((candidate) => candidate.name === name);
  if (!prompt) return null;
  return { ...prompt, args: spaceIndex === -1 ? '' : remainder.slice(spaceIndex + 1) };
}

export function buildSkillBlock(name: string, filePath: string, body: string): string {
  const baseDir = dirname(filePath);
  return `<skill name="${name}" location="${filePath}">\nReferences are relative to ${baseDir}.\n\n${body}\n</skill>`;
}

export function buildPromptBlock(prompt: PromptTemplate, content: string): string {
  return `<prompt name="${prompt.name}" location="${prompt.filePath}">\n${content.trim()}\n</prompt>`;
}

interface RuntimeResources {
  readonly skills: readonly Skill[];
  readonly prompts: readonly PromptTemplate[];
}

async function injectSkillMessage(session: AgentSession, skills: readonly Skill[], text: string): Promise<void> {
  const matched = matchSkillInvocation(text);
  if (!matched) return;

  const skill = skills.find((candidate) => candidate.name === matched);
  if (!skill) return;

  let body: string;
  try {
    const raw = await readFile(skill.filePath, 'utf-8');
    body = stripFrontmatter(raw).trim();
  } catch (err) {
    logger.warn(`Failed to read skill "${skill.name}" at ${skill.filePath}:`, err);
    return;
  }

  await sendHiddenContent(session, SKILL_CONTENT_TYPE, buildSkillBlock(skill.name, skill.filePath, body));
}

async function injectPromptMessage(session: AgentSession, prompts: readonly PromptTemplate[], text: string): Promise<void> {
  const matched = matchPromptInvocation(text, prompts);
  if (!matched) return;

  const content = substituteArgs(matched.content, parseCommandArgs(matched.args));
  await sendHiddenContent(session, PROMPT_CONTENT_TYPE, buildPromptBlock(matched, content));
}

// No `deliverAs`: a bare sendCustomMessage lands on the session before the
// upcoming user turn, whereas `nextTurn` would be appended after it.
function sendHiddenContent(session: AgentSession, customType: string, content: string): Promise<void> {
  return session.sendCustomMessage({ customType, content, display: false });
}

// Sends the content a leading `/skill:` or `/prompt:` command refers to as
// hidden messages before the upcoming user turn. The caller sends the user message itself untouched.
export async function injectResourceMessages(session: AgentSession, resources: RuntimeResources, text: string): Promise<void> {
  await injectSkillMessage(session, resources.skills, text);
  await injectPromptMessage(session, resources.prompts, text);
}
