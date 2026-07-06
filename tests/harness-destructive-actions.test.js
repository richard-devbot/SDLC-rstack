import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DESTRUCTIVE_CATEGORIES,
  classifyCommand,
  classifyWritePath,
  classifyDestructiveAction,
  isDestructiveAction,
  destructiveApprovalArtifact,
  requireApprovalForDestructiveAction,
} from '../src/core/harness/destructive-actions.js';
import { evaluateDestructiveAction } from '../src/core/harness/guardrails.js';

// --- each destructive category is classified correctly ---------------------

test('broad-delete: recursive/forced rm and filesystem nukes', () => {
  for (const cmd of ['rm -rf /tmp/x', 'rm -r build', 'rm -f node_modules/.cache', 'rm --recursive dist', 'rmdir olddir', 'shred secret', 'mkfs.ext4 /dev/sdb', 'dd if=/dev/zero of=/dev/sda', 'find . -name "*.log" -delete']) {
    const v = classifyCommand(cmd);
    assert.equal(v.destructive, true, `expected destructive: ${cmd}`);
    assert.equal(v.category, DESTRUCTIVE_CATEGORIES.BROAD_DELETE, `category for: ${cmd}`);
  }
});

test('git-force: force-push and hard reset', () => {
  for (const cmd of ['git push --force origin main', 'git push -f', 'git push --force-with-lease', 'git reset --hard HEAD~3', 'git push origin +main']) {
    const v = classifyCommand(cmd);
    assert.equal(v.destructive, true, `expected destructive: ${cmd}`);
    assert.equal(v.category, DESTRUCTIVE_CATEGORIES.GIT_FORCE, `category for: ${cmd}`);
  }
});

test('publish: package/release publish', () => {
  for (const cmd of ['npm publish', 'yarn publish', 'pnpm publish', 'npm unpublish foo', 'cargo publish', 'gem push pkg.gem', 'twine upload dist/*', 'gh release create v1.0']) {
    const v = classifyCommand(cmd);
    assert.equal(v.destructive, true, `expected destructive: ${cmd}`);
    assert.equal(v.category, DESTRUCTIVE_CATEGORIES.PUBLISH, `category for: ${cmd}`);
  }
});

test('deploy: apply/destroy/deploy across infra tools', () => {
  for (const cmd of ['terraform apply', 'terraform destroy', 'pulumi up', 'pulumi destroy', 'kubectl apply -f x.yaml', 'kubectl delete pod x', 'helm upgrade rel chart', 'docker push repo/img', 'aws cloudformation delete-stack --stack-name s', 'firebase deploy', 'vercel deploy', 'netlify deploy', 'fly deploy', 'serverless deploy', 'ansible-playbook site.yml']) {
    const v = classifyCommand(cmd);
    assert.equal(v.destructive, true, `expected destructive: ${cmd}`);
    assert.equal(v.category, DESTRUCTIVE_CATEGORIES.DEPLOY, `category for: ${cmd}`);
  }
});

test('db-destroy: destructive SQL', () => {
  for (const cmd of ['psql -c "DROP TABLE users"', 'DROP DATABASE prod', 'DELETE FROM accounts', 'TRUNCATE TABLE logs', 'TRUNCATE sessions']) {
    const v = classifyCommand(cmd);
    assert.equal(v.destructive, true, `expected destructive: ${cmd}`);
    assert.equal(v.category, DESTRUCTIVE_CATEGORIES.DB_DESTROY, `category for: ${cmd}`);
  }
});

test('secret-write: shell redirect/tee into secret paths', () => {
  for (const cmd of ['echo TOKEN=x >> .env', 'cat k > config/.env.production', 'echo x > id_rsa', 'echo pw > server.pem', 'echo x | tee credentials.json']) {
    const v = classifyCommand(cmd);
    assert.equal(v.destructive, true, `expected destructive: ${cmd}`);
    assert.equal(v.category, DESTRUCTIVE_CATEGORIES.SECRET_WRITE, `category for: ${cmd}`);
  }
});

// --- safe commands are NOT flagged -----------------------------------------

test('safe commands are not flagged', () => {
  for (const cmd of ['ls -la', 'rm file.txt', 'git status', 'git push origin main', 'git commit -m "x"', 'npm test', 'npm run build', 'cat README.md', 'grep foo src/', 'echo hello', 'node script.js', 'kubectl get pods', 'docker build .', 'git log --oneline']) {
    const v = classifyCommand(cmd);
    assert.equal(v.destructive, false, `expected safe: ${cmd} — got ${v.category}`);
    assert.equal(v.category, null);
  }
});

// --- write-path classification ---------------------------------------------

