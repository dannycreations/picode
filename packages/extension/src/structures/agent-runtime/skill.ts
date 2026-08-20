import { readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { stripFrontmatter } from '@earendil-works/pi-coding-agent';

import { logger } from '@pi-code/shared/core/logger';

import type { AgentSession, Skill } from '@earendil-works/pi-coding-agent';

const SKILL_COMMAND_PREFIX = '/skill:';

export interface ParsedSkillInvocation {
  readonly name: string;
  readonly args: string;
}

export function parseSkillInvocation(text: string): ParsedSkillInvocation | null {
  if (!text.startsWith(SKILL_COMMAND_PREFIX)) return null;

  const remainder = text.slice(SKILL_COMMAND_PREFIX.length);
  const spaceIndex = remainder.indexOf(' ');
  if (spaceIndex === -1) {
    return { name: remainder, args: '' };
  }
  return {
    name: remainder.slice(0, spaceIndex),
    args: remainder.slice(spaceIndex + 1).trim(),
  };
}

export function buildSkillBlock(name: string, filePath: string, body: string): string {
  const baseDir = dirname(filePath);
  return `<skill name="${name}" location="${filePath}">\nReferences are relative to ${baseDir}.\n\n${body}\n</skill>`;
}

function readSkillBody(skill: Skill): string {
  const raw = readFileSync(skill.filePath, 'utf-8');
  return stripFrontmatter(raw).trim();
}

export async function injectSkillMessages(session: AgentSession, skills: readonly Skill[], text: string): Promise<string> {
  const parsed = parseSkillInvocation(text);
  if (!parsed) return text;

  const skill = skills.find((candidate) => candidate.name === parsed.name);
  if (!skill) return text;

  let body: string;
  try {
    body = readSkillBody(skill);
  } catch (err) {
    logger.warn(`Failed to read skill "${skill.name}" at ${skill.filePath}:`, err);
    return text;
  }

  // No `deliverAs`: a bare sendCustomMessage lands on the session before the
  // upcoming user turn, whereas `nextTurn` would be appended after it.
  await session.sendCustomMessage({
    customType: 'skill',
    content: buildSkillBlock(skill.name, skill.filePath, body),
    display: false,
  });

  return parsed.args;
}
