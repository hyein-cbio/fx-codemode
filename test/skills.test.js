import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const entry = fileURLToPath(new URL('../src/server.js', import.meta.url));
const cccRead = 'return await tools.skills.read({ name: "ccc" });';

test('CodeMode skill grants over stdio', { timeout: 20_000 }, async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'fx-codemode-skills-'));
  const board = join(root, 'board', 'SKILL.md');
  const ccc = join(root, 'ccc', 'SKILL.md');
  const client = new Client({ name: 'fx-codemode-skills-test', version: '0.1.0' });
  t.after(async () => {
    try { await client.close(); } finally { await rm(root, { recursive: true, force: true }); }
  });
  await mkdir(join(root, 'board'));
  await mkdir(join(root, 'ccc'));
  const boardText = '# Board\nread-only fixture\n';
  const cccText = '# CCC\nUTF-8 fixture: 한글\n';
  await writeFile(board, boardText);
  await writeFile(ccc, cccText);
  await client.connect(new StdioClientTransport({
    command: process.execPath,
    args: [entry],
    env: { CODEMODE_BOARD_SKILL: board, CODEMODE_CCC_SKILL: ccc },
  }));

  const execute = (code, options = {}) => client.callTool({ name: 'execute_js', arguments: { code, ...options } });

  await t.test('reads both files in one MCP call and branches on the first result', async () => {
    const { structuredContent } = await execute(`
      const board = await tools.skills.read({ name: 'board' });
      if (!board.text.startsWith('# Board')) throw new Error('Unexpected board skill');
      const ccc = await tools.skills.read({ name: 'ccc' });
      return { totalBytes: board.bytes + ccc.bytes, title: ccc.text.split('\\n')[0] };
    `, { includeToolCalls: true });
    assert.deepEqual(structuredContent, {
      ok: true,
      value: { totalBytes: Buffer.byteLength(boardText) + Buffer.byteLength(cccText), title: '# CCC' },
      toolCalls: [{ name: 'skills.read' }, { name: 'skills.read' }],
    });
  });

  await t.test('rejects a name outside the allowlist and does not use caller-provided paths', async () => {
    const unknown = await execute('return await tools.skills.read({ name: "other" });');
    assert.equal(unknown.isError, true);
    assert.equal(unknown.structuredContent.error.kind, 'InvalidToolInput');
    const override = await execute(`return (await tools.skills.read({ name: 'board', path: ${JSON.stringify(ccc)} })).text;`);
    if (override.isError) assert.equal(override.structuredContent.error.kind, 'InvalidToolInput');
    else assert.equal(override.structuredContent.value, boardText);
  });

  await t.test('refuses missing files, final symlinks, oversized files and invalid UTF-8', async () => {
    await rm(ccc);
    await assertReadFailure();
    await symlink(board, ccc);
    await assertReadFailure();
    await rm(ccc);
    await writeFile(ccc, Buffer.alloc(32 * 1024 + 1, 0x61));
    await assertReadFailure();
    await writeFile(ccc, Buffer.from([0xff]));
    await assertReadFailure();

    async function assertReadFailure() {
      const result = await execute(cccRead);
      assert.equal(result.isError, true);
      assert.equal(result.structuredContent.error.kind, 'ToolFailure');
      assert.ok(!result.content[0].text.includes(root));
    }
  });
});
