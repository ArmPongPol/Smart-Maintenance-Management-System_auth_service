import { durationToSeconds } from './duration';

describe('durationToSeconds', () => {
  it.each([
    ['30s', 30],
    ['15m', 900],
    ['1h', 3600],
    ['7d', 604800],
    ['45', 45],
  ])('%s -> %i', (input, expected) => {
    expect(durationToSeconds(input)).toBe(expected);
  });

  it('rejects other formats', () => {
    expect(() => durationToSeconds('1w')).toThrow();
    expect(() => durationToSeconds('')).toThrow();
  });
});
