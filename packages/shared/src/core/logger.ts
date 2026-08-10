type LogLevelName = 'trace' | 'debug' | 'info' | 'warn' | 'error';

interface LoggerSink {
  trace(message: string, ...args: unknown[]): void;
  debug(message: string, ...args: unknown[]): void;
  info(message: string, ...args: unknown[]): void;
  warn(message: string, ...args: unknown[]): void;
  error(message: string | Error, ...args: unknown[]): void;
}

const consoleSink: LoggerSink = {
  trace: (message, ...args) => console.trace(message, ...args),
  debug: (message, ...args) => console.debug(message, ...args),
  info: (message, ...args) => console.info(message, ...args),
  warn: (message, ...args) => console.warn(message, ...args),
  error: (message, ...args) => console.error(message, ...args),
};

let sink: LoggerSink = consoleSink;

function forward(level: LogLevelName, args: unknown[]): void {
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
