import { TtlCache } from './ttl-cache';

describe('TtlCache', () => {
  let now: number;
  const clock = () => now;

  beforeEach(() => {
    now = 1_000;
  });

  it('returns a value until its TTL has passed', () => {
    const cache = new TtlCache<string, number>(100, 10, clock);
    cache.set('a', 1);

    now += 99;
    expect(cache.get('a')).toBe(1);
    now += 1;
    expect(cache.get('a')).toBeUndefined();
  });

  it('evicts the oldest entry when full', () => {
    const cache = new TtlCache<string, number>(100, 2, clock);
    cache.set('a', 1);
    cache.set('b', 2);
    cache.set('c', 3);

    expect(cache.get('a')).toBeUndefined();
    expect(cache.get('b')).toBe(2);
    expect(cache.get('c')).toBe(3);
    expect(cache.size).toBe(2);
  });

  it('does nothing with a TTL of 0', async () => {
    const cache = new TtlCache<string, number>(0, 10, clock);
    const loader = jest.fn().mockResolvedValue(1);

    await cache.getOrLoad('a', loader);
    await cache.getOrLoad('a', loader);

    expect(loader).toHaveBeenCalledTimes(2);
  });

  it('shares one load between concurrent misses', async () => {
    const cache = new TtlCache<string, number>(100, 10, clock);
    const loader = jest.fn().mockResolvedValue(1);

    const results = await Promise.all([
      cache.getOrLoad('a', loader),
      cache.getOrLoad('a', loader),
    ]);

    expect(results).toEqual([1, 1]);
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it('does not cache results the caller vetoes', async () => {
    const cache = new TtlCache<string, number | null>(100, 10, clock);
    const loader = jest.fn().mockResolvedValue(null);

    await cache.getOrLoad('a', loader, (value) => value !== null);
    await cache.getOrLoad('a', loader, (value) => value !== null);

    expect(loader).toHaveBeenCalledTimes(2);
  });

  it('drops a load that was in flight during an invalidation', async () => {
    const cache = new TtlCache<string, string>(100, 10, clock);
    let finish!: (value: string) => void;
    const stale = cache.getOrLoad(
      'a',
      () => new Promise<string>((resolve) => (finish = resolve)),
    );

    cache.delete('a');
    finish('stale');
    await stale;

    await expect(
      cache.getOrLoad('a', () => Promise.resolve('fresh')),
    ).resolves.toBe('fresh');
  });
});
