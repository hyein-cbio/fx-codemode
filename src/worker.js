import { parentPort, workerData } from 'node:worker_threads';
import { codeModeLimits } from './limits.js';
import { publicResult } from './result.js';
import { checkSource } from './source.js';

const { code, bindings, limits, includeToolCalls, inspect, skillFiles } = workerData;
const rejection = code === undefined ? undefined : checkSource(code);
if (rejection) {
  parentPort.postMessage(publicResult(rejection));
} else {
  const [{ CodeMode }, { Effect }, { makeSkillTools }] = await Promise.all([
    import('@opencode/codemode'), import('effect'), import('./skill-tools.js'),
  ]);
  const runtime = CodeMode.make({ tools: makeSkillTools(skillFiles), limits: { ...codeModeLimits, ...limits } });
  if (inspect) {
    // Static inspection is advisory: it never starts the guest program or a host tool call.
    const scan = code === undefined ? undefined : CodeMode.scanProgram(code, ['search']);
    const result = scan?._tag === 'Failure' ? { ok: false, error: scan.failure } : {
      ok: true,
      value: {
        catalog: runtime.catalog,
        ...(scan && { references: {
          tools: scan.success.tools,
          modules: [...scan.success.modules],
          globals: [...scan.success.globals.keys()],
        } }),
      },
    };
    parentPort.postMessage(publicResult(result));
  } else {
    parentPort.postMessage(publicResult(await Effect.runPromise(runtime.execute(code, bindings)), { includeToolCalls }));
  }
}
