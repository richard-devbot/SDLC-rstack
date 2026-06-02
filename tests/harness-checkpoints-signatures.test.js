import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStageCheckpoint, rollbackStage } from '../src/core/harness/run-state.js';
import { calculateEpisodeSignature, verifyEpisodeSignature, appendEpisode, readEpisodes } from '../src/memory/index.js';
import extension from '../extensions/rstack-sdlc.ts';

// Mock Pi API
const mockPi = {
  tools: {},
  commands: {},
  registerTool(tool) {
    this.tools[tool.name] = tool;
  },
  registerCommand(name, command) {
    this.commands[name] = command;
  },
  on() {},
  ui: {
    notify() {},
  },
};

test('RStack Checkpoints, Signatures, & Model Escalation E2E', async (t) => {
  const projectRoot = mkdtempSync(join(tmpdir(), 'rstack-cp-sig-'));
  
  // Isolate state and memory environment
  const previousProjectRoot = process.env.RSTACK_PROJECT_ROOT;
  const previousStateDir = process.env.RSTACK_STATE_DIR;
  const previousMemoryDir = process.env.RSTACK_MEMORY_DIR;
  
  process.env.RSTACK_PROJECT_ROOT = projectRoot;
  delete process.env.RSTACK_STATE_DIR;
  delete process.env.RSTACK_MEMORY_DIR;

  // Initialize extension
  extension(mockPi);

  await t.test('Stage Checkpoint & Rollback', async () => {
    const runDir = join(projectRoot, '.rstack', 'runs', '00-test-run');
    const stageId = '07-code';
    const stageFolder = join(runDir, 'artifacts', 'stages', stageId);
    
    // Prepare stage directory structure
    mkdirSync(stageFolder, { recursive: true });
    writeFileSync(join(stageFolder, 'code.js'), 'console.log("hello");');
    
    // Create stage checkpoint
    const cpCreated = await createStageCheckpoint(runDir, stageId);
    assert.ok(cpCreated);
    assert.ok(existsSync(join(runDir, 'checkpoints', stageId, 'code.js')));
    
    // Modify stage folder files
    writeFileSync(join(stageFolder, 'code.js'), 'console.log("tampered");');
    
    // Rollback stage folder from checkpoint
    const cpRestored = await rollbackStage(runDir, stageId);
    assert.ok(cpRestored);
    assert.equal(readFileSync(join(stageFolder, 'code.js'), 'utf8'), 'console.log("hello");');
    
    // Cleanup 00-test-run to keep registry clean
    rmSync(runDir, { recursive: true, force: true });
  });

  await t.test('BFT Memory Signatures and verification', async () => {
    const memoryDir = join(projectRoot, 'memory');
    
    const mockEpisode = {
      episode_id: 'ep_test-run_07-code',
      project_slug: 'rstack-cp-sig',
      run_id: 'test-run',
      task_id: '07-code',
      task: 'Build code stage',
      outcome: 'PASS',
      validator_status: 'PASS',
      quality_score: 0.9,
      created_at: new Date().toISOString(),
      evidence_paths: ['validation.json'],
    };

    // Calculate signature
    const signature = calculateEpisodeSignature(mockEpisode);
    assert.ok(signature);

    mockEpisode.signature = signature;
    assert.ok(verifyEpisodeSignature(mockEpisode));

    // Append signed episode
    await appendEpisode(memoryDir, mockEpisode);
    
    // Retrieve signed episode
    const episodes = await readEpisodes(memoryDir);
    assert.equal(episodes.length, 1);
    assert.equal(episodes[0].signature, signature);

    // Tamper episode signature
    episodes[0].signature = 'tampered-signature-hex-1234';
    assert.equal(verifyEpisodeSignature(episodes[0]), false);
  });

  await t.test('Model Escalation Routing (Attempts >= 2)', async () => {
    const result = await mockPi.tools.sdlc_start.execute('1', { goal: 'Test dynamic escalation' });
    const runId = result.details.run_id;

    // Simulate task failed check: run started, environment started once
    const runDir = join(projectRoot, '.rstack', 'runs', runId);
    const eventsPath = join(runDir, 'events.jsonl');
    
    const mockEvents = [
      { ts: new Date().toISOString(), type: 'run_started', goal: 'Test dynamic escalation' },
      { ts: new Date().toISOString(), type: 'task_started', task_id: '00-environment' },
      { ts: new Date().toISOString(), type: 'task_started', task_id: '00-environment' }, // Second attempt!
    ];

    const fs = await import('node:fs/promises');
    await fs.writeFile(eventsPath, mockEvents.map(e => JSON.stringify(e)).join('\n') + '\n');

    // Run sdlc_delegate or standard builder prep and check escalated model
    const registry = [
      { id: 'agent.00-environment', name: 'agent.00-environment', kind: 'agent', path: 'agents/00-environment.md', domains: ['env'], stageAffinity: [] }
    ];
    
    // Create mock agent file
    const agentDir = join(projectRoot, 'agents');
    mkdirSync(agentDir, { recursive: true });
    writeFileSync(join(projectRoot, 'agents/00-environment.md'), '# Mock Agent Context');

    // Override process env to escalate to gemini-2.5-pro on attempts >= 2
    process.env.RSTACK_ESCALATED_MODEL = 'gemini-2.5-pro-escalated';

    const res = await mockPi.tools.sdlc_delegate.execute('2', {
      agent: 'agent.00-environment',
      task: 'Check environment setup',
    });
    
    // We inspect events.jsonl to verify model_escalated was appended
    const updatedEvents = (await fs.readFile(eventsPath, 'utf8'))
      .split('\n')
      .filter(Boolean)
      .map(line => JSON.parse(line));
      
    const escalationEvent = updatedEvents.find(e => e.type === 'model_escalated');
    assert.ok(escalationEvent);
    assert.equal(escalationEvent.model, 'gemini-2.5-pro-escalated');
    assert.equal(escalationEvent.task_id, '00-environment');
  });

  // Cleanup
  rmSync(projectRoot, { recursive: true, force: true });
  
  // Restore environments
  if (previousProjectRoot) process.env.RSTACK_PROJECT_ROOT = previousProjectRoot;
  else delete process.env.RSTACK_PROJECT_ROOT;
  
  if (previousStateDir) process.env.RSTACK_STATE_DIR = previousStateDir;
  else delete process.env.RSTACK_STATE_DIR;

  if (previousMemoryDir) process.env.RSTACK_MEMORY_DIR = previousMemoryDir;
  else delete process.env.RSTACK_MEMORY_DIR;
});
