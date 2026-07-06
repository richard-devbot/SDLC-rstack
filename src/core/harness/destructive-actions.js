// owner: RStack developed by Richardson Gunde
//
// Centralized destructive-action classification (#131, BLE-5.1).
//
// Prior art (do not rebuild):
//   - validator-sandbox.js (#119) hard-blocks validator/reviewer/security
//     contexts from any mutation, with NO approval path. That module stays
//     the stricter, self-contained authority for the validator context.
//   - guardrails.js isDestructiveTask (#149/#152) is a task-flag check
//     (task.destructive === true), not a content classifier.
//
// The gap this closes: there was no single source of truth for "what makes a
// command or a write destructive" that BOTH the builder-side path and the
// validator context could consume. The builder-side classifiers historically
// lived host-side (the Pi extension's isDestructiveBash / protectedWritePath),
// so in-repo enforcement had no shared, tested definition to lean on.
//
// This module is that definition. It is pure (no I/O, no env) and returns a
// stable {destructive, category, reason, matched} verdict. Unlike the
// validator sandbox, destructive actions here are GATEABLE: a destructive
// verdict means "requires an explicit approval artifact to proceed", not
// "denied outright". Callers combine the verdict with the approval-audit path
// (#133) via requireApprovalForDestructiveAction below.

// Destructive categories. Stable ids — events, tests, and the approval
// artifact naming all key on these, so treat them as a contract.
export const DESTRUCTIVE_CATEGORIES = Object.freeze({
  BROAD_DELETE: 'broad-delete',
  GIT_FORCE: 'git-force',
  PUBLISH: 'publish',
  DEPLOY: 'deploy',
  SECRET_WRITE: 'secret-write',
  PROTECTED_CONFIG_WRITE: 'protected-config-write',
  DB_DESTROY: 'db-destroy',
});

// Command classification rules, evaluated in order; first match wins. Each
// rule is a single self-contained decision so the reason string is precise.
// Ordering matters only for reason quality (a `git push --force` should read
// as git-force, not deploy), never for the destructive/not-destructive
// outcome.
const COMMAND_RULES = Object.freeze([
  Object.freeze({
    category: DESTRUCTIVE_CATEGORIES.GIT_FORCE,
    // --force / --force-with-lease / -f on push, and history-destroying resets.
    pattern: /\bgit\s+push\b[^|;&]*(--force\b|--force-with-lease\b|\s-f\b)|\bgit\s+reset\s+--hard\b|\bgit\s+push\b[^|;&]*\+/i,
    reason: 'git force-push or hard reset can overwrite remote or local history',
  }),
  Object.freeze({
    category: DESTRUCTIVE_CATEGORIES.BROAD_DELETE,
    // rm with a recursive OR force flag (rm -rf, rm -r, rm -f), and the
    // filesystem-nuking siblings. Plain `rm file.txt` is NOT flagged — a
    // single-target delete is ordinary work; recursion/force is what escalates.
    pattern: /\brm\s+(-\S*[rRf]\S*|--recursive\b|--force\b)|\b(rmdir|shred)\b|\bmkfs\w*\b|\bdd\b[^|;&]*\bof=|\bfind\b[^|;&]*-delete\b/i,
    reason: 'recursive/forced delete or filesystem-destroying command',
  }),
  Object.freeze({
    category: DESTRUCTIVE_CATEGORIES.PUBLISH,
    pattern: /\b(npm|yarn|pnpm)\s+publish\b|\bnpm\s+unpublish\b|\bcargo\s+publish\b|\bgem\s+push\b|\btwine\s+upload\b|\bgh\s+release\s+(create|delete)\b/i,
    reason: 'package or release publish',
  }),
  Object.freeze({
    category: DESTRUCTIVE_CATEGORIES.DEPLOY,
    pattern: /\bterraform\s+(apply|destroy)\b|\bpulumi\s+(up|destroy)\b|\bkubectl\s+(apply|delete|replace|patch|scale|drain|cordon)\b|\bhelm\s+(install|upgrade|uninstall|rollback|delete)\b|\bdocker\s+(push|compose\s+down)\b|\baws\s+cloudformation\s+(create|update|delete)-stack\b|\bgcloud\s+\S*\s*deploy\b|\b(firebase|vercel|netlify)\s+deploy\b|\b(fly|flyctl)\s+deploy\b|\b(sls|serverless)\s+deploy\b|\bansible-playbook\b/i,
    reason: 'infrastructure deploy, apply, or destroy',
  }),
  Object.freeze({
    category: DESTRUCTIVE_CATEGORIES.DB_DESTROY,
    pattern: /\b(DROP\s+(TABLE|DATABASE|SCHEMA)|DELETE\s+FROM|TRUNCATE\s+(TABLE\s+)?)\b/i,
    reason: 'destructive SQL statement (drop/delete/truncate)',
  }),
  Object.freeze({
    category: DESTRUCTIVE_CATEGORIES.SECRET_WRITE,
    // Shell redirect / tee into a secret, credential, or key path.
    pattern: />>?\s*(\S*[/\\])?(\.env(\.\S+)?|\.npmrc|\.pypirc|id_rsa|id_ed25519|id_ecdsa|\S*\.pem|\S*\.key|secrets?\.\S+|credentials?(\.\S+)?)\b|\btee\b[^|;&]*(\.env|id_rsa|\.pem|\.key|secrets?|credentials?)/i,
    reason: 'shell write into a secret, credential, or key path',
  }),
]);

