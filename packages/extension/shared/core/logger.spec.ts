import { afterEach, describe, expect, it } from 'vitest';

import { logger, parseLogLevel } from '@pi-code/shared/core/logger';

import type { LoggerSink } from '@pi-code/shared/core/logger';

function recordingSink(records: Array<[string, string]>): LoggerSink {
  return {
    trace: (message) => records.push(['trace', message]),
    debug: (message) => records.push(['debug', message]),
    info: (message) => records.push(['info', message]),
    warn: (message) => records.push(['warn', message]),
    error: (message) => records.push(['error', String(message)]),
  };
}

describe('parseLogLevel', () => {
  it('parses a level regardless of case or whitespace', () => {
    expect(parseLogLevel(' Trace ')).toBe('trace');
    expect(parseLogLevel('OFF')).toBe('off');
  });

  it('returns undefined for unset or invalid values', () => {
    expect(parseLogLevel(undefined)).toBeUndefined();
    expect(parseLogLevel('loud')).toBeUndefined();
  });
});

describe('logger levels', () => {
  let records: Array<[string, string]> = [];

  const recordedLevels = (): string[] => records.map(([level]) => level);

  afterEach(() => {
    logger.setLevel(null);
    logger.setSink(null);
  });

  it('drops entries below the default info level', () => {
    records = [];
    logger.setSink(recordingSink(records));
    logger.trace('t');
    logger.debug('d');
    logger.info('i');
    logger.warn('w');
    logger.error('e');
    expect(recordedLevels()).toEqual(['info', 'warn', 'error']);
  });

  it('raises verbosity when the level is raised', () => {
    logger.setLevel('trace');
    records = [];
    logger.setSink(recordingSink(records));
    logger.trace('t');
    expect(recordedLevels()).toEqual(['trace']);
  });

  it('silences every level when off', () => {
    logger.setLevel('off');
    records = [];
    logger.setSink(recordingSink(records));
    logger.error('e');
    expect(recordedLevels()).toEqual([]);
  });
});
