type LogLevelName = 'trace' | 'debug' | 'info' | 'warn' | 'error';

type LevelSetting = LogLevelName | 'off';

export interface LoggerSink {
  readonly trace: (message: string, ...args: unknown[]) => void;
  readonly debug: (message: string, ...args: unknown[]) => void;
  readonly info: (message: string, ...args: unknown[]) => void;
  readonly warn: (message: string, ...args: unknown[]) => void;
  readonly error: (message: string | Error, ...args: unknown[]) => void;
}

const LEVEL_WEIGHT: Record<LevelSetting, number> = {
  off: Number.POSITIVE_INFINITY,
  trace: 10,
  debug: 20,
  info: 30,
  warn: 40,
  error: 50,
};

const LEVEL_SETTINGS = Object.keys(LEVEL_WEIGHT) as LevelSetting[];

const consoleSink: LoggerSink = {
  trace: (message, ...args) => console.trace(message, ...args),
  debug: (message, ...args) => console.debug(message, ...args),
  info: (message, ...args) => console.info(message, ...args),
  warn: (message, ...args) => console.warn(message, ...args),
  error: (message, ...args) => console.error(message, ...args),
};

let sink: LoggerSink = consoleSink;

function parseLevel(raw: string | undefined): LevelSetting | undefined {
  const name = raw?.trim().toLowerCase();
  return LEVEL_SETTINGS.find((setting) => setting === name);
}

function readEnvLevel(): LevelSetting | undefined {
  // The webview bundle runs without Node's process global; treat the variable as unset there.
  if (typeof process === 'undefined') return undefined;
  return parseLevel(process.env['PI_CODE_LOG_LEVEL']);
}

function isEnabled(level: LogLevelName): boolean {
  const setting = readEnvLevel() ?? 'info';
  return LEVEL_WEIGHT[level] >= LEVEL_WEIGHT[setting];
}

function forward(level: LogLevelName, args: unknown[]): void {
  if (!isEnabled(level)) return;

  const [head, ...rest] = args;
  if (level === 'error') {
    sink.error(head instanceof Error || typeof head === 'string' ? head : String(head), ...rest);
    return;
  }
  sink[level](typeof head === 'string' ? head : String(head), ...rest);
}

export const logger = {
  setSink(next: LoggerSink | null): void {
    sink = next ?? consoleSink;
  },

  trace(...args: unknown[]): void {
    forward('trace', args);
  },

  debug(...args: unknown[]): void {
    forward('debug', args);
  },

  info(...args: unknown[]): void {
    forward('info', args);
  },

  warn(...args: unknown[]): void {
    forward('warn', args);
  },

  error(...args: unknown[]): void {
    forward('error', args);
  },
} as const;