// Path classification. A write target (relative or absolute) that lands on a
// secret/credential/key is SECRET_WRITE; a protected build/config path is
// PROTECTED_CONFIG_WRITE. The path is matched on its basename and on notable
// segments so `config/.env.production` and `deploy/terraform/main.tf` are both
// caught regardless of leading directories.
const SECRET_PATH_PATTERN = /(^|[/\\])(\.env(\.\S+)?|\.npmrc|\.pypirc|id_rsa|id_ed25519|id_ecdsa|credentials?(\.\w+)?|secrets?(\.\w+)?)$|\.(pem|key|p12|pfx|keystore)$/i;

const PROTECTED_CONFIG_PATTERN = /(^|[/\\])(\.git[/\\]|\.github[/\\]workflows[/\\]|Dockerfile$|docker-compose\.ya?ml$|\.rstack[/\\]|package-lock\.json$|yarn\.lock$|pnpm-lock\.ya?ml$)|\.(tf|tfvars)$/i;

function notDestructive() {
  return Object.freeze({ destructive: false, category: null, reason: null, matched: null });
}

function verdict(category, reason, matched) {
  return Object.freeze({ destructive: true, category, reason, matched });
}

/**
 * Classify a shell command string. Returns a frozen verdict:
 *   { destructive, category, reason, matched }
 * `matched` is the rule category that fired (null when safe). Non-string or
 * empty input classifies as not-destructive (there is nothing to run).
 */
export function classifyCommand(command) {
  if (typeof command !== 'string' || !command.trim()) return notDestructive();
  for (const rule of COMMAND_RULES) {
    if (rule.pattern.test(command)) return verdict(rule.category, rule.reason, rule.category);
  }
  return notDestructive();
}

/**
 * Classify a write/edit target path. Returns the same verdict shape.
 * Secret/credential/key paths outrank protected-config paths.
 */
export function classifyWritePath(path) {
  if (typeof path !== 'string' || !path.trim()) return notDestructive();
  const normalized = path.trim();
  if (SECRET_PATH_PATTERN.test(normalized)) {
    return verdict(
      DESTRUCTIVE_CATEGORIES.SECRET_WRITE,
      `write to a secret, credential, or key path (${normalized})`,
      DESTRUCTIVE_CATEGORIES.SECRET_WRITE,
    );
  }
  if (PROTECTED_CONFIG_PATTERN.test(normalized)) {
    return verdict(
      DESTRUCTIVE_CATEGORIES.PROTECTED_CONFIG_WRITE,
      `write to a protected config/infra path (${normalized})`,
      DESTRUCTIVE_CATEGORIES.PROTECTED_CONFIG_WRITE,
    );
  }
  return notDestructive();
}

