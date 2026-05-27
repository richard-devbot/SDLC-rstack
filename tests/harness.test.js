import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, rmSync, mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import extension from '../extensions/rstack-sdlc.ts';

// Mock Pi Extension API
const mockPi = {
  tools: {},
  commands: {},
  on: () => {},
  registerTool(tool) {
    this.tools[tool.name] = tool;
  },
  registerCommand(cmd, opts) {
    this.commands[cmd] = opts;
  }
};

test('SDLC-rstack E2E Harness Simulation', async (t) => {
  const projectRoot = mkdtempSync(join(tmpdir(), 'rstack-harness-'));

  process.env.RSTACK_PROJECT_ROOT = projectRoot;

  // Initialize extension
  extension(mockPi);

  await t.test('sdlc_start creates a new run', async () => {
    const start = mockPi.tools.sdlc_start;
    const result = await start.execute('1', { goal: 'Build a weather app' });

    assert.ok(result.details.run_id.includes('build-a-weather-app'));
    assert.strictEqual(result.details.status, 'STARTED');

    const manifestPath = join(projectRoot, '.rstack', 'runs', result.details.run_id, 'manifest.json');
    assert.ok(existsSync(manifestPath), 'Manifest should exist');

    const stageRoot = join(projectRoot, '.rstack', 'runs', result.details.run_id, 'artifacts', 'stages');
    const stageDirs = readdirSync(stageRoot).sort();
    assert.equal(stageDirs.length, 15, 'Run should prepare exactly 15 canonical stage folders');
    assert.deepEqual(stageDirs, [
      '00-environment',
      '01-transcript',
      '02-requirements',
      '03-documentation',
      '04-planning',
      '05-jira',
      '06-architecture',
      '07-code',
      '08-testing',
      '09-deployment',
      '10-summary',
      '11-feedback-loop',
      '12-security-threat-model',
      '13-compliance-checker',
      '14-cost-estimation',
    ]);
  });

  const runId = (await mockPi.tools.sdlc_status.execute('2', {})).details.manifest.run_id;

  await t.test('sdlc_plan bootstraps specs and registry metadata', async () => {
    await mockPi.tools.sdlc_plan.execute('3', { run_id: runId });

    const specsDir = join(projectRoot, '.rstack', 'runs', runId, 'specs');
    assert.ok(existsSync(specsDir), 'Specs directory should exist');
    assert.ok(existsSync(join(specsDir, 'product-brief.md')), 'Product brief spec should exist');
    assert.ok(existsSync(join(specsDir, 'architecture.md')), 'Architecture spec should exist');
    assert.equal(JSON.parse(readFileSync(join(specsDir, 'requirements.json'), 'utf8')).status, 'DRAFT');

    const tasks = JSON.parse(readFileSync(join(projectRoot, '.rstack', 'runs', runId, 'tasks.json'), 'utf8')).tasks;
    const requirementsTask = tasks.find(t => t.id === '002-requirements');
    assert.ok(requirementsTask.pipeline_agents.includes('agent.02-requirements'), 'Requirements stage should route to sdlc/02-requirements');
    assert.ok(requirementsTask.pipeline_agents.includes('agent.04-planning'), 'Requirements stage should route to sdlc/04-planning');
    assert.ok(requirementsTask.stage_artifacts.some(a => a.stage_id === '02-requirements' && a.artifact_path.endsWith('/artifacts/stages/02-requirements/requirements.json')), 'Requirements task should expose canonical stage artifact path');

    const architectureTask = tasks.find(t => t.id === '003-architecture');
    assert.ok(architectureTask.stage_artifacts.some(a => a.stage_id === '06-architecture'), 'Architecture task should route canonical architecture stage output');

    const registryDir = join(projectRoot, '.rstack', 'registry');
    assert.ok(existsSync(join(registryDir, 'registry.json')), 'Full registry should exist');
    assert.ok(existsSync(join(registryDir, 'agents.json')), 'Agent registry should exist');
    assert.ok(existsSync(join(registryDir, 'skills.json')), 'Skill registry should exist');
    assert.ok(existsSync(join(registryDir, 'plugins.json')), 'Plugin registry should exist');
    assert.ok(existsSync(join(registryDir, 'routing.json')), 'Routing registry should exist');
  });

  await t.test('sdlc_build_next enforces human approval gates', async () => {
    const res = await mockPi.tools.sdlc_build_next.execute('3b', { run_id: runId });
    assert.ok(res.content[0].text.includes('Approval gate blocked'));
    assert.deepEqual(res.details.missing_approvals, ['plan.md']);
  });

  await t.test('sdlc_spec can read and update artifacts', async () => {
    // Read
    const readRes = await mockPi.tools.sdlc_spec.execute('4', {
      run_id: runId,
      artifact: 'product-brief.md',
      action: 'read'
    });
    assert.ok(readRes.content[0].text.includes('RStack Spec: Product clarification'));

    // Update
    const newContent = '# Updated Product Brief\nUsers want weather data.';
    await mockPi.tools.sdlc_spec.execute('5', {
      run_id: runId,
      artifact: 'product-brief.md',
      action: 'update',
      content: newContent,
      trace_mapping: { requirement_id: 'REQ-1' }
    });

    const verifyContent = readFileSync(join(projectRoot, '.rstack', 'runs', runId, 'specs', 'product-brief.md'), 'utf8');
    assert.strictEqual(verifyContent, newContent);

    // Verify Traceability
    const trace = JSON.parse(readFileSync(join(projectRoot, '.rstack', 'runs', runId, 'traceability.json'), 'utf8'));
    const mapping = trace.mappings.find(m => m.type === 'spec_update' && m.artifact === 'product-brief.md');
    assert.ok(mapping, 'Traceability mapping should exist');
    assert.strictEqual(mapping.requirement_id, 'REQ-1');
  });

  await t.test('sdlc_approve records human gates', async () => {
    await mockPi.tools.sdlc_approve.execute('6', {
      run_id: runId,
      artifact: 'product-brief.md',
      status: 'APPROVED',
      comments: 'Looks good'
    });

    const approvals = JSON.parse(readFileSync(join(projectRoot, '.rstack', 'runs', runId, 'approvals.json'), 'utf8'));
    assert.strictEqual(approvals[0].artifact, 'product-brief.md');
    assert.strictEqual(approvals[0].status, 'APPROVED');

    const trace = JSON.parse(readFileSync(join(projectRoot, '.rstack', 'runs', runId, 'traceability.json'), 'utf8'));
    assert.ok(trace.mappings.some(m => m.type === 'approval' && m.artifact === 'product-brief.md'));
  });

  // Cleanup
  rmSync(projectRoot, { recursive: true, force: true });
});
