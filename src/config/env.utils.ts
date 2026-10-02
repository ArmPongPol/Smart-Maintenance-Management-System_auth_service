/** Parses an integer env var, falling back when it is unset or empty. */
export function intFromEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return fallback;

  const value = parseInt(raw, 10);
  return Number.isNaN(value) ? fallback : value;
}
