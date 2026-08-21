interface SettingBase {
  readonly description: string;
  readonly restricted?: boolean;
}

interface BooleanSetting extends SettingBase {
  readonly type: 'boolean';
  readonly default: boolean;
}

interface NumberSetting extends SettingBase {
  readonly type: 'number';
  readonly default: number;
  readonly minimum: number;
  readonly maximum: number;
  readonly step?: number;
  readonly unit?: string;
}

interface StringListSetting extends SettingBase {
  readonly type: 'string[]';
  readonly default: readonly string[];
}

type SettingSpec = BooleanSetting | NumberSetting | StringListSetting;

export const SETTINGS_SCHEMA = {
  enableTodoTool: {
    type: 'boolean',
    default: true,
    description: 'Let the agent break work into a checklist and keep it updated while it works (`update_todo`).',
  },
  enableAskQuestionTool: {
    type: 'boolean',
    default: true,
    description: 'Let the agent pause and ask you for details when a request is unclear (`ask_question`).',
  },
  enableSubagentTool: {
    type: 'boolean',
    default: false,
    description:
      'Let the agent delegate read-only research to a sub-agent that works in its own context window and reports back a summary (`spawn_subagent`).',
  },
  enableAgentRules: {
    type: 'boolean',
    default: true,
    description: 'Let the agent auto load `AGENTS.md` and `CLAUDE.md` files for project-specific instructions.',
  },
  enableSkillDiscovery: {
    type: 'boolean',
    default: true,
    description:
      'Let the agent pick skills (`SKILL.md` files) on its own. When off, skills stay available and you load one explicitly with `/skill:<name>`.',
  },

  yolo: {
    type: 'boolean',
    default: false,
    restricted: true,
    description: 'Automatically approve every agent tool call without asking. Overrides the per-action approval settings below.',
  },
  yoloRespectDenied: {
    type: 'boolean',
    default: true,
    restricted: true,
    description: 'In yolo mode, still block tool calls that match your denied paths and commands.',
  },

  autoApproveRead: {
    type: 'boolean',
    default: false,
    restricted: true,
    description: 'Automatically allow the agent to read files and line ranges (`read_file`).',
  },
  autoApproveSkillReads: {
    type: 'boolean',
    default: false,
    restricted: true,
    description: 'Automatically allow the agent to read skill files (`SKILL.md`) when it uses a skill. Requires read auto approval.',
  },
  autoApproveWrite: {
    type: 'boolean',
    default: false,
    restricted: true,
    description: 'Automatically allow the agent to create and edit files (`write_file`, `edit_file`).',
  },
  autoApproveDelete: {
    type: 'boolean',
    default: false,
    restricted: true,
    description: 'Automatically allow the agent to delete files (`delete_file`). Use with caution.',
  },
  autoApproveExecute: {
    type: 'boolean',
    default: false,
    restricted: true,
    description: 'Automatically allow the agent to run terminal commands (`execute_command`) inside your terminal shell environment.',
  },
  allowedReadPaths: {
    type: 'string[]',
    default: [],
    restricted: true,
    description: 'Files matching these globs are auto-approved for reading. Add * to allow all paths.',
  },
  deniedReadPaths: {
    type: 'string[]',
    default: [],
    description: 'Files matching these globs are blocked from reading, overriding allowed paths.',
  },
  allowedWritePaths: {
    type: 'string[]',
    default: [],
    restricted: true,
    description: 'Files matching these globs are auto-approved for writing and editing. Add * to allow all paths.',
  },
  deniedWritePaths: {
    type: 'string[]',
    default: [],
    description: 'Files matching these globs are blocked from writing and editing, overriding allowed paths.',
  },
  allowedDeletePaths: {
    type: 'string[]',
    default: [],
    restricted: true,
    description: 'Files matching these globs are auto-approved for deleting. Add * to allow all paths.',
  },
  deniedDeletePaths: {
    type: 'string[]',
    default: [],
    description: 'Files matching these globs are blocked from deleting, overriding allowed paths.',
  },
  allowedExecuteCommands: {
    type: 'string[]',
    default: [],
    restricted: true,
    description: 'Commands starting with these prefixes are auto-approved. Add * to allow all commands.',
  },
  deniedExecuteCommands: {
    type: 'string[]',
    default: [],
    description: 'Commands starting with these prefixes are blocked, overriding allowed commands.',
  },

  autoCompactContext: {
    type: 'boolean',
    default: true,
    description: 'Automatically compact conversation context when it reaches the threshold.',
  },
  autoCompactContextPercent: {
    type: 'number',
    default: 80,
    minimum: 10,
    maximum: 100,
    unit: '%',
    description: 'The percentage of the context window in use before auto compaction runs.',
  },
  maxOpenTabsContext: {
    type: 'number',
    default: 20,
    minimum: 0,
    maximum: 500,
    description: 'Maximum number of open editor tabs to include in context. Higher values provide more context but increase token usage.',
  },
  maxWorkspaceFiles: {
    type: 'number',
    default: 100,
    minimum: 0,
    maximum: 500,
    description: 'Maximum number of workspace files to include in context. Higher values provide more context but increase token usage.',
  },
  excludeIgnoredFiles: {
    type: 'boolean',
    default: true,
    description:
      'Hide files and folders matched by .gitignore when listing workspace files. Reduces context noise from build output and dependencies.',
  },
  maxGitStatusFiles: {
    type: 'number',
    default: 20,
    minimum: 0,
    maximum: 50,
    description: 'Maximum number of changed files to include in git status context. Set to 0 to disable. Branch info is always shown when above 0.',
  },
  maxConcurrentFileReads: {
    type: 'number',
    default: 10,
    minimum: 1,
    maximum: 100,
    description:
      'Maximum number of files the `read_file` tool loads in parallel. Higher values may speed up reading many small files but increase memory usage.',
  },
  maxToolOutputLines: {
    type: 'number',
    default: 2000,
    minimum: 100,
    maximum: 10000,
    step: 100,
    description:
      'Maximum number of lines a single tool result may send to the model. Whichever limit is reached first, lines or size, triggers truncation.',
  },
  maxToolOutputSizeKb: {
    type: 'number',
    default: 50,
    minimum: 5,
    maximum: 500,
    step: 5,
    unit: 'KB',
    description:
      'Maximum size a single tool result may send to the model. Truncated results keep a notice explaining how to retrieve the remaining output.',
  },
} as const satisfies Record<string, SettingSpec>;

