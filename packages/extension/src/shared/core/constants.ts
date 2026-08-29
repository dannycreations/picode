export const DEFAULT_APP_ID = 'pi-code';

export const COMMAND_IDS = {
  chatView: `${DEFAULT_APP_ID}.chatView`,
  chatViewFocus: `${DEFAULT_APP_ID}.chatView.focus`,
  settingsButtonClicked: `${DEFAULT_APP_ID}.settingsButtonClicked`,
  generateCommitMessage: `${DEFAULT_APP_ID}.generateCommitMessage`,
  commitMessageGenerating: `${DEFAULT_APP_ID}.commitMessageGenerating`,
  cancelGenerateCommitMessage: `${DEFAULT_APP_ID}.cancelGenerateCommitMessage`,
  addToContext: `${DEFAULT_APP_ID}.addToContext`,
  addProblemToContext: `${DEFAULT_APP_ID}.addProblemToContext`,
  fillCode: `${DEFAULT_APP_ID}.fillCode`,
  fixCode: `${DEFAULT_APP_ID}.fixCode`,
} as const;

export const ACTIVE_TASK_ID = 'task-active';

export const MENTION_PATTERN = /(?<=^|\s)@(\S+)/g;
export const TAG_PATTERN = /(?<=^|\s)#(\S+)/g;

// Shortest displayable hash is 7 chars; longest is a full SHA-1.
export const SHORT_HASH_LENGTH = 7;
export const COMMIT_HASH_PATTERN = /^[a-f0-9]{7,40}$/i;

export const WORKING_CHANGES_TAG = 'changes';
