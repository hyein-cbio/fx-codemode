import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const entry = fileURLToPath(new URL('../src/server.js', import.meta.url));

test('Codemode over stdio', { timeout: 20_000 }, async (t) => {
  const client = new Client({ name: 'fx-codemode-test', version: '0.1.0' });
  const transport = new StdioClientTransport({ command: process.execPath, args: [entry] });
  t.after(() => client.close());

  const startup = performance.now();
  await client.connect(transport);

  function execute(code, options = {}) {
    return client.callTool({ name: 'execute_js', arguments: { code, ...options } });
  }

  await t.test('lists the read-only execution and inspection tools', async (t) => {
    const { tools } = await client.listTools();
    t.diagnostic(`Launch, connect and list: ${Math.round(performance.now() - startup)} ms`);
    assert.deepEqual(tools.map(({ name }) => name), ['execute_js', 'inspect_js']);
    assert.ok(tools.every((tool) => tool.annotations.readOnlyHint));
    assert.deepEqual(tools[0].inputSchema.required, ['code']);
  });

  await t.test('returns 42 and agrees with the text fallback', async (t) => {
    const start = performance.now();
    const result = await execute('return 40 + 2');
    t.diagnostic(`Arithmetic tool call: ${Math.round(performance.now() - start)} ms`);
    assert.notEqual(result.isError, true);
    assert.deepEqual(result.structuredContent, { ok: true, value: 42 });
    assert.deepEqual(JSON.parse(result.content[0].text), result.structuredContent);
  });

  await t.test('transforms data and captures console output', async () => {
    const result = await execute('const xs = [1, 2, 3]; console.log("doubling"); return { values: xs.map(n => n * 2) };');
    assert.deepEqual(result.structuredContent, { ok: true, value: { values: [2, 4, 6] }, logs: ['doubling'] });
  });

  await t.test('rejects blank and oversized source, including multi-byte source', async () => {
    for (const code of ['   ', 'a'.repeat(16_385), 'あ'.repeat(6_000)]) {
      const result = await execute(code);
      assert.equal(result.isError, true);
    }
  });

  await t.test('reports empty, malformed, and overly complex programs distinctly', async () => {
    for (const [code, kind] of [
      ['// comment only', 'EmptySource'],
      ['return (', 'ParseError'],
      [`return ${'1 + '.repeat(70)}1`, 'SourceTooComplex'],
      ['0;'.repeat(2_100), 'SourceTooComplex'],
    ]) {
      const result = await execute(code);
      assert.equal(result.isError, true);
      assert.equal(result.structuredContent.error.kind, kind);
      if (kind === 'ParseError') assert.equal(result.structuredContent.error.location.line, 1);
    }
  });

  await t.test('supports static and dynamic virtual imports, require, and JSON bindings', async () => {
    const result = await execute(`
      import { URL } from 'node:url';
      const { Buffer } = await import(moduleName);
      const { TextEncoder } = require('node:util');
      return {
        hostname: new URL(input.url).hostname,
        base64: Buffer.from(input.text).toString('base64'),
        bytes: new TextEncoder().encode(input.text).length,
      };
    `, { bindings: { input: { url: 'https://example.test/', text: 'fx' }, moduleName: 'node:buffer' } });
    assert.deepEqual(result.structuredContent, {
      ok: true, value: { hostname: 'example.test', base64: 'Zng=', bytes: 2 },
    });
  });

  await t.test('does not load host modules, installed packages, or local files', async () => {
    for (const code of [
      'return require("node:fs")',
      'return await import("node:child_process")',
      'import "effect";',
      'return await import("./package.json")',
    ]) {
      const result = await execute(code);
      assert.equal(result.isError, true);
      assert.match(result.structuredContent.error.message, /Cannot import/);
    }
  });

  await t.test('shows guest discovery and enforces per-run budgets', async () => {
    const found = await execute('return search({ query: "skills", limit: 1 }).items[0].path;');
    assert.deepEqual(found.structuredContent, { ok: true, value: 'tools.skills.read' });
    const blocked = await execute('return search("skills");', { limits: { maxToolCalls: 0 } });
    assert.equal(blocked.structuredContent.error.kind, 'ToolCallLimitExceeded');
    const short = await execute('return "x".repeat(1000)', { limits: { maxOutputBytes: 64 } });
    assert.equal(short.structuredContent.truncated, true);
  });

  await t.test('rejects oversized bindings, reserved binding names, and over-budget requests', async () => {
    let nested = 0;
    for (let index = 0; index < 34; index++) nested = [nested];
    for (const options of [
      { bindings: { text: '가'.repeat(22_000) } },
      { bindings: { nested } },
      { bindings: { tools: {} } },
      { limits: { timeoutMs: 2_001 } },
      { limits: { maxToolCalls: 65 } },
      { limits: { maxOutputBytes: 8_193 } },
    ]) {
      const result = await execute('return 1;', options);
      assert.equal(result.isError, true);
    }
  });

  await t.test('inspects signatures and static references without executing', async () => {
    const inspect = (args) => client.callTool({ name: 'inspect_js', arguments: args });
    const catalog = (await inspect({})).structuredContent.value.catalog;
    assert.equal(catalog[0].path, 'skills.read');
    assert.match(catalog[0].signature, /board/);
    const { structuredContent } = await inspect({ code: `
      import { URL } from 'node:url';
      search("skills");
      await tools.skills.read({ name: 'ccc' });
      while (true) {}
    ` });
    assert.deepEqual(structuredContent, {
      ok: true,
      value: { catalog, references: { tools: ['skills.read'], modules: ['url'], globals: ['search'] } },
    });
  });

  await t.test('grants no skill without explicit server configuration', async () => {
    const result = await execute('return await tools.skills.read({ name: "board" })');
    assert.equal(result.isError, true);
    assert.equal(result.structuredContent.error.kind, 'ToolFailure');
    assert.match(result.structuredContent.error.message, /No SKILL\.md is granted/);
  });

  await t.test('does not expose process or fetch', async () => {
    for (const name of ['process', 'fetch']) {
      const result = await execute(`return ${name}`);
      assert.equal(result.isError, true);
      assert.match(result.structuredContent.error.message, /Unknown identifier/);
    }
  });

  await t.test('caps serialized output after accounting for markers and escaped text', async () => {
    for (const character of ['x', '\\']) {
      const result = await execute(`return ${JSON.stringify(character)}.repeat(16000)`);
      const payload = result.structuredContent;
      assert.equal(payload.ok, true);
      assert.equal(payload.truncated, true);
      // The interpreter may preview an encoded string, including its opening quote.
      assert.ok(payload.value.includes(character.repeat(4)));
      assert.ok(Buffer.byteLength(JSON.stringify(payload), 'utf8') <= 8_192);
      assert.deepEqual(JSON.parse(result.content[0].text), payload);
    }
  });

  await t.test('times out, rejects overlapping calls and recovers', async () => {
    const first = execute('while (true) {}');
    const second = execute('return 0');
    const [timedOut, busy] = await Promise.all([first, second]);
    assert.equal(timedOut.isError, true);
    assert.equal(timedOut.structuredContent.error.kind, 'TimeoutExceeded');
    assert.equal(busy.isError, true);
    assert.equal(busy.structuredContent.error.kind, 'Busy');
    assert.deepEqual((await execute('return 7')).structuredContent, { ok: true, value: 7 });
  });
});
