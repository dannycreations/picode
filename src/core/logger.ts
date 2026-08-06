type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error';

const levelRank: Record<LogLevel, number> = {
  trace: 0,
  debug: 1,
  info: 2,
  warn: 3,
  error: 4,
} as const;

const consoleMethod: Record<LogLevel, 'trace' | 'debug' | 'info' | 'warn' | 'error'> = {
  trace: 'trace',
  debug: 'debug',
  info: 'info',
  warn: 'warn',
  error: 'error',
} as const;

let minimumLevel: LogLevel = 'info';

function log(level: LogLevel, args: unknown[]): void {
  if (levelRank[level] < levelRank[minimumLevel]) {
    return;
  }
  console[consoleMethod[level]](...args);
}

export const logger = {
  setLevel(level: LogLevel): void {
    minimumLevel = level;
  },

  trace(...args: unknown[]): void {
    log('trace', args);
  },

  debug(...args: unknown[]): void {
    log('debug', args);
  },

  info(...args: unknown[]): void {
    log('info', args);
  },

  warn(...args: unknown[]): void {
    log('warn', args);
  },

  error(...args: unknown[]): void {
    log('error', args);
  },
} as const;
