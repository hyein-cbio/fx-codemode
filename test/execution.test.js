import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createExecutor } from '../src/execution.js';

const url = new URL(`data:text/javascript,${encodeURIComponent(`
  import { parentPort, workerData } from 'node:worker_threads';
  const { code } = workerData;
  if (code === 'hang') setInterval(() => {}, 1_000);
  if (code === 'crash') throw new Error('mock worker crash');
  if (code === 'ok') parentPort.postMessage({ ok: true, value: 42 });
`)}`);
const signal = () => new AbortController().signal;

const kind = (result) => result.error?.kind;

test('cancels an active worker before accepting another execution', async () => {
  const execute = createExecutor({ url });
  const controller = new AbortController();
  const active = execute({ code: 'hang' }, controller.signal);
  controller.abort();

  assert.equal(kind(await execute({ code: 'ok' }, controller.signal)), 'Cancelled');
  assert.equal(kind(await execute({ code: 'ok' }, signal())), 'Busy');
  assert.equal(kind(await active), 'Cancelled');
  assert.deepEqual(await execute({ code: 'ok' }, signal()), { ok: true, value: 42 });
});

test('terminates a nonresponding worker at the outer deadline', async () => {
  const execute = createExecutor({ url, timeoutMs: 100 });
  assert.equal(kind(await execute({ code: 'hang' }, signal())), 'WorkerTimeout');
});

test('contains worker crashes and exits without exposing internals to the client', async () => {
  let errors = 0;
  const execute = createExecutor({ url, reportError: () => { errors++; } });
  for (const code of ['crash', 'exit']) {
    const result = await execute({ code }, signal());
    assert.equal(kind(result), 'WorkerFailure');
    assert.doesNotMatch(result.error.message, /mock worker crash/);
  }
  assert.equal(errors, 2);
  assert.deepEqual(await execute({ code: 'ok' }, signal()), { ok: true, value: 42 });
});
