import { commands, ProgressLocation, window, workspace } from 'vscode';

import { COMMIT_MESSAGE_PROMPT } from '@pi-code/extension/core/prompt';
import { SettingsService } from '@pi-code/extension/core/settings';
import { lazyModelRuntime } from '@pi-code/extension/structures/agent-runtime/resource';
import { buildGitContext, getGitChanges, getGitDiffContext, getRepoContext } from '@pi-code/extension/structures/commit-message/git';
import { getGitRepository } from '@pi-code/extension/utilities/git';
import { extractCodeFenceMessage } from '@pi-code/extension/utilities/markdown';
import { logger } from '@pi-code/shared/core/logger';

import type { Disposable, Uri } from 'vscode';

interface ScmRequest {
  readonly rootUri?: Uri;
}

const lastUserInstructions = new Map<string, string>();
const lastGeneratedMessages = new Map<string, string>();

export function registerCommitMessageCommand(): Disposable {
  return commands.registerCommand('pi-code.generateCommitMessage', async (scmRequest?: ScmRequest) => {
    logger.info('Generate Commit Message command triggered.');
    try {
      let uri: Uri | undefined;
      if (scmRequest && scmRequest.rootUri) {
        uri = scmRequest.rootUri;
        logger.info(`Root URI provided by SCM context: ${uri?.fsPath}`);
      } else {
        const folders = workspace.workspaceFolders;
        if (folders && folders.length > 0) {
          uri = folders[0].uri;
          logger.info(`Root URI resolved from active workspace folders: ${uri?.fsPath}`);
        } else {
          logger.info('No active workspace folders found.');
        }
      }

      const repo = await getGitRepository(uri);
      if (!repo) {
        logger.info('Git repository resolution failed: no Git repository found.');
        window.showErrorMessage('No Git repository found.');
        return;
      }
      logger.info(`Git repository resolved successfully: ${repo.rootUri.fsPath}`);

      const cwd = repo.rootUri.fsPath;

      logger.info(`Scanning git changes in directory: ${cwd}`);
      const { changes, useStaged } = await getGitChanges(repo, cwd);
      logger.info(`Found ${changes.length} change file(s). Staged changes used: ${useStaged}`);
      if (changes.length === 0) {
        logger.info('No changes to process. Exiting.');
        window.showInformationMessage('No changes found to commit.');
        return;
      }

      const userMessage = repo.inputBox.value;
      const previousGenerated = lastGeneratedMessages.get(cwd);

      let userInstruction = '';
      let rejectedMessage = '';

      if (previousGenerated && userMessage.trim() === previousGenerated.trim()) {
        logger.info('Input box value matches previously generated message. Treating as a re-generation.');
        userInstruction = lastUserInstructions.get(cwd) || '';
        rejectedMessage = previousGenerated;
      } else {
        logger.info(`Gathered new user instruction from input box: ${userMessage}`);
        userInstruction = userMessage;
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
          const diff = await getGitDiffContext(repo, changes, useStaged);
          logger.info(`Generated diff context (character length: ${diff.length})`);

          const { branch, recentCommits } = await getRepoContext(repo);
          logger.info(`Current Branch: ${branch}`);
          logger.info(`Recent Commits count: ${recentCommits.split('\n').filter(Boolean).length}`);

          const gitContext = buildGitContext(changes, diff, branch, recentCommits, useStaged);

          let prompt = COMMIT_MESSAGE_PROMPT.trim();
          if (userInstruction && userInstruction.trim()) {
            prompt += `\n\n## User-Provided Context\n\n${userInstruction.trim()}`;
          }
          if (rejectedMessage && rejectedMessage.trim()) {
            prompt += '\n\n## Rejected Commit Message';
            prompt += `\n\nPreviously generated commit message (which was not accepted):\n\n${rejectedMessage.trim()}`;
            prompt += `\n\nPlease generate a new, different commit message that follows the same rules.`;
          }
          prompt += `\n\n${gitContext}`;
          prompt = prompt.trim();

          logger.info(`Fully assembled prompt (character length: ${prompt.length})`);

          logger.info('Initializing ModelRuntime...');
          const runtime = await lazyModelRuntime();

          logger.info('Loading SettingsManager...');
          const settingsManager = SettingsService.getInstance(cwd).getSettingsManager();
          const defaultProviderId = settingsManager.getDefaultProvider();
          const defaultModelId = settingsManager.getDefaultModel();
          logger.info(`Settings values - Default Provider: ${defaultProviderId}, Default Model: ${defaultModelId}`);

          let model;
          if (defaultProviderId && defaultModelId) {
            model = runtime.getModel(defaultProviderId, defaultModelId);
          }
          if (!model) {
            logger.info('Default model not found. Fetching first available model from runtime...');
            const available = runtime.getAvailableSnapshot();
            logger.info(`Available models: ${available.map((m) => `${m.provider}/${m.id}`).join(', ')}`);
            model = available[0];
          }

          if (!model) {
            logger.error('ERROR: No model configured or available.');
            throw new Error('No model configured or available. Please configure your model settings in pi-agent.');
          }
          logger.info(`Selected model for completion: ${model.provider}/${model.id}`);

          const llmContext = {
            messages: [
              {
                role: 'user' as const,
                content: prompt,
                timestamp: Date.now(),
              },
            ],
          };

          logger.info('Sending completion request to backend...');
          const response = await runtime.completeSimple(model, llmContext);
          logger.info('Completion response received successfully.');

          const rawMessage = response.content
            .filter((c) => c.type === 'text')
            .map((c) => c.text)
            .join('')
            .trim();
          logger.info(`Raw LLM response: ${rawMessage}`);

          const cleanMessage = extractCodeFenceMessage(rawMessage);
          logger.info(`Extracted commit message: ${cleanMessage}`);

          if (cleanMessage) {
            repo.inputBox.value = cleanMessage;
            lastGeneratedMessages.set(cwd, cleanMessage);
            logger.info('Updated inputBox value successfully.');
          } else {
            throw new Error('Empty response received from model.');
          }
        },
      );
    } catch (error) {
      const errMessage = error instanceof Error ? error.stack || error.message : String(error);
      logger.error(`ERROR: ${errMessage}`);
      window.showErrorMessage(`Failed to generate commit message: ${error instanceof Error ? error.message : String(error)}`);
    }
  });
}
