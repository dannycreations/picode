import { commands, Disposable, ProgressLocation, window } from 'vscode';

import { COMMIT_MESSAGE_PROMPT } from '@pi-code/extension/core/prompt';
import { readCommitMessageModelSelection } from '@pi-code/extension/core/settings';
import { completeAndExtract } from '@pi-code/extension/structures/agent-runtime/helpers/complete';
import { buildGitContext, getGitChanges, getGitDiffContext, getRepoContext } from '@pi-code/extension/structures/commit-message/git';
import { getGitRepository } from '@pi-code/extension/utilities/git';
import { fencedMarkdown } from '@pi-code/extension/utilities/markdown';
import { getWorkspaceUri, reportError } from '@pi-code/extension/utilities/vscode';
import { COMMAND_IDS } from '@pi-code/shared/core/constants';
import { logger } from '@pi-code/shared/core/logger';

import type { Uri } from 'vscode';
import type { Repository } from '@pi-code/extension/types/git';

interface ScmRequest {
  readonly rootUri?: Uri;
}

const activeGenerations = new Map<string, AbortController>();
const lastUserMessages = new Map<string, string>();
const lastGeneratedMessages = new Map<string, string>();

function setGeneratingContext(generating: boolean): void {
  void commands.executeCommand('setContext', COMMAND_IDS.commitMessageGenerating, generating);
}

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
    sections.push(`## User-Provided Context\n\n${fencedMarkdown(userContext.trim())}`);
  }
  if (rejectedMessage.trim()) {
    sections.push(
      '## Rejected Commit Message',
      `Previously generated commit message (which was not accepted):\n\n${fencedMarkdown(rejectedMessage.trim())}`,
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
  signal: AbortSignal,
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
  const cleanMessage = await completeAndExtract(cwd, prompt, signal, readCommitMessageModelSelection());
  logger.debug(`Extracted commit message: ${cleanMessage}`);
  if (signal.aborted) {
    throw new Error('Commit message generation cancelled.');
  }
  if (!cleanMessage) {
    throw new Error('Empty response received from model.');
  }

  repo.inputBox.value = cleanMessage;
  lastGeneratedMessages.set(cwd, cleanMessage);
  logger.info('Updated inputBox value successfully.');
}

export function registerCommitMessageCommands(): Disposable {
  const generateCommand = commands.registerCommand(COMMAND_IDS.generateCommitMessage, async (scmRequest?: ScmRequest) => {
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

      if (activeGenerations.has(cwd)) {
        logger.debug(`Already generating commit message for repository: ${cwd}. Ignoring duplicate request.`);
        return;
      }

      const controller = new AbortController();
      activeGenerations.set(cwd, controller);
      setGeneratingContext(true);
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
            cancellable: true,
          },
          (_progress, token) => {
            token.onCancellationRequested(() => controller.abort());
            return generateAndApply(repo, changes, useStaged, userContext, rejectedMessage, controller.signal);
          },
        );
      } catch (error) {
        if (!controller.signal.aborted) {
          throw error;
        }
        logger.info('Commit message generation cancelled.');
        window.showInformationMessage('Commit message generation cancelled.');
      } finally {
        activeGenerations.delete(cwd);
        setGeneratingContext(activeGenerations.size > 0);
      }
    } catch (error) {
      reportError('Failed to generate commit message', error);
    }
  });

  const cancelCommand = commands.registerCommand(COMMAND_IDS.cancelGenerateCommitMessage, (scmRequest?: ScmRequest) => {
    logger.info('Cancel Commit Message Generation command triggered.');
    const cwd = resolveRootUri(scmRequest)?.fsPath;
    const controller = cwd ? activeGenerations.get(cwd) : undefined;
    // The menu may resolve a repo other than the one generating, so fall back
    // to every active generation instead of leaving the stop button inert.
    const targets = controller ? [controller] : [...activeGenerations.values()];
    if (targets.length === 0) {
      logger.debug('No active commit message generation to cancel.');
      return;
    }
    for (const target of targets) {
      target.abort();
    }
  });

  return Disposable.from(generateCommand, cancelCommand);
}