export type SettingKey = keyof typeof SETTINGS_SCHEMA;

export type SettingSpecOf<K extends SettingKey> = (typeof SETTINGS_SCHEMA)[K];

type SettingValue<S> = S extends { readonly type: 'boolean' }
  ? boolean
  : S extends { readonly type: 'number' }
    ? number
    : S extends { readonly type: 'string[]' }
      ? readonly string[]
      : never;

export type AppSettings = {
  readonly [K in SettingKey]: SettingValue<SettingSpecOf<K>>;
};

export const SETTING_KEYS = Object.keys(SETTINGS_SCHEMA) as readonly SettingKey[];

export function isSettingKey(key: string): key is SettingKey {
  return Object.hasOwn(SETTINGS_SCHEMA, key);
}

export function getSettingSpec(key: SettingKey): SettingSpec {
  return SETTINGS_SCHEMA[key];
}

function defaultValue(key: SettingKey): unknown {
  const fallback = SETTINGS_SCHEMA[key].default;
  return Array.isArray(fallback) ? [...fallback] : fallback;
}

export function createDefaultSettings(): AppSettings {
  return Object.fromEntries(SETTING_KEYS.map((key) => [key, defaultValue(key)])) as AppSettings;
}

export function coerceSetting<K extends SettingKey>(key: K, value: unknown): AppSettings[K] {
  const spec = getSettingSpec(key);
  const fallback = defaultValue(key) as AppSettings[K];

  switch (spec.type) {
    case 'boolean': {
      if (typeof value === 'boolean') {
        return value as AppSettings[K];
      }
      return fallback;
    }
    case 'number': {
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        return fallback;
      }
      return Math.min(Math.max(value, spec.minimum), spec.maximum) as AppSettings[K];
    }
    case 'string[]': {
      if (Array.isArray(value)) {
        return value.filter((item) => typeof item === 'string') as unknown as AppSettings[K];
      }
      return fallback;
    }
  }
}

export function coerceSettings(values: Partial<Record<string, unknown>>): Partial<AppSettings> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(values)) {
    if (!isSettingKey(key)) continue;
    result[key] = coerceSetting(key, value);
  }
  return result as Partial<AppSettings>;
}
