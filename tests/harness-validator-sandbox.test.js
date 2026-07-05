import test from 'node:test';
import assert from 'node:assert/strict';
import {
  VALIDATOR_CONTEXT_ENV,
  VALIDATOR_RUN_ID_ENV,
  VALIDATOR_SANDBOX_DEBUG_ENV,
  VALIDATOR_READ_ONLY_TOOLS,
  VALIDATOR_DENIED_TOOLS,
  VALIDATOR_DENIED_COMMAND_RULES,
  isValidatorRole,
  isValidatorContext,
  isValidatorSandboxDebug,
  isValidatorDeniedTool,
  isValidatorDeniedCommand,
  matchValidatorDeniedCommand,
  evaluateValidatorAction,
} from '../src/core/harness/validator-sandbox.js';

test('validator sandbox constants are frozen and coherent', () => {
  assert.ok(Object.isFrozen(VALIDATOR_READ_ONLY_TOOLS));
  assert.ok(Object.isFrozen(VALIDATOR_DENIED_TOOLS));
  assert.ok(Object.isFrozen(VALIDATOR_DENIED_COMMAND_RULES));
  assert.equal(VALIDATOR_CONTEXT_ENV, 'RSTACK_VALIDATOR_CONTEXT');
  assert.equal(VALIDATOR_RUN_ID_ENV, 'RSTACK_VALIDATOR_RUN_ID');
  assert.equal(VALIDATOR_SANDBOX_DEBUG_ENV, 'RSTACK_VALIDATOR_SANDBOX_DEBUG');

  // The read-only set keeps bash (validators must run tests) but never
  // overlaps the denied write/edit tool list.
  assert.ok(VALIDATOR_READ_ONLY_TOOLS.includes('bash'));
  assert.ok(VALIDATOR_READ_ONLY_TOOLS.includes('read'));
  for (const tool of VALIDATOR_READ_ONLY_TOOLS) {
    assert.ok(!VALIDATOR_DENIED_TOOLS.includes(tool), `${tool} must not be denied`);
  }
});

test('isValidatorRole matches validator/reviewer/security style names and ids', () => {
  for (const name of ['validator', 'code-validator', 'architect-reviewer', 'security-auditor', '12-security-threat-model', 'qa-expert', 'tester', 'agent.validator']) {
    assert.ok(isValidatorRole(name), `${name} should be validator role`);
  }
  for (const name of ['builder', 'orchestrator', '07-code', 'frontend-developer', 'planning', '', undefined]) {
    assert.ok(!isValidatorRole(name), `${name} should NOT be validator role`);
  }
});

test('isValidatorContext and debug flag read explicit env objects', () => {
  assert.equal(isValidatorContext({ [VALIDATOR_CONTEXT_ENV]: '1' }), true);
  assert.equal(isValidatorContext({ [VALIDATOR_CONTEXT_ENV]: '0' }), false);
  assert.equal(isValidatorContext({ [VALIDATOR_CONTEXT_ENV]: 'true' }), false);
  assert.equal(isValidatorContext({}), false);
  assert.equal(isValidatorSandboxDebug({ [VALIDATOR_SANDBOX_DEBUG_ENV]: '1' }), true);
  assert.equal(isValidatorSandboxDebug({}), false);
});

test('write/edit style tools are denied; read style tools are not', () => {
  for (const tool of ['write', 'edit', 'Write', 'EDIT', 'multi_edit', 'notebook_edit', 'apply_patch', 'str_replace', 'create_file', 'delete_file']) {
    assert.ok(isValidatorDeniedTool(tool), `${tool} should be denied`);
  }
  for (const tool of ['read', 'grep', 'find', 'ls', 'bash', '', undefined]) {
    assert.ok(!isValidatorDeniedTool(tool), `${tool} should not be denied`);
  }
});

