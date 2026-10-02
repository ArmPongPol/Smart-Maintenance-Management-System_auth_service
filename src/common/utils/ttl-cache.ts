interface Entry<V> {
  value: V;
  expiresAt: number;
}

/**
 * Small in-process cache with a fixed TTL and a size bound (oldest entry is
 * evicted first). Per process only: in cluster mode each worker has its own
 * copy, so keep TTLs short.
 *
 * A ttlMs or maxEntries of 0 disables caching.
 */
export class TtlCache<K, V> {
  private readonly entries = new Map<K, Entry<V>>();
  private readonly inflight = new Map<K, Promise<V>>();
  // Bumped on every invalidation so a load that started before it does not
  // write its (possibly stale) result back into the cache.
  private epoch = 0;

  constructor(
    private readonly ttlMs: number,
    private readonly maxEntries: number,
    private readonly now: () => number = Date.now,
  ) {}

  private get enabled(): boolean {
    return this.ttlMs > 0 && this.maxEntries > 0;
  }

  get size(): number {
    return this.entries.size;
  }

  get(key: K): V | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;

    if (entry.expiresAt <= this.now()) {
      this.entries.delete(key);
      return undefined;
    }

    return entry.value;
  }

  set(key: K, value: V): void {
    if (!this.enabled) return;

    this.entries.delete(key);
    while (this.entries.size >= this.maxEntries) {
      // Map keeps insertion order and every entry has the same TTL, so the
      // first key is the oldest and the soonest to expire.
      const oldest = this.entries.keys().next();
      if (oldest.done) break;
      this.entries.delete(oldest.value);
    }
    this.entries.set(key, { value, expiresAt: this.now() + this.ttlMs });
  }

  /**
   * Returns the cached value or loads it. Concurrent misses for the same key
   * share one load. `shouldCache` can veto caching a result (e.g. null).
   */
  getOrLoad(
    key: K,
    loader: () => Promise<V>,
    shouldCache: (value: V) => boolean = () => true,
  ): Promise<V> {
    if (!this.enabled) return loader();

    const hit = this.get(key);
    if (hit !== undefined) return Promise.resolve(hit);

    const pending = this.inflight.get(key);
    if (pending) return pending;

    const epoch = this.epoch;
    const load = loader()
      .then((value) => {
        if (epoch === this.epoch && shouldCache(value)) this.set(key, value);
        return value;
      })
      .finally(() => {
        if (this.inflight.get(key) === load) this.inflight.delete(key);
      });
    this.inflight.set(key, load);

    return load;
  }

  delete(key: K): void {
    this.epoch++;
    this.entries.delete(key);
    this.inflight.delete(key);
  }

  clear(): void {
    this.epoch++;
    this.entries.clear();
    this.inflight.clear();
  }
}
