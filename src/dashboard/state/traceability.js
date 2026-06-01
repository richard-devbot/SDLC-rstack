import { existsSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { readJson } from './files.js';

// owner: RStack developed by Richardson Gunde

export async function buildTraceMap(runs, fallbackProjectRoot) {
  const traceMap = [];
  for (const run of (runs ?? []).slice(0, 8)) {
    const stageArtifactsDir = join(run.projectRoot ?? fallbackProjectRoot, '.rstack', 'runs', run.runId, 'artifacts', 'stages');
    const archDir = join(stageArtifactsDir, '06-architecture');
    const codeFile = join(stageArtifactsDir, '07-code', 'implementation-report.json');
    const testFile = join(stageArtifactsDir, '08-testing', 'qa-report.json');

    const requirements = run.requirements ?? [];
    const [hasCode, hasTest] = await Promise.all([
      readJson(codeFile, null).then((value) => value !== null),
      readJson(testFile, null).then((value) => value !== null),
    ]);
    const hasArch = existsSync(archDir) && (await readdir(archDir).then((files) => files.length > 0).catch(() => false));
    const passTasks = (run.tasks ?? []).filter((task) => task.status === 'PASS');

    if (requirements.length > 0 || hasArch || hasCode || hasTest || passTasks.length > 0) {
      traceMap.push({
        runId: run.runId,
        projectRoot: run.projectRoot,
        goal: run.manifest?.goal ?? '-',
        brief: run.brief ?? '',
        requirements: requirements.slice(0, 20),
        stages: {
          requirements: requirements.length > 0,
          architecture: hasArch,
          code: hasCode,
          testing: hasTest,
        },
        passTasks: passTasks.map((task) => ({
          id: task.id,
          title: task.title ?? task.id,
          stageId: task.stageId ?? task.stage_id ?? null,
          stageArtifacts: task.stage_artifacts ?? [],
          evidenceCount: (task.validation?.checks ?? []).filter((check) => check.status === 'PASS').length,
        })),
        evidenceTotal: (run.tasks ?? []).reduce((total, task) =>
          total + ((task.validation?.checks ?? []).filter((check) => check.status === 'PASS').length), 0),
      });
    }
  }
  return traceMap;
}
