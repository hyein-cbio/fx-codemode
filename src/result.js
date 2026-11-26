import { MAX_RESULT_BYTES } from './limits.js';

const jsonBytes = (value) => Buffer.byteLength(JSON.stringify(value));

export function failure(kind, message, location) {
  return { ok: false, error: { kind, message, ...(location && { location }) } };
}

function clip(text, limit) {
  if (text.length <= limit) return { value: text, clipped: false };
  return { value: `${text.slice(0, limit).replace(/[\uD800-\uDBFF]$/, '')}…`, clipped: true };
}

function boundedDiagnostic({ kind, message, location, suggestions }) {
  const text = clip(message, 512);
  const hints = (suggestions ?? []).slice(0, 3).map((hint) => clip(hint, 128));
  const at = location && { line: location.line, column: location.column };
  return {
    value: { kind, message: text.value, ...(at && { location: at }),
      ...(hints.length && { suggestions: hints.map(({ value }) => value) }) },
    clipped: text.clipped || hints.some(({ clipped }) => clipped) || hints.length < (suggestions?.length ?? 0),
  };
}

// Only transfer plain diagnostics to the parent. Drop upstream causes and stacks.
export function publicResult(result, { includeToolCalls = false } = {}) {
  const { ok, logs } = result;
  const error = ok ? undefined : boundedDiagnostic(result.error);
  const warnings = (result.warnings ?? []).slice(0, 8).map(boundedDiagnostic);
  const truncated = result.truncated === true || error?.clipped ||
    warnings.some(({ clipped }) => clipped) || warnings.length < (result.warnings?.length ?? 0);
  return {
    ok,
    ...(ok ? { value: result.value } : { error: error.value }),
    ...(logs?.length && { logs }),
    ...(warnings.length && { warnings: warnings.map(({ value }) => value) }),
    ...(includeToolCalls && result.toolCalls && { toolCalls: result.toolCalls.map(({ name }) => ({ name })) }),
    ...(truncated && { truncated: true }),
  };
}

function capResult(result) {
  if (jsonBytes(result) <= MAX_RESULT_BYTES) return result;

  // Keep the primary error and as many warnings as fit in the diagnostic budget.
  // A success keeps a serialized preview, not a pretend complete JSON value.
  const preview = result.ok
    ? { ok: true, value: '…', truncated: true }
    : { ok: false, error: result.error, truncated: true };
  if (result.toolCalls && jsonBytes({ ...preview, toolCalls: result.toolCalls }) <= MAX_RESULT_BYTES / 2) {
    preview.toolCalls = result.toolCalls;
  }
  for (const warning of result.warnings ?? []) {
    const warnings = [...(preview.warnings ?? []), warning];
    if (jsonBytes({ ...preview, warnings }) > MAX_RESULT_BYTES / 2) break;
    preview.warnings = warnings;
  }
  if (!result.ok) return preview;

  const value = typeof result.value === 'string' ? result.value : JSON.stringify(result.value);
  let budget = MAX_RESULT_BYTES - jsonBytes(preview);
  let end = 0;
  for (const character of value) {
    // Count post-escaping bytes without splitting Unicode code points.
    budget -= jsonBytes(character) - 2;
    if (budget < 0) break;
    end += character.length;
  }
  preview.value = `${value.slice(0, end)}…`;
  return preview;
}

export function toolResult(result) {
  const payload = capResult(result);
  return {
    isError: !payload.ok,
    content: [{ type: 'text', text: JSON.stringify(payload) }],
    structuredContent: payload,
  };
}
