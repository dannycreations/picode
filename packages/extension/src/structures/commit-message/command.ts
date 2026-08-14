import { contentText, formatThrownValue } from '@earendil-works/pi-ai';
import { commands, ProgressLocation, window } from 'vscode';

import { COMMIT_MESSAGE_PROMPT } from '@pi-code/extension/core/prompt';
import { getDefaultModelSelection } from '@pi-code/extension/core/settings';
import { createAgentResources } from '@pi-code/extension/structures/agent-runtime/resource';
import { buildGitContext, getGitChanges, getGitDiffContext, getRepoContext } from '@pi-code/extension/structures/commit-message/git';
import { getGitRepository } from '@pi-code/extension/utilities/git';
import { extractCodeFenceMessage } from '@pi-code/extension/utilities/markdown';
import { getWorkspaceUri } from '@pi-code/extension/utilities/vscode';
import { logger } from '@pi-code/shared/core/logger';

import type { Disposable, Uri } from 'vscode';

interface ScmRequest {
  readonly rootUri?: Uri;
}

const generatingRepos = new Set<string>();
const lastUserInstructions = new Map<string, string>();
const lastGeneratedMessages = new Map<string, string>();

function resolveRootUri(scmRequest?: ScmRequest): Uri | undefined {
  if (scmRequest?.rootUri) {
    logger.info(`Root URI provided by SCM context: ${scmRequest.rootUri.fsPath}`);
    return scmRequest.rootUri;
  }

  const uri = getWorkspaceUri();
  if (!uri) {
    logger.info('No active workspace folders found.');
    return undefined;
  }

  logger.info(`Root URI resolved from active workspace folders: ${uri.fsPath}`);
  return uri;
}

function buildPrompt(gitContext: string, userInstruction: string, rejectedMessage: string): string {
  const sections = [COMMIT_MESSAGE_PROMPT.trim()];

  if (userInstruction.trim()) {
    sections.push(`## User-Provided Context\n\n${userInstruction.trim()}`);
  }
  if (rejectedMessage.trim()) {
    sections.push(
      '## Rejected Commit Message',
      `Previously generated commit message (which was not accepted):\n\n${rejectedMessage.trim()}`,
      'Please generate a new, different commit message that follows the same rules.',
    );
  }
  sections.push(gitContext);

  return sections.join('\n\n').trim();
}

async function completePrompt(cwd: string, prompt: string): Promise<string> {
  const runtime = (await createAgentResources(cwd)).services.modelRuntime;
  const { id, provider } = await getDefaultModelSelection(cwd);

  const model = (provider && id && runtime.getModel(provider, id)) || runtime.getAvailableSnapshot()[0];
  if (!model) {
    throw new Error('No model configured or available. Please configure your model settings in pi-agent.');
  }

  logger.info('Sending completion request to backend...');
  const response = await runtime.completeSimple(model, {
    messages: [{ role: 'user' as const, content: prompt, timestamp: Date.now() }],
  });
  logger.info('Completion response received successfully.');

  return (
    contentText(response.content).trim() ||
    response.content
      .filter((block) => block.type === 'thinking')
      .map((block) => block.thinking)
      .join('\n')
  );
}

export function registerCommitMessageCommand(): Disposable {
  return commands.registerCommand('pi-code.generateCommitMessage', async (scmRequest?: ScmRequest) => {
    logger.info('Generate Commit Message command triggered.');
    try {
      const repo = await getGitRepository(resolveRootUri(scmRequest));
      if (!repo) {
        logger.info('Git repository resolution failed: no Git repository found.');
        window.showErrorMessage('No Git repository found.');
        return;
      }
      logger.info(`Git repository resolved successfully: ${repo.rootUri.fsPath}`);

      const cwd = repo.rootUri.fsPath;

      if (generatingRepos.has(cwd)) {
        logger.info(`Already generating commit message for repository: ${cwd}. Ignoring duplicate request.`);
        return;
      }

      generatingRepos.add(cwd);
      try {
        logger.info(`Scanning git changes in directory: ${cwd}`);
        const { changes, useStaged } = await getGitChanges(repo);
        logger.info(`Found ${changes.length} change file(s). Staged changes used: ${useStaged}`);
        if (changes.length === 0) {
          logger.info('No changes to process. Exiting.');
          window.showInformationMessage('No changes found to commit.');
          return;
        }

        // Re-running the command while the input box still holds the previous
        // suggestion means the user rejected it, so feed it back as a negative
        // example along with the instruction that produced it.
        const userMessage = repo.inputBox.value;
        const previousGenerated = lastGeneratedMessages.get(cwd);
        const isRegeneration = Boolean(previousGenerated && userMessage.trim() === previousGenerated.trim());

        let userInstruction = userMessage;
        let rejectedMessage = '';

        if (isRegeneration) {
          logger.info('Input box value matches previously generated message. Treating as a re-generation.');
          userInstruction = lastUserInstructions.get(cwd) || '';
          rejectedMessage = previousGenerated ?? '';
        } else {
          logger.info(`Gathered new user instruction from input box: ${userMessage}`);
          lastUserInstructions.set(cwd, userMessage);
          lastGeneratedMessages.delete(cwd);
        }

        await window.withProgress(
          {
            location: ProgressLocation.SourceControl,
            title: 'Generating commit message with Pi...',
            cancellable: false,
          },
          async () => {
            logger.info('Generating diff and repo context...');
            const [diff, { branch, recentCommits }] = await Promise.all([getGitDiffContext(repo, changes, useStaged), getRepoContext(repo)]);
            logger.info(`Generated diff context (character length: ${diff.length})`);
            logger.info(`Current Branch: ${branch}`);
            logger.info(`Recent Commits count: ${recentCommits.split('\n').filter(Boolean).length}`);

            const gitContext = buildGitContext(changes, diff, branch, recentCommits, useStaged);
            const prompt = buildPrompt(gitContext, userInstruction, rejectedMessage);
            logger.info(`Fully assembled prompt (character length: ${prompt.length})`);

            const rawMessage = await completePrompt(cwd, prompt);
            logger.info(`Raw LLM response: ${rawMessage}`);

            const cleanMessage = extractCodeFenceMessage(rawMessage);
            logger.info(`Extracted commit message: ${cleanMessage}`);
            if (!cleanMessage) {
              throw new Error('Empty response received from model.');
            }

            repo.inputBox.value = cleanMessage;
            lastGeneratedMessages.set(cwd, cleanMessage);
            logger.info('Updated inputBox value successfully.');
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
