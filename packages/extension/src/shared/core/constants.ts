export const DEFAULT_APP_ID = 'pi-code';

export const COMMAND_IDS = {
  chatView: 'pi-code.chatView',
  chatViewFocus: 'pi-code.chatView.focus',
  settingsButtonClicked: 'pi-code.settingsButtonClicked',
  generateCommitMessage: 'pi-code.generateCommitMessage',
  commitMessageGenerating: 'pi-code.commitMessageGenerating',
  cancelGenerateCommitMessage: 'pi-code.cancelGenerateCommitMessage',
  addToContext: 'pi-code.addToContext',
  addProblemToContext: 'pi-code.addProblemToContext',
  fillCode: 'pi-code.fillCode',
  fixCode: 'pi-code.fixCode',
} as const;

export const ACTIVE_TASK_ID = 'task-active';

export const MENTION_PATTERN = /(?<=^|\s)@(\S+)/g;
export const TAG_PATTERN = /(?<=^|\s)#(\S+)/g;

// Shortest displayable hash is 7 chars; longest is a full SHA-1.
export const SHORT_HASH_LENGTH = 7;
export const COMMIT_HASH_PATTERN = /^[a-f0-9]{7,40}$/i;

export const WORKING_CHANGES_TAG = 'changes';
