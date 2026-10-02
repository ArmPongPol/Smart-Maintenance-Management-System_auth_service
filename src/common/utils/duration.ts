const UNIT_SECONDS: Record<string, number> = {
  s: 1,
  m: 60,
  h: 60 * 60,
  d: 24 * 60 * 60,
};

/**
 * Converts a duration like "15m" or "7d" (the format env.validation.ts
 * enforces for JWT TTLs) to whole seconds. A bare number is read as seconds.
 */
export function durationToSeconds(value: string): number {
  const match = /^(\d+)([smhd])?$/.exec(value.trim());
  if (!match) {
    throw new Error(`Invalid duration "${value}", expected e.g. 15m, 1h, 7d`);
  }

  return parseInt(match[1], 10) * UNIT_SECONDS[match[2] ?? 's'];
}
