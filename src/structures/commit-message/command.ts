import { join } from 'node:path';
import { getAgentDir, ModelRuntime, SettingsManager } from '@earendil-works/pi-coding-agent';
import { commands, extensions, ProgressLocation, window, workspace } from 'vscode';

import { Logger } from '@extension/core/logger';
import { buildGitContext, getGitChanges, getGitDiffContext, getRepoContext } from '@extension/structures/commit-message/git';
import { buildPrompt, extractCommitMessage } from '@extension/structures/commit-message/helpers';

import type { Disposable, ExtensionContext, Uri } from 'vscode';
import type { GitExtension, GitRepository, LlmResponseContent, ScmRequest } from '@extension/types/extension';

async function getGitRepository(uri?: Uri): Promise<GitRepository | null> {
  const gitExtension = extensions.getExtension<GitExtension>('vscode.git');
  if (!gitExtension) {
    return null;
  }
  if (!gitExtension.isActive) {
    await gitExtension.activate();
  }
  const gitApi = gitExtension.exports?.getAPI(1);
  if (!gitApi) {
    return null;
  }

  if (uri) {
    for (const repo of gitApi.repositories) {
      if (repo.rootUri.fsPath === uri.fsPath || uri.fsPath.startsWith(repo.rootUri.fsPath)) {
        return repo;
      }
    }
  }

  return gitApi.repositories[0] || null;
}

export function registerCommitMessageCommand(_: ExtensionContext, logger: Logger): Disposable {
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
      const { changes, useStaged } = getGitChanges(cwd);
      logger.info(`Found ${changes.length} change file(s). Staged changes used: ${useStaged}`);
      if (changes.length === 0) {
        logger.info('No changes to process. Exiting.');
        window.showInformationMessage('No changes found to commit.');
        return;
      }

      await window.withProgress(
        {
          location: ProgressLocation.SourceControl,
          title: 'Generating commit message with Pi...',
          cancellable: false,
        },
        async () => {
          logger.info('Generating diff and repo context...');
          const diff = getGitDiffContext(cwd, changes, useStaged);
          logger.info(`Generated diff context (character length: ${diff.length})`);

          const { branch, recentCommits } = getRepoContext(cwd);
          logger.info(`Current Branch: ${branch}`);
          logger.info(`Recent Commits count: ${recentCommits.split('\n').filter(Boolean).length}`);

          const gitContext = buildGitContext(changes, diff, branch, recentCommits, useStaged);
          const prompt = buildPrompt(gitContext);
          logger.info(`Fully assembled prompt (character length: ${prompt.length})`);

          const agentDir = getAgentDir();
          const authPath = join(agentDir, 'n');
          const modelsPath = join(agentDir, 'models.json');
          logger.info(`Configuration paths - Agent directory: ${agentDir}`);
          logger.info(`Configuration paths - Credentials file: ${authPath}`);
          logger.info(`Configuration paths - Models definition: ${modelsPath}`);

          logger.info('Initializing ModelRuntime...');
          const runtime = await ModelRuntime.create({
            authPath,
            modelsPath,
          });

          logger.info('Loading SettingsManager...');
          const settingsManager = SettingsManager.create(cwd, agentDir);
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
            logger.info('ERROR: No model configured or available.');
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

          const rawMessage = (response.content as readonly LlmResponseContent[])
            .filter((c) => c.type === 'text')
            .map((c) => c.text)
            .join('')
            .trim();
          logger.info(`Raw LLM response: ${rawMessage}`);

          const cleanMessage = extractCommitMessage(rawMessage);
          logger.info(`Extracted commit message: ${cleanMessage}`);

          if (cleanMessage) {
            repo.inputBox.value = cleanMessage;
            logger.info('Updated inputBox value successfully.');
          } else {
            throw new Error('Empty response received from model.');
          }
        },
      );
    } catch (error) {
      const errMessage = error instanceof Error ? error.stack || error.message : String(error);
      logger.info(`ERROR: ${errMessage}`);
      logger.show(true);
      window.showErrorMessage(`Failed to generate commit message: ${error instanceof Error ? error.message : String(error)}`);
    }
  });
}
