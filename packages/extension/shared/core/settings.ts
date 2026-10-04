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
  readonly scale?: number;
}

interface StringSetting extends SettingBase {
  readonly type: 'string';
  readonly default: string;
}

interface StringListSetting extends SettingBase {
  readonly type: 'string[]';
  readonly default: readonly string[];
}

type SettingSpec = BooleanSetting | NumberSetting | StringSetting | StringListSetting;

const SETTINGS_SCHEMA = {
  enableTodoTool: {
    type: 'boolean',
    default: true,
    description: 'Let the agent split the work into a checklist and keep it updated as it goes.',
  },
  enableAskQuestionTool: {
    type: 'boolean',
    default: true,
    description: 'Let the agent stop and ask you when a request is unclear.',
  },
  enableSubagentTool: {
    type: 'boolean',
    default: false,
    description: 'Let the agent hand research to a helper that reads on its own and reports back a short summary.',
  },
  enableAgentRules: {
    type: 'boolean',
    default: true,
    description: 'Let the agent pick up your project instructions from AGENTS.md and CLAUDE.md files.',
  },
  enableSkillDiscovery: {
    type: 'boolean',
    default: true,
    description: 'Let the agent choose a skill on its own. When off, you pick the skill yourself.',
  },
  enableMcpTool: {
    type: 'boolean',
    default: false,
    description: 'Let the agent use extra tools from the MCP servers you set up.',
  },

  yolo: {
    type: 'boolean',
    default: false,
    restricted: true,
    description: 'Approve every agent action without asking you. Overrides the approval settings below.',
  },
  yoloRespectDenied: {
    type: 'boolean',
    default: true,
    restricted: true,
    description: 'Keep blocking the paths and commands you denied, even when everything else is approved.',
  },

  autoApproveRead: {
    type: 'boolean',
    default: false,
    restricted: true,
    description: 'Approve reading files without asking you.',
  },
  autoApproveSkillReads: {
    type: 'boolean',
    default: false,
    restricted: true,
    description: 'Approve reading skill files without asking you. Needs Read Files approval on.',
  },
  autoApproveWrite: {
    type: 'boolean',
    default: false,
    restricted: true,
    description: 'Approve creating and editing files without asking you.',
  },
  autoApproveDelete: {
    type: 'boolean',
    default: false,
    restricted: true,
    description: 'Approve deleting files without asking you.',
  },
  autoApproveExecute: {
    type: 'boolean',
    default: false,
    restricted: true,
    description: 'Approve running terminal commands without asking you.',
  },
  allowedReadPaths: {
    type: 'string[]',
    default: [],
    restricted: true,
    description: 'Files that can be read without asking. Use * to allow every path.',
  },
  deniedReadPaths: {
    type: 'string[]',
    default: [],
    description: 'Files that can never be read, even when allowed above.',
  },
  allowedWritePaths: {
    type: 'string[]',
    default: [],
    restricted: true,
    description: 'Files that can be created and edited without asking. Use * to allow every path.',
  },
  deniedWritePaths: {
    type: 'string[]',
    default: [],
    description: 'Files that can never be created or edited, even when allowed above.',
  },
  allowedDeletePaths: {
    type: 'string[]',
    default: [],
    restricted: true,
    description: 'Files that can be deleted without asking. Use * to allow every path.',
  },
  deniedDeletePaths: {
    type: 'string[]',
    default: [],
    description: 'Files that can never be deleted, even when allowed above.',
  },
  allowedExecuteCommands: {
    type: 'string[]',
    default: [],
    restricted: true,
    description: 'Commands that can run without asking. Use * to allow every command.',
  },
  deniedExecuteCommands: {
    type: 'string[]',
    default: [],
    description: 'Commands that can never run, even when allowed above.',
  },

  autoCompactContext: {
    type: 'boolean',
    default: true,
    description: 'Shorten the conversation on your own once it grows past the limit.',
  },
  autoCompactContextPercent: {
    type: 'number',
    default: 80,
    minimum: 10,
    maximum: 100,
    unit: '%',
    description: 'How full the conversation has to be before it is shortened.',
  },
  maxOpenTabsContext: {
    type: 'number',
    default: 20,
    minimum: 0,
    maximum: 500,
    description: 'How many open tabs the agent sees. More tabs mean more detail and a higher cost.',
  },
  maxWorkspaceFiles: {
    type: 'number',
    default: 100,
    minimum: 0,
    maximum: 500,
    description: 'How many workspace files the agent sees. More files mean more detail and a higher cost.',
  },
  excludeIgnoredFiles: {
    type: 'boolean',
    default: true,
    description: 'Skip the files your project ignores, so build output and dependencies stay out of the conversation.',
  },
  maxGitStatusFiles: {
    type: 'number',
    default: 20,
    minimum: 0,
    maximum: 50,
    description: 'How many changed files to show. Set to 0 to show none; the current branch always shows.',
  },
  maxToolOutputLines: {
    type: 'number',
    default: 2000,
    minimum: 100,
    maximum: 10000,
    step: 100,
    description: 'How many lines of one result the agent gets before the rest is cut off.',
  },
  maxToolOutputSizeKb: {
    type: 'number',
    default: 50,
    minimum: 5,
    maximum: 500,
    step: 5,
    unit: 'KB',
    description: 'How large one result can be before the agent gets it cut off.',
  },

  commitMessageModel: {
    type: 'string',
    default: '',
    description: 'Model that writes commit messages. Leave default to use the model picked in the chat.',
  },
  commitMessageThinkingLevel: {
    type: 'string',
    default: '',
    description: 'How much the model thinks while writing a commit message. Leave default to follow the chat.',
  },
  delegationTaskModel: {
    type: 'string',
    default: '',
    description: 'Model that runs the tasks the agent hands off. Leave default to use the model picked in the chat.',
  },
  delegationTaskThinkingLevel: {
    type: 'string',
    default: '',
    description: 'How much the model thinks on the tasks it hands off. Leave default to follow the chat.',
  },
  maxConcurrentFileReads: {
    type: 'number',
    default: 10,
    minimum: 1,
    maximum: 100,
    description: 'How many files the agent reads at once. More can be faster but uses more memory.',
  },
  maxCommandTimeoutMs: {
    type: 'number',
    default: 1_800_000,
    minimum: 60_000,
    maximum: 3_600_000,
    step: 60_000,
    unit: 'min',
    scale: 60_000,
    description: 'How long one command may run before the agent stops it.',
  },
  retryOnError: {
    type: 'number',
    default: 3,
    minimum: 0,
    maximum: 61,
    description: 'How many times the agent tries again when a request fails for a temporary reason.',
  },
  minTextAttachment: {
    type: 'number',
    default: 2000,
    minimum: 100,
    maximum: 100000,
    step: 100,
    description: 'Text longer than this is sent as a file instead of pasted into the chat box.',
  },
} as const satisfies Record<string, SettingSpec>;

export type SettingKey = keyof typeof SETTINGS_SCHEMA;

export type SettingSpecOf<K extends SettingKey> = (typeof SETTINGS_SCHEMA)[K];

type SettingValue<S> = S extends { readonly type: 'boolean' }
  ? boolean
  : S extends { readonly type: 'number' }
    ? number
    : S extends { readonly type: 'string' }
      ? string
      : S extends { readonly type: 'string[]' }
        ? readonly string[]
        : never;

export type AppSettings = {
  readonly [K in SettingKey]: SettingValue<SettingSpecOf<K>>;
};

export const SETTING_KEYS = Object.keys(SETTINGS_SCHEMA) as readonly SettingKey[];

export function getSettingSpec(key: SettingKey): SettingSpec {
  return SETTINGS_SCHEMA[key];
}

function defaultValue(key: SettingKey): unknown {
  const fallback = SETTINGS_SCHEMA[key].default;
  return Array.isArray(fallback) ? [...fallback] : fallback;
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
    case 'string': {
      return (typeof value === 'string' ? value : fallback) as AppSettings[K];
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
  for (const key of SETTING_KEYS) {
    if (key in values) {
      result[key] = coerceSetting(key, values[key]);
    }
  }
  return result as Partial<AppSettings>;
}