/**
 * Single entry point — the source of truth for "is this action destructive".
 * Accepts either:
 *   classifyDestructiveAction({ command })            // shell command
 *   classifyDestructiveAction({ toolName, input })    // host tool_call shape
 *   classifyDestructiveAction('some command string')  // shorthand
 *
 * For tool_call shapes: a bash tool classifies its command; a write/edit-style
 * tool classifies its target path (input.file_path / input.path). Any other
 * tool with no classifiable field is not-destructive here (the validator
 * sandbox, not this classifier, is what blocks writes wholesale in validator
 * context).
 */
export function classifyDestructiveAction(arg) {
  if (typeof arg === 'string') return classifyCommand(arg);
  if (!arg || typeof arg !== 'object') return notDestructive();

  if (typeof arg.command === 'string' && !arg.toolName) {
    return classifyCommand(arg.command);
  }

  const tool = String(arg.toolName || '').toLowerCase();
  const input = arg.input && typeof arg.input === 'object' ? arg.input : arg;

  if (tool === 'bash' || tool === 'shell' || (!tool && typeof input.command === 'string')) {
    return classifyCommand(input.command);
  }

  const WRITE_TOOLS = new Set([
    'write', 'edit', 'multi_edit', 'notebook_edit', 'apply_patch',
    'str_replace', 'str_replace_editor', 'create_file', 'delete_file',
    'move_file', 'rename_file',
  ]);
  if (WRITE_TOOLS.has(tool)) {
    const target = input.file_path || input.path || input.filepath || input.target;
    return classifyWritePath(typeof target === 'string' ? target : '');
  }

  return notDestructive();
}

/** Convenience predicate. */
export function isDestructiveAction(arg) {
  return classifyDestructiveAction(arg).destructive;
}

// Approval artifact name for a destructive action. Ties into the existing
// approval-audit / guardrail-override path (#133): a run's approvals.json must
// carry a trusted APPROVED record for this artifact before the action proceeds.
// Keyed by taskId so the approval is scoped to the task that requested it —
// same shape family as guardrailOverrideArtifact.
export const DESTRUCTIVE_APPROVAL_PREFIX = 'destructive-action:';

export function destructiveApprovalArtifact(taskId) {
  return `${DESTRUCTIVE_APPROVAL_PREFIX}${taskId ?? 'unknown'}`;
}

/**
 * Gate decision: given a classified verdict (or raw action) and the set of
 * trusted approved artifacts for the run, decide whether the action may
 * proceed. Pure — the caller resolves `approvedArtifacts` via the audited
 * approval path (approval-audit.trustedApprovedArtifacts) and passes the Set.
 *
 * Returns { allowed, requiresApproval, verdict, approval_artifact, reason }.
 * A non-destructive action is always allowed with requiresApproval:false.
 * A destructive action is allowed ONLY when its approval artifact is present
 * in the trusted set.
 */
export function requireApprovalForDestructiveAction({ action, taskId, approvedArtifacts } = {}) {
  const v = action && action.destructive !== undefined ? action : classifyDestructiveAction(action);
  const approvalArtifact = destructiveApprovalArtifact(taskId);

  if (!v.destructive) {
    return { allowed: true, requiresApproval: false, verdict: v, approval_artifact: approvalArtifact, reason: null };
  }

  const approved = approvedArtifacts instanceof Set
    ? approvedArtifacts.has(approvalArtifact)
    : Array.isArray(approvedArtifacts) && approvedArtifacts.includes(approvalArtifact);

  if (approved) {
    return { allowed: true, requiresApproval: true, verdict: v, approval_artifact: approvalArtifact, reason: null };
  }
  return {
    allowed: false,
    requiresApproval: true,
    verdict: v,
    approval_artifact: approvalArtifact,
    reason: `destructive action (${v.category}) requires approval — approve '${approvalArtifact}' via sdlc_approve or the Business Hub: ${v.reason}`,
  };
}
