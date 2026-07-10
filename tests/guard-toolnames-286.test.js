import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyDestructiveAction, classifyCommand } from '../src/core/harness/destructive-actions.js';
import { isValidatorDeniedTool, matchValidatorDeniedCommand } from '../src/core/harness/validator-sandbox.js';
import { buildClaudeCodeHooks } from '../src/integrations/init.js';

// owner: RStack developed by Richardson Gunde
//
// #286: the security-side matchers encoded Claude Code's PascalCase tool
// names as snake_case, so MultiEdit/NotebookEdit escaped the destructive
// classifier AND the validator sandbox, the init guard matcher never fired
// for MultiEdit at all, and there was no PowerShell/cmd destructive grammar.
// These pins cover every spelling a host actually sends.

test('classifier catches every spelling of the write tools (#286)', async (t) => {
  await t.test('PascalCase MultiEdit secret write is destructive', () => {
    const v = classifyDestructiveAction({ toolName: 'MultiEdit', input: { file_path: '.env', edits: [] } });
    assert.equal(v.destructive, true);
    assert.equal(v.category, 'secret-write');
  });

  await t.test('snake_case multi_edit (Pi form) still classifies', () => {
    const v = classifyDestructiveAction({ toolName: 'multi_edit', input: { file_path: 'config/.env.production' } });
    assert.equal(v.destructive, true);
  });

  await t.test('NotebookEdit is classified AND its notebook_path target is read', () => {
    const v = classifyDestructiveAction({ toolName: 'NotebookEdit', input: { notebook_path: 'secrets.ipynb.key' } });
    assert.equal(v.destructive, true, 'notebook_path must reach classifyWritePath');
  });

  await t.test('safe writes stay safe in every spelling', () => {
    assert.equal(classifyDestructiveAction({ toolName: 'MultiEdit', input: { file_path: 'src/app.js' } }).destructive, false);
    assert.equal(classifyDestructiveAction({ toolName: 'NotebookEdit', input: { notebook_path: 'analysis.ipynb' } }).destructive, false);
  });
});

test('PowerShell/cmd destructive grammar (#286)', async (t) => {
  await t.test('recursive/forced deletes are destructive, case-insensitive', () => {
    for (const cmd of [
      'Remove-Item -Recurse -Force C:\\tmp\\x',
      'remove-item -force build',
      'REMOVE-ITEM -Recurse out',
      'rd /s /q dist',
      'del /f /q *.log',
    ]) {
      const v = classifyCommand(cmd);
      assert.equal(v.destructive, true, `${cmd} must classify destructive`);
      assert.equal(v.category, 'broad-delete');
    }
  });

  await t.test('single-target deletes stay ordinary work (no false positives)', () => {
    for (const cmd of ['Remove-Item file.txt', 'del file.txt', 'Get-ChildItem -Recurse', 'model.predict(x)']) {
      assert.equal(classifyCommand(cmd).destructive, false, `${cmd} must stay safe`);
    }
  });

  await t.test('content cmdlets writing secret paths are secret-write', () => {
    for (const cmd of [
      'Set-Content -Path .env -Value "API_KEY=x"',
      'Out-File -FilePath secrets.json',
      'Add-Content credentials.yaml -Value token',
    ]) {
      const v = classifyCommand(cmd);
      assert.equal(v.destructive, true, `${cmd} must classify destructive`);
      assert.equal(v.category, 'secret-write');
    }
    assert.equal(classifyCommand('Set-Content -Path notes.txt -Value hello').destructive, false);
  });
});

test('validator sandbox denies every spelling and PowerShell mutation (#286)', async (t) => {
  await t.test('denied tools match PascalCase and snake_case alike', () => {
    for (const name of ['MultiEdit', 'multi_edit', 'NotebookEdit', 'notebook_edit', 'Write', 'Edit']) {
      assert.equal(isValidatorDeniedTool(name), true, `${name} must be denied in validator context`);
    }
    assert.equal(isValidatorDeniedTool('Read'), false);
    assert.equal(isValidatorDeniedTool('Grep'), false);
  });

  await t.test('PowerShell mutation commands are denied outright (stricter than builder gate)', () => {
    assert.equal(matchValidatorDeniedCommand('Remove-Item file.txt')?.id, 'destructive-shell-windows');
    assert.equal(matchValidatorDeniedCommand('Move-Item a b')?.id, 'destructive-shell-windows');
    assert.equal(matchValidatorDeniedCommand('Set-Content -Path out.txt -Value x')?.id, 'in-place-edit');
    assert.equal(matchValidatorDeniedCommand('Get-Content package.json'), null, 'reads stay allowed');
  });
});

test('init wires MultiEdit/NotebookEdit into the enforcement matchers (#286)', () => {
  const hooks = buildClaudeCodeHooks();
  const guardMatcher = hooks.hooks.PreToolUse[0].matcher;
  for (const tool of ['Bash', 'Write', 'Edit', 'MultiEdit', 'NotebookEdit']) {
    assert.ok(guardMatcher.split('|').includes(tool), `guard matcher must include ${tool}`);
  }
  assert.ok(hooks.hooks.PostToolUse[0].matcher.split('|').includes('MultiEdit'), 'observe matcher must include MultiEdit');
  assert.ok(hooks.hooks.PostToolUseFailure[0].matcher.split('|').includes('NotebookEdit'), 'failure observe matcher must include NotebookEdit');
});
