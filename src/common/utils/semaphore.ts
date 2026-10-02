import { ServiceUnavailableException } from '@nestjs/common';

export const SERVER_BUSY_MESSAGE = 'Server busy, please retry';

/**
 * Limits how many async tasks run at once. Up to `maxQueue` callers wait for a
 * free slot; beyond that, `run` rejects immediately (503 by default) so a
 * burst cannot pile up unbounded memory and latency.
 */
export class Semaphore {
  private active = 0;
  private readonly waiting: Array<() => void> = [];

  constructor(
    private readonly concurrency: number,
    private readonly maxQueue: number,
    private readonly queueFullError: () => Error = () =>
      new ServiceUnavailableException(SERVER_BUSY_MESSAGE),
  ) {
    if (!Number.isInteger(concurrency) || concurrency < 1) {
      throw new RangeError('Semaphore concurrency must be an integer >= 1');
    }
    if (!Number.isInteger(maxQueue) || maxQueue < 0) {
      throw new RangeError('Semaphore maxQueue must be an integer >= 0');
    }
  }

  /** Tasks currently holding a slot. */
  get running(): number {
    return this.active;
  }

  /** Callers waiting for a slot. */
  get pending(): number {
    return this.waiting.length;
  }

  async run<T>(task: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await task();
    } finally {
      this.release();
    }
  }

  private acquire(): Promise<void> {
    if (this.active < this.concurrency) {
      this.active++;
      return Promise.resolve();
    }
    if (this.waiting.length >= this.maxQueue) {
      return Promise.reject(this.queueFullError());
    }

    return new Promise<void>((resolve) => this.waiting.push(resolve));
  }

  private release(): void {
    const next = this.waiting.shift();
    // Hand the slot straight to the next waiter; `active` stays the same.
    if (next) next();
    else this.active--;
  }
}
