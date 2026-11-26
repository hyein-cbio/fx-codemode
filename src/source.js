import { parse } from 'acorn';
import { MAX_AST_DEPTH, MAX_AST_NODES } from './limits.js';
import { failure } from './result.js';

const tooComplex = () => failure('SourceTooComplex', 'Simplify the source or split it into smaller calls.');
// Acorn columns are zero-based; CodeMode diagnostics are one-based.
const location = (at) => at && { line: at.line, column: at.column + 1 };

// Bound the syntax tree, then let CodeMode decide which JavaScript features
// and virtual modules the interpreter supports. No host module loader is used.
export function checkSource(code) {
  let program;
  try {
    program = parse(code, {
      ecmaVersion: 'latest',
      sourceType: 'script',
      locations: true,
      allowReturnOutsideFunction: true,
      allowAwaitOutsideFunction: true,
      allowImportExportEverywhere: true,
    });
  } catch (error) {
    if (error instanceof RangeError) return tooComplex();
    if (error instanceof SyntaxError) return failure('ParseError', error.message, location(error.loc));
    throw error;
  }

  if (!program.body.some((node) => node.type !== 'EmptyStatement')) {
    return failure('EmptySource', 'Provide an expression or statement to run.');
  }

  const pending = [{ node: program, depth: 0 }];
  let count = 0;
  while (pending.length) {
    const { node, depth } = pending.pop();
    if (++count > MAX_AST_NODES || depth > MAX_AST_DEPTH) return tooComplex();
    for (const value of Object.values(node)) {
      for (const child of Array.isArray(value) ? value : [value]) {
        if (child && typeof child.type === 'string') pending.push({ node: child, depth: depth + 1 });
      }
    }
  }
}