test('write paths: secrets/keys vs protected config vs safe', () => {
  assert.equal(classifyWritePath('.env').category, DESTRUCTIVE_CATEGORIES.SECRET_WRITE);
  assert.equal(classifyWritePath('config/.env.production').category, DESTRUCTIVE_CATEGORIES.SECRET_WRITE);
  assert.equal(classifyWritePath('deploy/keys/server.pem').category, DESTRUCTIVE_CATEGORIES.SECRET_WRITE);
  assert.equal(classifyWritePath('.ssh/id_ed25519').category, DESTRUCTIVE_CATEGORIES.SECRET_WRITE);
  assert.equal(classifyWritePath('credentials.json').category, DESTRUCTIVE_CATEGORIES.SECRET_WRITE);

  assert.equal(classifyWritePath('.github/workflows/ci.yml').category, DESTRUCTIVE_CATEGORIES.PROTECTED_CONFIG_WRITE);
  assert.equal(classifyWritePath('Dockerfile').category, DESTRUCTIVE_CATEGORIES.PROTECTED_CONFIG_WRITE);
  assert.equal(classifyWritePath('infra/main.tf').category, DESTRUCTIVE_CATEGORIES.PROTECTED_CONFIG_WRITE);
  assert.equal(classifyWritePath('package-lock.json').category, DESTRUCTIVE_CATEGORIES.PROTECTED_CONFIG_WRITE);

  assert.equal(classifyWritePath('src/app.js').destructive, false);
  assert.equal(classifyWritePath('docs/readme.md').destructive, false);
  assert.equal(classifyWritePath('environment.js').destructive, false); // not .env
});

// --- unified entry point + tool_call shapes --------------------------------

test('classifyDestructiveAction accepts string, {command}, and tool_call shapes', () => {
  assert.equal(classifyDestructiveAction('rm -rf x').category, DESTRUCTIVE_CATEGORIES.BROAD_DELETE);
  assert.equal(classifyDestructiveAction({ command: 'npm publish' }).category, DESTRUCTIVE_CATEGORIES.PUBLISH);
  assert.equal(classifyDestructiveAction({ toolName: 'bash', input: { command: 'terraform apply' } }).category, DESTRUCTIVE_CATEGORIES.DEPLOY);
  assert.equal(classifyDestructiveAction({ toolName: 'write', input: { file_path: '.env' } }).category, DESTRUCTIVE_CATEGORIES.SECRET_WRITE);
  assert.equal(classifyDestructiveAction({ toolName: 'edit', input: { file_path: 'src/app.js' } }).destructive, false);
  // unknown tool with nothing to classify is not-destructive here
  assert.equal(classifyDestructiveAction({ toolName: 'read', input: { file_path: '.env' } }).destructive, false);
  // junk input
  assert.equal(classifyDestructiveAction(null).destructive, false);
  assert.equal(classifyDestructiveAction(42).destructive, false);
  assert.equal(classifyDestructiveAction('').destructive, false);
  assert.equal(isDestructiveAction('rm -rf /'), true);
  assert.equal(isDestructiveAction('ls'), false);
});

// --- approval requirement (pure gate) --------------------------------------

test('destructive action blocked without approval, allowed with it', () => {
  const artifact = destructiveApprovalArtifact('004-impl');
  assert.equal(artifact, 'destructive-action:004-impl');

  const blocked = requireApprovalForDestructiveAction({ action: 'rm -rf build', taskId: '004-impl', approvedArtifacts: new Set() });
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.requiresApproval, true);
  assert.equal(blocked.approval_artifact, artifact);
  assert.match(blocked.reason, /requires approval/);

  const allowed = requireApprovalForDestructiveAction({ action: 'rm -rf build', taskId: '004-impl', approvedArtifacts: new Set([artifact]) });
  assert.equal(allowed.allowed, true);
  assert.equal(allowed.requiresApproval, true);

  // a safe action never requires approval
  const safe = requireApprovalForDestructiveAction({ action: 'npm test', taskId: '004-impl', approvedArtifacts: new Set() });
  assert.equal(safe.allowed, true);
  assert.equal(safe.requiresApproval, false);

  // array form of approvedArtifacts also honored
  const arrForm = requireApprovalForDestructiveAction({ action: 'npm publish', taskId: 't1', approvedArtifacts: ['destructive-action:t1'] });
  assert.equal(arrForm.allowed, true);
});

// --- approval requirement wired through the audited approval path ----------

function approvedRecord(artifact, runId) {
  return {
    id: `rec-${artifact}`,
    artifact,
    status: 'APPROVED',
    approver: 'richardson',
    timestamp: new Date().toISOString(),
    run_id: runId,
  };
}

test('evaluateDestructiveAction gates against audited run approvals', () => {
  const runId = 'run-2026';
  const artifact = destructiveApprovalArtifact('deploy-task');

  // no approvals → destructive deploy blocked
  const blocked = evaluateDestructiveAction({ action: 'terraform destroy', taskId: 'deploy-task', approvals: [], expectedRunId: runId });
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.verdict.category, DESTRUCTIVE_CATEGORIES.DEPLOY);

  // valid audited APPROVED record for the right artifact + run → allowed
  const allowed = evaluateDestructiveAction({
    action: 'terraform destroy',
    taskId: 'deploy-task',
    approvals: [approvedRecord(artifact, runId)],
    expectedRunId: runId,
  });
  assert.equal(allowed.allowed, true);

  // a record bound to a DIFFERENT run must not unblock (cross-run replay)
  const foreign = evaluateDestructiveAction({
    action: 'terraform destroy',
    taskId: 'deploy-task',
    approvals: [approvedRecord(artifact, 'some-other-run')],
    expectedRunId: runId,
  });
  assert.equal(foreign.allowed, false, 'foreign-run approval must not unblock');

  // safe action passes with no approval regardless
  const safe = evaluateDestructiveAction({ action: 'npm test', taskId: 'deploy-task', approvals: [], expectedRunId: runId });
  assert.equal(safe.allowed, true);
  assert.equal(safe.requiresApproval, false);
});
