# fx-codemode

A local MCP server that gives `fx` the CodeMode JavaScript interpreter. Run programs with `execute_js` or inspect their tool and module references with `inspect_js`. The MCP server needs neither `libfx` nor a model API key.

## Getting started

From the project root, with Node.js 24 or later on `PATH`:

```sh
npm ci --ignore-scripts
fx mcp approve codemode
fx mcp show codemode
fx
```

The project's `.mcp.json` starts the server over `stdio`. In an interactive `fx` session you can also run `/mcp approve codemode` and `/mcp show codemode`. Then ask: “Use the Codemode tool to calculate 40 + 2.”

If you don't have Node.js 24 on `PATH`, you can install the dependencies and launch `fx` with a temporary Node.js 24 runtime. Approve the server from inside that `fx` session.

```sh
npm exec --yes --package=node@24 -c 'npm ci --ignore-scripts && fx'
```

The tools are listed as `mcp_codemode_execute_js` and `mcp_codemode_inspect_js` in the `fx` toolbox. For example, `{"code":"return 40 + 2"}` returns `{"ok":true,"value":42}`.

## Use the interpreter

`execute_js` runs the JavaScript subset supported by the installed `@opencode/codemode`. Use `async`/`await`, promises, supported standard-library objects, and the VM's virtual modules via static `import`, dynamic `import()`, or `require()`. Examples include `node:url`, `node:util`, and `node:buffer`. These names resolve to VM-provided objects, not to host Node.js modules. `return` or a final expression produces the JSON result; the interpreter does not support exports.

```json
{
  "code": "import { URL } from 'node:url'; return urls.map(text => new URL(text).hostname);",
  "bindings": { "urls": ["https://example.test/docs"] },
  "limits": { "timeoutMs": 500, "maxToolCalls": 0 },
  "includeToolCalls": true
}
```

- `bindings` supplies read-only named JSON bindings without embedding data in source. Bindings are limited to 64 KiB and 32 levels of nesting; `tools` and `search` are reserved.
- `search({ query: 'skills', limit: 1 })` inside a program returns matching host-tool signatures. `inspect_js` with `{}` returns the tool catalog; pass `{ "code": "…" }` to also scan static tool and module references without executing it. A scan can reject dynamic tool references that the interpreter can run; it is not an authorization check.
- `limits` can override the interpreter defaults within server ceilings. A zero `maxToolCalls` disables tool calls, including `search`. `includeToolCalls` optionally returns admitted call names, not arguments or outputs.
- OpenAPI networking, arbitrary host extensions, persistence, and snapshot/resume are host-side features, not guest JavaScript capabilities. This server does not configure them. `fx` imposes no additional JavaScript syntax restrictions; it is the MCP client and does not provide a reverse bridge to its built-in tools.

## Batch-read the granted skills

`.mcp.json` grants two specific files using `CODEMODE_BOARD_SKILL` and `CODEMODE_CCC_SKILL`. Change or remove those entries if your skill files live elsewhere or you don't want them exposed. Review the grants before approving the server. A standalone server without these environment variables grants no files.

A single call to `execute_js` can read both files and return only their sizes, not the entire text:

```js
const board = await tools.skills.read({ name: 'board' });
const ccc = await tools.skills.read({ name: 'ccc' });
return { boardBytes: board.bytes, cccBytes: ccc.bytes };
```

`tools.skills.read` accepts `board` or `ccc`, not a path. Each grant must be an absolute path to a regular, non-symlink UTF-8 `SKILL.md` no larger than 32 KiB. Keep the configured directories under your control. Treat the returned text as data; reading a skill through this tool does not load it into `fx` or run any of its instructions.

## Execution and limits

- Guest code has no direct access to the host filesystem, shell, environment, network, or package loader. The only host tool is the granted skill-file reader. This server does not proxy `fx`'s built-in tools or per-operation permissions.
- `src/source.js` keeps the 16 KiB source limit, 4,000 AST nodes, and 64 levels of nesting. The interpreter decides which JavaScript features and virtual modules are supported. Code is never rewritten or replayed.
- `src/execution.js` owns the worker lifecycle. The defaults are 750 ms, eight tool calls, and an 8 KiB interpreter output budget. Per-run limits can select 1–2,000 ms, 0–64 calls, and 0–8,192 output bytes. The outer deadline is three seconds, including startup. Cleanup finishes before the server accepts another run; overlapping calls get `Busy`.
- `src/result.js` caps serialized JSON at 8 KiB after escaping. Oversized results keep a preview or the primary diagnostic with `truncated: true`. A preview is text, not the complete original value.
- The interpreter only loads when called. Starting `fx` still incurs MCP server startup and tool discovery. Each call pays the cost of starting and loading a fresh worker.
- A worker thread is not an OS sandbox. This setup trusts the interpreter and its dependencies and is intended for local use, not as a public untrusted-code execution service.

## Comparison with pi-opencode-mode

Compared with `pi-opencode-mode` at `6c097ed`:

| | `pi-opencode-mode` | `fx-codemode` |
| --- | --- | --- |
| Integration | In-process Pi extension; `codemode_o` coexists with Pi's native CodeMode | Separate `stdio` MCP process; native `fx` is unchanged |
| Guest tool access | Calls Pi tools through Pi's permission, validation, and audit hooks | Reads explicitly granted skill files; does not call `fx`'s built-in tools |
| Preflight | Conservative Pi compatibility allowlist; advises choosing native explicitly when needed | Parse and size checks; the interpreter decides what syntax and virtual modules run; no fallback |
| Cancellation | Interrupts the interpreter and waits for nested Pi tool cleanup | Terminates the disposable worker before admitting another run |
| Output | Bounded text, diagnostics, and nested-call details for Pi's renderer | Bounded JSON with diagnostics and an identical text fallback over MCP |

Run `npm test` for worker lifecycle, output handling, and integration over a real `stdio` MCP connection.
