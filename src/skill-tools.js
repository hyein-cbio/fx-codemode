import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import { basename, isAbsolute } from 'node:path';
import { Tool, toolError } from '@opencode/codemode';
import { Effect, Schema } from 'effect';

const MAX_SKILL_BYTES = 32 * 1024;

async function readSkill(path, signal) {
  signal.throwIfAborted();
  // Verify the opened file, and never follow a symlink at the granted filename.
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const stats = await file.stat();
    if (!stats.isFile() || stats.size > MAX_SKILL_BYTES) throw new Error('Invalid skill file');

    // Read one extra byte to detect a file that grew after stat().
    const buffer = Buffer.alloc(MAX_SKILL_BYTES + 1);
    let bytes = 0;
    while (bytes < buffer.length) {
      signal.throwIfAborted();
      const { bytesRead } = await file.read(buffer, bytes, buffer.length - bytes, bytes);
      if (bytesRead === 0) break;
      bytes += bytesRead;
    }
    if (bytes > MAX_SKILL_BYTES) throw new Error('Skill file is too large');
    const text = new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, bytes));
    return { text, bytes };
  } finally {
    await file.close();
  }
}

export function makeSkillTools(grants) {
  return {
    skills: {
      read: Tool.make({
        description: 'Read an explicitly granted board or ccc SKILL.md. Returns UTF-8 text and byte count. Accepts no path.',
        input: Schema.Struct({ name: Schema.Literals(['board', 'ccc']) }),
        output: Schema.Struct({ text: Schema.String, bytes: Schema.Number }),
        execute: ({ name }) => {
          const path = grants[name];
          if (!path || !isAbsolute(path) || basename(path) !== 'SKILL.md') {
            return Effect.fail(toolError(`No SKILL.md is granted for ${name}.`));
          }
          return Effect.tryPromise({
            try: (signal) => readSkill(path, signal),
            catch: () => toolError(`Cannot read ${name}: expected a regular, non-symlink UTF-8 SKILL.md of at most 32 KiB.`),
          });
        },
      }),
    },
  };
}
