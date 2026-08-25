import { readFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { parseCommandArgs, substituteArgs } from '@earendil-works/pi-agent-core';
import { stripFrontmatter } from '@earendil-works/pi-coding-agent';

import { fencedMarkdown } from '@pi-code/extension/utilities/markdown';
import { logger } from '@pi-code/shared/core/logger';

import type { AgentSession, PromptTemplate, Skill } from '@earendil-works/pi-coding-agent';

export const SKILL_COMMAND_PREFIX = '/skill:';
export const PROMPT_COMMAND_PREFIX = '/prompt:';
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

export function buildSkillBlock(name: string, filePath: string, content: string): string {
  const baseDir = dirname(filePath);
  return [`## Skill: ${name}`, '', `Location: \`${filePath}\``, `References are relative to ${baseDir}.`, '', fencedMarkdown(content)].join('\n');
}

export function buildPromptBlock(prompt: PromptTemplate, content: string): string {
  return [`## Prompt: ${prompt.name}`, '', `Location: \`${prompt.filePath}\``, '', fencedMarkdown(content)].join('\n');
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

interface HiddenContentOptions {
  readonly deliverAs?: 'nextTurn' | 'steer';
  readonly triggerTurn?: boolean;
}

// Sends transcript-only content as a hidden custom message. With no options
// the message lands on the session before the upcoming user turn, whereas
// `deliverAs: 'nextTurn'` appends it after that turn instead.
export function sendHiddenContent(session: AgentSession, customType: string, content: string, options: HiddenContentOptions = {}): Promise<void> {
  return session.sendCustomMessage({ customType, content, display: false }, options);
}

// Sends the content a leading `/skill:` or `/prompt:` command refers to as
// hidden messages before the upcoming user turn. The caller sends the user message itself untouched.
export async function injectResourceMessages(session: AgentSession, resources: RuntimeResources, text: string): Promise<void> {
  await injectSkillMessage(session, resources.skills, text);
  await injectPromptMessage(session, resources.prompts, text);
}
