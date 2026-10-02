// Runs the built app (dist/main.js) on every CPU core: `npm run start:cluster`.
//
// The primary process only supervises: it forks WORKERS workers (default:
// os.availableParallelism()), restarts a worker that crashes (with
// exponential backoff, so a crash loop does not spin the CPU), and forwards
// SIGTERM/SIGINT so each worker shuts down gracefully (enableShutdownHooks in
// main.ts). All workers share the listening socket.
//
// Every worker has its own DB pool (DATABASE_POOL_SIZE) and in-process caches,
// so the service opens up to WORKERS x DATABASE_POOL_SIZE connections.
import cluster from 'node:cluster';
import os from 'node:os';

const MIN_BACKOFF_MS = 500;
const MAX_BACKOFF_MS = 30_000;
// A worker that stayed up this long is considered healthy again.
const STABLE_AFTER_MS = 30_000;
// Hard stop if workers do not exit after a shutdown signal.
const SHUTDOWN_TIMEOUT_MS = 30_000;

function positiveInt(value, fallback) {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

if (cluster.isPrimary) {
  const cpus = os.availableParallelism();
  const workerCount = positiveInt(process.env.WORKERS, cpus);

  // argon2 concurrency is per process; split the cores between workers
  // unless HASH_CONCURRENCY is set explicitly.
  const workerEnv = {};
  if (!process.env.HASH_CONCURRENCY) {
    workerEnv.HASH_CONCURRENCY = String(
      Math.max(1, Math.ceil(cpus / workerCount)),
    );
  }

  let shuttingDown = false;
  let consecutiveCrashes = 0;
  const startedAt = new Map();

  const fork = () => {
    const worker = cluster.fork(workerEnv);
    startedAt.set(worker.id, Date.now());
  };

  cluster.on('exit', (worker, code, signal) => {
    const uptime = Date.now() - (startedAt.get(worker.id) ?? Date.now());
    startedAt.delete(worker.id);

    if (shuttingDown) {
      if (Object.keys(cluster.workers ?? {}).length === 0) {
        console.log('[cluster] all workers stopped');
        process.exit(0);
      }
      return;
    }

    consecutiveCrashes = uptime >= STABLE_AFTER_MS ? 1 : consecutiveCrashes + 1;
    const delay = Math.min(
      MAX_BACKOFF_MS,
      MIN_BACKOFF_MS * 2 ** (consecutiveCrashes - 1),
    );
    console.error(
      `[cluster] worker ${worker.process.pid} exited (${signal ?? `code ${code}`}) after ${uptime} ms; restarting in ${delay} ms`,
    );
    setTimeout(() => {
      if (!shuttingDown) fork();
    }, delay);
  });

  const shutdown = (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[cluster] ${signal} received, stopping workers`);

    const workers = Object.values(cluster.workers ?? {});
    if (workers.length === 0) process.exit(0);
    for (const worker of workers) {
      // Nest ignores a repeated signal while it is already shutting down, so
      // this is safe even when the terminal also signalled the workers.
      worker?.process.kill(signal);
    }
    setTimeout(() => {
      console.error('[cluster] workers did not stop in time, exiting');
      process.exit(1);
    }, SHUTDOWN_TIMEOUT_MS).unref();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  console.log(`[cluster] primary ${process.pid} starting ${workerCount} workers`);
  for (let i = 0; i < workerCount; i++) fork();
} else {
  await import('../dist/main.js');
}