test('destructive, publish/deploy, git-mutation, and secret-write commands are denied', () => {
  const denied = [
    ['rm -rf /tmp/build', 'destructive-shell'],
    ['rm out.log', 'destructive-shell'],
    ['mv src/a.js src/b.js', 'destructive-shell'],
    ['chmod 777 script.sh', 'destructive-shell'],
    ['dd if=/dev/zero of=/dev/sda', 'destructive-shell'],
    ["sed -i 's/a/b/' src/app.js", 'in-place-edit'],
    ['npm test | tee results.txt', 'in-place-edit'],
    ['git push --force origin main', 'git-mutation'],
    ['git push origin feature', 'git-mutation'],
    ['git commit -m "sneaky fix"', 'git-mutation'],
    ['git reset --hard HEAD~1', 'git-mutation'],
    ['git checkout main', 'git-mutation'],
    ['npm publish --access public', 'publish-deploy'],
    ['npm version patch', 'publish-deploy'],
    ['terraform apply -auto-approve', 'publish-deploy'],
    ['terraform destroy', 'publish-deploy'],
    ['kubectl delete pod api-0', 'publish-deploy'],
    ['helm upgrade api ./chart', 'publish-deploy'],
    ['docker push registry/app:latest', 'publish-deploy'],
    ['gh pr merge 42', 'publish-deploy'],
    ['firebase deploy', 'publish-deploy'],
    ['psql -c "DROP TABLE users;"', 'sql-mutation'],
    ['mysql -e "DELETE FROM orders"', 'sql-mutation'],
    ['echo "API_KEY=x" > .env', 'secret-path-write'],
    ['echo token >> config/credentials.json', 'secret-path-write'],
  ];
  for (const [command, expectedRule] of denied) {
    const rule = matchValidatorDeniedCommand(command);
    assert.ok(rule, `should deny: ${command}`);
    assert.equal(rule.id, expectedRule, `${command} should match ${expectedRule}, got ${rule.id}`);
    assert.ok(isValidatorDeniedCommand(command));
  }
});

test('read-only shell commands are allowed', () => {
  const allowed = [
    'git status',
    'git diff --stat',
    'git log --oneline -5',
    'ls -la src/',
    'grep -n "export" src/core/harness/guardrails.js',
    'cat package.json',
    'npm test',
    'npx tsx --test tests/harness.test.js',
    'node scripts/security-audit.mjs',
    'cat .env',
    'npm test > /tmp/test-output.log 2>&1',
    'wc -l src/index.js',
  ];
  for (const command of allowed) {
    assert.equal(matchValidatorDeniedCommand(command), null, `should allow: ${command}`);
    assert.equal(isValidatorDeniedCommand(command), false);
  }
  // Non-strings and empty commands are tolerated, never denied.
  assert.equal(matchValidatorDeniedCommand(undefined), null);
  assert.equal(matchValidatorDeniedCommand(42), null);
  assert.equal(matchValidatorDeniedCommand('   '), null);
});

test('evaluateValidatorAction returns {allowed, reason} verdicts', () => {
  const write = evaluateValidatorAction({ toolName: 'write', input: { path: 'src/app.js', content: 'x' } });
  assert.equal(write.allowed, false);
  assert.match(write.reason, /read-only/);
  assert.match(write.reason, /'write'/);

  const bashDenied = evaluateValidatorAction({ toolName: 'bash', input: { command: 'rm -rf node_modules' } });
  assert.equal(bashDenied.allowed, false);
  assert.match(bashDenied.reason, /destructive/);

  const bashAllowed = evaluateValidatorAction({ toolName: 'bash', input: { command: 'git status' } });
  assert.deepEqual(bashAllowed, { allowed: true, reason: null });

  const read = evaluateValidatorAction({ toolName: 'read', input: { path: '.env' } });
  assert.equal(read.allowed, true);

  // Malformed inputs never throw and never deny.
  assert.equal(evaluateValidatorAction({}).allowed, true);
  assert.equal(evaluateValidatorAction().allowed, true);
  assert.equal(evaluateValidatorAction({ toolName: 'bash', input: { command: 12 } }).allowed, true);
});
