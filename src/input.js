import { z } from 'zod';
import { MAX_BINDING_BYTES, MAX_CODE_BYTES, MAX_RUN_TIMEOUT_MS, MAX_TOOL_CALLS, MAX_RESULT_BYTES } from './limits.js';

const MAX_BINDING_DEPTH = 32;
const MAX_BINDING_NODES = 16_000;

function boundedJson(value) {
  // MCP input is JSON. Traverse iteratively before stringifying or giving nested data to CodeMode.
  const pending = [{ value, depth: 0 }];
  let visited = 0;
  let stringBytes = 0;
  while (pending.length) {
    const { value, depth } = pending.pop();
    if (++visited > MAX_BINDING_NODES || depth > MAX_BINDING_DEPTH) return false;
    if (typeof value === 'number' && !Number.isFinite(value)) return false;
    if (typeof value === 'string') {
      stringBytes += Buffer.byteLength(value);
      if (stringBytes > MAX_BINDING_BYTES) return false;
    } else if (value !== null && typeof value === 'object') {
      for (const child of Object.values(value)) {
        if (pending.length + visited >= MAX_BINDING_NODES) return false;
        pending.push({ value: child, depth: depth + 1 });
      }
    }
  }
  return Buffer.byteLength(JSON.stringify(value)) <= MAX_BINDING_BYTES;
}

const bindingName = z.string().max(64)
  .regex(/^[$_\p{ID_Start}][$_\u200C\u200D\p{ID_Continue}]*$/u, 'Use a JavaScript identifier.')
  .refine((name) => !['tools', 'search', '__proto__', 'constructor', 'prototype'].includes(name), 'Reserved binding name.');

const code = z.string().min(1).max(MAX_CODE_BYTES).regex(/\S/, 'Provide non-blank code.').refine(
  (text) => Buffer.byteLength(text) <= MAX_CODE_BYTES,
  `Code must fit in ${MAX_CODE_BYTES} UTF-8 bytes.`,
).describe('CodeMode source (up to 16 KiB UTF-8).');

export const executeInput = z.strictObject({
  code,
  bindings: z.record(bindingName, z.unknown()).refine(boundedJson, 'Use finite JSON values within 64 KiB and 32 levels.').optional()
    .describe('Read-only JSON globals for this run, e.g. {"rows":[1,2]}. Cannot replace tools or search.'),
  limits: z.strictObject({
    timeoutMs: z.number().int().min(1).max(MAX_RUN_TIMEOUT_MS).optional(),
    maxToolCalls: z.number().int().min(0).max(MAX_TOOL_CALLS).optional(),
    maxOutputBytes: z.number().int().min(0).max(MAX_RESULT_BYTES).optional(),
  }).optional().describe('Optional interpreter budgets; the server still enforces its outer worker and result caps.'),
  includeToolCalls: z.boolean().optional().describe('Include the names of admitted tool calls in the result.'),
});

export const inspectInput = z.strictObject({ code: code.optional() });
