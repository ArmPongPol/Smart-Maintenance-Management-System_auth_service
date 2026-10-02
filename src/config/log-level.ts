import { LogLevel } from '@nestjs/common';

// Most to least verbose.
const LEVELS: LogLevel[] = [
  'verbose',
  'debug',
  'log',
  'warn',
  'error',
  'fatal',
];

export const LOG_LEVEL_NAMES = LEVELS;

/** LOG_LEVEL=warn -> ['warn', 'error', 'fatal']. Unknown values mean 'log'. */
export function resolveLogLevels(level: string | undefined): LogLevel[] {
  const index = LEVELS.indexOf((level ?? 'log') as LogLevel);
  return LEVELS.slice(index < 0 ? LEVELS.indexOf('log') : index);
}
