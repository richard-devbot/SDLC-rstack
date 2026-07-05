// owner: RStack developed by Richardson Gunde
//
// Validator sandbox policy (#119): validators check work, they never modify it.
// This module is the pure classification layer — host integrations (the Pi
// extension's tool_call hook) only wire it. It is deliberately self-contained:
// the Pi extension has its own builder-oriented `isDestructiveBash` /
// `protectedWritePath` classifiers, but those encode "dangerous for anyone"
// rules with an approval escape hatch. The validator sandbox is stricter
// (any mutation is denied, no approval path), so it keeps its own
// conservative lists instead of importing the extension's.

// Env var set by the delegate layer on validator/reviewer/security
// subprocesses. The tool_call hook reads it inside the child process.
export const VALIDATOR_CONTEXT_ENV = 'RSTACK_VALIDATOR_CONTEXT';

// Optional: run id stamped by the delegate layer so sandbox denials in a
// child process (which has no session run of its own) can still be evented
// into the owning run's events.jsonl.
export const VALIDATOR_RUN_ID_ENV = 'RSTACK_VALIDATOR_RUN_ID';

// Optional debug flag: when '1', allowed reads may be logged as
// `validator_sandbox_allowed_read`. Off by default — logging every read
// would flood events.jsonl.
export const VALIDATOR_SANDBOX_DEBUG_ENV = 'RSTACK_VALIDATOR_SANDBOX_DEBUG';

// Agent names/ids that put a delegated subprocess into validator context.
// Matches the roles that already default to read-only tool sets in
// sdlc_delegate ('architect-reviewer' is covered by 'review').
export const VALIDATOR_ROLE_PATTERN = /(validator|review|qa|security|audit|tester)/i;

// Default tool set for validator-role delegations. bash stays in the set —
// validators must run tests and inspection commands — but mutating bash
// commands are denied at command level by VALIDATOR_DENIED_COMMAND_RULES.
export const VALIDATOR_READ_ONLY_TOOLS = Object.freeze(['read', 'grep', 'find', 'ls', 'bash']);

// Tools that can modify the workspace. Includes defensive aliases for
// write/edit-style tools beyond Pi's core set.
export const VALIDATOR_DENIED_TOOLS = Object.freeze([
  'write',
  'edit',
  'multi_edit',
  'notebook_edit',
  'apply_patch',
  'str_replace',
  'str_replace_editor',
  'create_file',
  'delete_file',
  'move_file',
  'rename_file',
]);

// Denied bash command classes. Conservative on purpose: a validator that is
// over-blocked reports a blocker; a validator that mutates the workspace
// corrupts the loop. No approval/override path exists by design (#119).
export const VALIDATOR_DENIED_COMMAND_RULES = Object.freeze([
  Object.freeze({
    id: 'destructive-shell',
    pattern: /\b(rm|rmdir|mv|shred|mkfs\w*|truncate|chmod|chown)\b|\bdd\b[^|;&]*\bof=/i,
    reason: 'destructive or file-mutating shell command',
  }),
  Object.freeze({
    id: 'in-place-edit',
    pattern: /\bsed\s+(-\S*i|--in-place)\b|\bperl\s+-\S*i\b|\btee\b/i,
    reason: 'in-place file edit via shell',
  }),
  Object.freeze({
    id: 'git-mutation',
    pattern: /\bgit\s+(push|commit|merge|rebase|reset|clean|checkout|restore|stash|apply|am|cherry-pick|revert|rm|mv|branch\s+-[dD]|tag\s+-d)\b/i,
    reason: 'git command that mutates history or the working tree',
  }),
  Object.freeze({
    id: 'publish-deploy',
    pattern: /\b(npm\s+(publish|unpublish|version)|yarn\s+publish|pnpm\s+publish|cargo\s+publish|gem\s+push|twine\s+upload|terraform\s+(apply|destroy)|pulumi\s+(up|destroy)|kubectl\s+(apply|delete|replace|patch|scale|drain|cordon)|helm\s+(install|upgrade|uninstall|rollback|delete)|docker\s+(push|rm|rmi|compose\s+down)|gh\s+(release|pr\s+merge)|aws\s+cloudformation\s+(create|update|delete)-stack|aws\s+s3\s+(cp|sync|rm|rb|mb)|gcloud\s+\S*\s*deploy|firebase\s+deploy|vercel\s+(deploy|--prod)|netlify\s+deploy|flyctl?\s+deploy|(sls|serverless)\s+deploy)\b/i,
    reason: 'publish, deploy, or force-push class command',
  }),
  Object.freeze({
    id: 'sql-mutation',
    pattern: /\b(DROP\s+TABLE|DELETE\s+FROM|TRUNCATE\s+TABLE)\b/i,
    reason: 'destructive SQL statement',
  }),
  Object.freeze({
    id: 'secret-path-write',
    pattern: />>?\s*(\S*\/)?(\.env(\.\S+)?|id_rsa|id_ed25519|secrets?\.\S+|credentials\.\S+|\.npmrc|\.pypirc)\b/i,
    reason: 'shell redirect into a protected secret or credential path',
  }),
]);

export function isValidatorRole(nameOrId) {
  return VALIDATOR_ROLE_PATTERN.test(String(nameOrId || ''));
}

export function isValidatorContext(env = process.env) {
  return env?.[VALIDATOR_CONTEXT_ENV] === '1';
}

export function isValidatorSandboxDebug(env = process.env) {
  return env?.[VALIDATOR_SANDBOX_DEBUG_ENV] === '1';
}

export function isValidatorDeniedTool(toolName) {
  return VALIDATOR_DENIED_TOOLS.includes(String(toolName || '').toLowerCase());
}

export function matchValidatorDeniedCommand(command) {
  if (typeof command !== 'string' || !command.trim()) return null;
  for (const rule of VALIDATOR_DENIED_COMMAND_RULES) {
    if (rule.pattern.test(command)) return rule;
  }
  return null;
}

export function isValidatorDeniedCommand(command) {
  return matchValidatorDeniedCommand(command) !== null;
}

// Single decision point the host hook calls for every tool_call in validator
// context. Returns { allowed, reason }; reason is null when allowed.
export function evaluateValidatorAction({ toolName, input } = {}) {
  const tool = String(toolName || '').toLowerCase();
  if (isValidatorDeniedTool(tool)) {
    return { allowed: false, reason: `validator context is read-only: tool '${tool}' modifies the workspace` };
  }
  if (tool === 'bash' && typeof input?.command === 'string') {
    const rule = matchValidatorDeniedCommand(input.command);
    if (rule) {
      return { allowed: false, reason: `validator context is read-only: ${rule.reason} (rule: ${rule.id})` };
    }
  }
  return { allowed: true, reason: null };
}
