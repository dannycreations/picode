import { formatThrownValue } from '@earendil-works/pi-ai';
import { commands, ProgressLocation, window } from 'vscode';

import { COMMIT_MESSAGE_PROMPT } from '@pi-code/extension/core/prompt';
import { completePrompt } from '@pi-code/extension/structures/agent-runtime/helpers/complete';
import { buildGitContext, getGitChanges, getGitDiffContext, getRepoContext } from '@pi-code/extension/structures/commit-message/git';
import { getGitRepository } from '@pi-code/extension/utilities/git';
import { extractCodeFenceMessage } from '@pi-code/extension/utilities/markdown';
import { getWorkspaceUri } from '@pi-code/extension/utilities/vscode';
import { logger } from '@pi-code/shared/core/logger';

import type { Disposable, Uri } from 'vscode';
import type { Repository } from '@pi-code/extension/types/git';

interface ScmRequest {
  readonly rootUri?: Uri;
}

const generatingRepos = new Set<string>();
const lastUserMessages = new Map<string, string>();
const lastGeneratedMessages = new Map<string, string>();

function resolveRootUri(scmRequest?: ScmRequest): Uri | undefined {
  if (scmRequest?.rootUri) {
    logger.debug(`Root URI provided by SCM context: ${scmRequest.rootUri.fsPath}`);
    return scmRequest.rootUri;
  }

  const uri = getWorkspaceUri();
  if (!uri) {
    logger.debug('No active workspace folders found.');
    return undefined;
  }

  logger.debug(`Root URI resolved from active workspace folders: ${uri.fsPath}`);
  return uri;
}

function buildPrompt(gitContext: string, userContext: string, rejectedMessage: string): string {
  const sections = [COMMIT_MESSAGE_PROMPT.trim()];

  if (userContext.trim()) {
    sections.push(`## User-Provided Context\n\n${userContext.trim()}`);
  }
  if (rejectedMessage.trim()) {
    sections.push(
      '## Rejected Commit Message',
      `Previously generated commit message (which was not accepted):\n\n${rejectedMessage.trim()}`,
      'Please generate a new, different commit message that follows the same requirements.',
    );
  }
  sections.push(gitContext);

  return sections.join('\n\n').trim();
}

function resolveRegeneration(cwd: string, userMessage: string): { userContext: string; rejectedMessage: string } {
  const previousGenerated = lastGeneratedMessages.get(cwd);
  const isRegeneration = Boolean(previousGenerated && userMessage.trim() === previousGenerated.trim());

  if (!isRegeneration) {
    lastUserMessages.set(cwd, userMessage);
    lastGeneratedMessages.delete(cwd);
    return { userContext: userMessage, rejectedMessage: '' };
  }

  // Re-running while the input box still holds the previous suggestion means the
  // user rejected it, so feed it back as a negative example with the instruction.
  logger.debug('Input box value matches previously generated message. Treating as a re-generation.');
  return {
    userContext: lastUserMessages.get(cwd) ?? '',
    rejectedMessage: previousGenerated ?? '',
  };
}

type ResolvedGitChanges = Awaited<ReturnType<typeof getGitChanges>>['changes'];

async function generateAndApply(
  repo: Repository,
  changes: ResolvedGitChanges,
  useStaged: boolean,
  userContext: string,
  rejectedMessage: string,
): Promise<void> {
  logger.debug('Generating diff and repo context...');
  const [diff, { branch, recentCommits }] = await Promise.all([getGitDiffContext(repo, changes, useStaged), getRepoContext(repo)]);
  logger.debug(`Generated diff context (character length: ${diff.length})`);
  logger.debug(`Current Branch: ${branch}`);
  logger.debug(`Recent Commits count: ${recentCommits.split('\n').filter(Boolean).length}`);

  const gitContext = buildGitContext(changes, diff, branch, recentCommits, useStaged);
  const prompt = buildPrompt(gitContext, userContext, rejectedMessage);
  logger.debug(`Fully assembled prompt (character length: ${prompt.length})`);

  const cwd = repo.rootUri.fsPath;
  const rawMessage = await completePrompt(cwd, prompt);
  logger.trace(`Raw LLM response: ${rawMessage}`);

  const cleanMessage = extractCodeFenceMessage(rawMessage);
  logger.debug(`Extracted commit message: ${cleanMessage}`);
  if (!cleanMessage) {
    throw new Error('Empty response received from model.');
  }

  repo.inputBox.value = cleanMessage;
  lastGeneratedMessages.set(cwd, cleanMessage);
  logger.info('Updated inputBox value successfully.');
}

export function registerCommitMessageCommand(): Disposable {
  return commands.registerCommand('pi-code.generateCommitMessage', async (scmRequest?: ScmRequest) => {
    logger.info('Generate Commit Message command triggered.');
    try {
      const repo = await getGitRepository(resolveRootUri(scmRequest));
      if (!repo) {
        logger.debug('Git repository resolution failed: no Git repository found.');
        window.showErrorMessage('No Git repository found.');
        return;
      }
      logger.debug(`Git repository resolved successfully: ${repo.rootUri.fsPath}`);

      const cwd = repo.rootUri.fsPath;

      if (generatingRepos.has(cwd)) {
        logger.debug(`Already generating commit message for repository: ${cwd}. Ignoring duplicate request.`);
        return;
      }

      generatingRepos.add(cwd);
      try {
        logger.debug(`Scanning git changes in directory: ${cwd}`);
        const { changes, useStaged } = await getGitChanges(repo);
        logger.debug(`Found ${changes.length} change file(s). Staged changes used: ${useStaged}`);
        if (changes.length === 0) {
          logger.debug('No changes to process. Exiting.');
          window.showInformationMessage('No changes found to commit.');
          return;
        }

        // Re-running the command while the input box still holds the previous
        // suggestion means the user rejected it, so feed it back as a negative
        // example along with the instruction that produced it.
        const userMessage = repo.inputBox.value;
        const { userContext, rejectedMessage } = resolveRegeneration(cwd, userMessage);

        await window.withProgress(
          {
            location: ProgressLocation.SourceControl,
            title: 'Generating commit message with Pi...',
            cancellable: false,
          },
          async () => {
            await generateAndApply(repo, changes, useStaged, userContext, rejectedMessage);
          },
        );
      } finally {
        generatingRepos.delete(cwd);
      }
    } catch (error) {
      const message = `Failed to generate commit message: ${formatThrownValue(error)}`;
      logger.error(message, error);
      window.showErrorMessage(message);
    }
  });
}
