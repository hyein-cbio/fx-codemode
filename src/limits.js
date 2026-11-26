export const MAX_CODE_BYTES = 16 * 1024;
export const MAX_BINDING_BYTES = 64 * 1024;
export const MAX_RUN_TIMEOUT_MS = 2_000;
export const MAX_TOOL_CALLS = 64;
export const MAX_AST_NODES = 4_000;
export const MAX_AST_DEPTH = 64;
export const MAX_RESULT_BYTES = 8 * 1024;
export const WORKER_TIMEOUT_MS = 3_000;

export const codeModeLimits = {
  timeoutMs: 750,
  maxToolCalls: 8,
  maxOutputBytes: MAX_RESULT_BYTES,
};
