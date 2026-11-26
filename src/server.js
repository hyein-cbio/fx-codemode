import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createExecutor } from './execution.js';
import { executeInput, inspectInput } from './input.js';
import { toolResult } from './result.js';

if (Number(process.versions.node.split('.')[0]) < 24) {
  console.error('fx-codemode requires Node.js 24 or later.');
  process.exit(1);
}

const execute = createExecutor({
  skillFiles: {
    board: process.env.CODEMODE_BOARD_SKILL,
    ccc: process.env.CODEMODE_CCC_SKILL,
  },
});
const server = new McpServer({ name: 'fx-codemode', version: '0.1.0' });
const annotations = { readOnlyHint: true, destructiveHint: false, openWorldHint: false };
server.registerTool('execute_js', {
  title: 'Execute CodeMode JavaScript',
  description: 'Run CodeMode JavaScript and return JSON. Supports async functions, virtual standard-library modules, JSON bindings, and search() for granted tools. Use tools.skills.read for granted SKILL.md files. No host Node.js modules, shell, network, or arbitrary files.',
  inputSchema: executeInput,
  annotations,
}, async (request, { signal }) => toolResult(await execute(request, signal)));

server.registerTool('inspect_js', {
  title: 'Inspect CodeMode source without executing it',
  description: 'List available CodeMode tools and signatures. Optionally scan source for static tool and module references without running JavaScript or making tool calls.',
  inputSchema: inspectInput,
  annotations,
}, async (request, { signal }) => toolResult(await execute({ ...request, inspect: true }, signal)));

await server.connect(new StdioServerTransport());
