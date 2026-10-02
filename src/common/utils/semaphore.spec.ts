import { ServiceUnavailableException } from '@nestjs/common';
import { Semaphore, SERVER_BUSY_MESSAGE } from './semaphore';

// A task that stays running until its release() is called.
const deferredTask = () => {
  let release!: (value: string) => void;
  const promise = new Promise<string>((resolve) => (release = resolve));
  return { task: () => promise, release };
};

const flush = () => new Promise((resolve) => setImmediate(resolve));

describe('Semaphore', () => {
  it('runs at most `concurrency` tasks at once', async () => {
    const semaphore = new Semaphore(2, 10);
    const tasks = [deferredTask(), deferredTask(), deferredTask()];
    const started: number[] = [];

    const runs = tasks.map((t, i) =>
      semaphore.run(() => {
        started.push(i);
        return t.task();
      }),
    );
    await flush();

    expect(started).toEqual([0, 1]);
    expect(semaphore.running).toBe(2);
    expect(semaphore.pending).toBe(1);

    tasks[0].release('a');
    await flush();
    expect(started).toEqual([0, 1, 2]);
    expect(semaphore.running).toBe(2);
    expect(semaphore.pending).toBe(0);

    tasks[1].release('b');
    tasks[2].release('c');
    await expect(Promise.all(runs)).resolves.toEqual(['a', 'b', 'c']);
    expect(semaphore.running).toBe(0);
  });

  it('starts waiters in FIFO order', async () => {
    const semaphore = new Semaphore(1, 10);
    const first = deferredTask();
    const order: number[] = [];

    const runs = [
      semaphore.run(first.task),
      semaphore.run(() => Promise.resolve(order.push(1))),
      semaphore.run(() => Promise.resolve(order.push(2))),
    ];
    first.release('done');
    await Promise.all(runs);

    expect(order).toEqual([1, 2]);
  });

  it('rejects with 503 once the wait queue is full', async () => {
    const semaphore = new Semaphore(1, 1);
    const blocker = deferredTask();
    const running = semaphore.run(blocker.task);
    const queued = semaphore.run(() => Promise.resolve('queued'));

    const rejected = semaphore.run(() => Promise.resolve('never'));
    await expect(rejected).rejects.toBeInstanceOf(ServiceUnavailableException);
    await expect(rejected).rejects.toThrow(SERVER_BUSY_MESSAGE);

    blocker.release('ok');
    await expect(running).resolves.toBe('ok');
    await expect(queued).resolves.toBe('queued');
  });

  it('releases the slot when a task fails', async () => {
    const semaphore = new Semaphore(1, 0);

    await expect(
      semaphore.run(() => Promise.reject(new Error('boom'))),
    ).rejects.toThrow('boom');

    expect(semaphore.running).toBe(0);
    await expect(semaphore.run(() => Promise.resolve(1))).resolves.toBe(1);
  });

  it('rejects invalid limits', () => {
    expect(() => new Semaphore(0, 1)).toThrow(RangeError);
    expect(() => new Semaphore(1, -1)).toThrow(RangeError);
  });
});
