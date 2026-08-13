import type { ModelThinkingLevel } from '@pi-code/shared/core/types';

export const DEFAULT_MODEL_ID = 'pi-code';

export const ACTIVE_TASK_ID = 'task-active';

export const HISTORY_SCOPES = ['current', 'all'] as const;

export const THINKING_LEVEL_ORDER: readonly ModelThinkingLevel[] = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'];
