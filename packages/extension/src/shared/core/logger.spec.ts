import { afterEach, describe, expect, it } from 'vitest';

import { logger } from '@pi-code/shared/core/logger';

import type { LoggerSink } from '@pi-code/shared/core/logger';

const ENV_LEVEL_KEY = 'PI_CODE_LOG_LEVEL';

function recordingSink(records: Array<[string, string]>, level?: LoggerSink['level']): LoggerSink {
  return {
    level,
    trace: (message) => records.push(['trace', message]),
    debug: (message) => records.push(['debug', message]),
    info: (message) => records.push(['info', message]),
    warn: (message) => records.push(['warn', message]),
    error: (message) => records.push(['error', String(message)]),
  };
}

describe('logger levels', () => {
  let records: Array<[string, string]> = [];

  const recordedLevels = (): string[] => records.map(([level]) => level);

  afterEach(() => {
    delete process.env[ENV_LEVEL_KEY];
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

  it('raises verbosity from PI_CODE_LOG_LEVEL regardless of case or whitespace', () => {
    process.env[ENV_LEVEL_KEY] = ' Trace ';
    records = [];
    logger.setSink(recordingSink(records));
    logger.trace('t');
    expect(recordedLevels()).toEqual(['trace']);
  });

  it('ignores invalid PI_CODE_LOG_LEVEL values and keeps the default', () => {
    process.env[ENV_LEVEL_KEY] = 'loud';
    records = [];
    logger.setSink(recordingSink(records));
    logger.debug('d');
    logger.info('i');
    expect(recordedLevels()).toEqual(['info']);
  });

  it('lets the sink declare a stricter level than the default', () => {
    records = [];
    logger.setSink(recordingSink(records, 'error'));
    logger.warn('w');
    logger.error('e');
    expect(recordedLevels()).toEqual(['error']);
  });

  it('gives PI_CODE_LOG_LEVEL precedence over the sink level', () => {
    process.env[ENV_LEVEL_KEY] = 'debug';
    records = [];
    logger.setSink(recordingSink(records, 'error'));
    logger.debug('d');
    expect(recordedLevels()).toEqual(['debug']);
  });

  it('silences every level when off', () => {
    process.env[ENV_LEVEL_KEY] = 'off';
    records = [];
    logger.setSink(recordingSink(records));
    logger.error('e');
    expect(recordedLevels()).toEqual([]);
  });
});
