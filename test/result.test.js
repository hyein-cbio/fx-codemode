import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MAX_RESULT_BYTES } from '../src/limits.js';
import { publicResult, toolResult } from '../src/result.js';

test('preserves bounded warnings in a Unicode preview', () => {
  const warning = { kind: 'Warning', message: 'Some work did not finish.' };
  const response = toolResult(publicResult({ ok: true, value: '😀'.repeat(4_000), warnings: [warning] }));
  assert.equal(response.structuredContent.truncated, true);
  assert.match(response.structuredContent.value, /^😀+…$/u);
  assert.deepEqual(response.structuredContent.warnings, [warning]);
  assert.ok(Buffer.byteLength(response.content[0].text) <= MAX_RESULT_BYTES);
  assert.deepEqual(JSON.parse(response.content[0].text), response.structuredContent);
});

test('exposes bounded suggestions and opt-in tool names but not call payloads', () => {
  const warning = { kind: 'UnknownTool', message: 'Unknown tool', suggestions: ['skills.read', 'x'.repeat(200)] };
  const response = toolResult(publicResult({ ok: true, value: 42, warnings: [warning],
    toolCalls: [{ name: 'skills.read', input: { private: true } }],
  }, { includeToolCalls: true }));
  assert.deepEqual(response.structuredContent.toolCalls, [{ name: 'skills.read' }]);
  assert.deepEqual(response.structuredContent.warnings[0].suggestions, ['skills.read', `${'x'.repeat(128)}…`]);
  assert.equal(response.structuredContent.truncated, true);
});

test('preserves the primary error without carrying host causes or oversized logs', () => {
  const error = {
    kind: 'ExecutionFailure',
    message: `${'x'.repeat(511)}😀${'y'.repeat(900)}`,
    location: { line: 2, column: 1 },
    cause: new Error('private stack'),
  };
  const response = toolResult(publicResult({ ok: false, error, logs: ['l'.repeat(MAX_RESULT_BYTES)] }));
  assert.equal(response.isError, true);
  assert.deepEqual(response.structuredContent, {
    ok: false,
    truncated: true,
    error: { kind: error.kind, message: `${'x'.repeat(511)}…`, location: error.location },
  });
});
