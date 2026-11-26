import { Worker } from 'node:worker_threads';
import { WORKER_TIMEOUT_MS } from './limits.js';
import { failure } from './result.js';

const workerURL = new URL('./worker.js', import.meta.url);
const cancelled = () => failure('Cancelled', 'Execution cancelled.');

async function executeWorker(url, workerData, signal, timeoutMs) {
  const worker = new Worker(url, {
    workerData,
    env: {},
    execArgv: [],
    resourceLimits: { maxOldGenerationSizeMb: 64, maxYoungGenerationSizeMb: 16 },
  });

  let deadline;
  let onAbort;
  try {
    return await new Promise((resolve, reject) => {
      worker.once('message', resolve);
      worker.once('error', reject);
      worker.once('messageerror', reject);
      worker.once('exit', (code) => reject(new Error(`Worker exited before returning a result (${code})`)));
      deadline = setTimeout(() => {
        resolve(failure('WorkerTimeout', 'Execution exceeded the worker deadline.'));
      }, timeoutMs);
      onAbort = () => resolve(cancelled());
      signal.addEventListener('abort', onAbort, { once: true });
      if (signal.aborted) onAbort();
    });
  } finally {
    clearTimeout(deadline);
    signal.removeEventListener('abort', onAbort);
    await worker.terminate();
  }
}

// Grants come from server configuration, not from MCP tool arguments.
export function createExecutor({
  skillFiles = {}, url = workerURL, timeoutMs = WORKER_TIMEOUT_MS, reportError = console.error,
} = {}) {
  let running = false;
  return async (request, signal) => {
    if (signal.aborted) return cancelled();
    if (running) return failure('Busy', 'Another CodeMode execution is in progress. Try again once it finishes.');
    running = true;
    try {
      return await executeWorker(url, { ...request, skillFiles }, signal, timeoutMs);
    } catch (error) {
      reportError('[fx-codemode] Worker failed:', error);
      return failure('WorkerFailure', 'The execution worker did not return a result.');
    } finally {
      // Do not admit another run until worker termination has completed.
      running = false;
    }
  };
}
