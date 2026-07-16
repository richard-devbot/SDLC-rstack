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
  REMOTE_EXEC: 'remote-exec',
  PERM_DESTROY: 'perm-destroy',
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
    category: DESTRUCTIVE_CATEGORIES.GIT_FORCE,
    // Working-tree destruction siblings of `reset --hard` (#370): `git checkout`
    // with `--`/a `.` pathspec/`-f` discards uncommitted changes (but a branch
    // op like `checkout -b`/`checkout main` does not); `git restore` discards
    // the worktree unless it is `--staged`-only; `git clean -f` deletes
    // untracked files (incl. local .env/configs). `git clean -n`/`--dry-run` is
    // safe. Branch switches and no-op inspections stay allowed.
    pattern: /\bgit\s+checkout\b[^|;&]*(\s--(\s|$)|\s\.(\s|$)|\s-f\b|--force\b)|\bgit\s+restore\b(?![^|;&]*--staged)|\bgit\s+restore\b[^|;&]*(--worktree\b|\s-W\b)|\bgit\s+clean\b[^|;&]*(-[a-zA-Z]*[fF]|--force\b)/i,
    reason: 'git command discards uncommitted or untracked work (checkout/restore/clean)',
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
    category: DESTRUCTIVE_CATEGORIES.BROAD_DELETE,
    // PowerShell/cmd grammar (#286): Remove-Item with -Recurse/-Force (and
    // their PowerShell single-letter abbreviations), cmd's `rd /s` and `del`
    // with /s /q /f switches. PowerShell is case-insensitive by design, so
    // the rule is too. Plain `del file.txt` is NOT flagged — same escalation
    // logic as the Unix rule.
    pattern: /\bremove-item\b[^|;&]*(\s-(recurse|force|rf?|fo?)\b)|\brd\b[^|;&]*\/s\b|\bdel\b[^|;&]*\/[sqf]\b/i,
    reason: 'recursive/forced delete (PowerShell/cmd form)',
  }),
  Object.freeze({
    category: DESTRUCTIVE_CATEGORIES.PERM_DESTROY,
    // Recursive permission/ownership change (#370): `chmod -R`, `chown -R`,
    // `chgrp -R` can wreck an entire tree's access. A single-target
    // `chmod 644 file` / `chmod +x script` is ordinary work and stays allowed;
    // recursion is the escalation.
    pattern: /\b(chmod|chown|chgrp)\b[^|;&]*(\s-{1,2}[a-zA-Z]*[Rr][a-zA-Z]*\b|\s--recursive\b)/i,
    reason: 'recursive permission or ownership change (chmod/chown/chgrp -R)',
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
    // SQL forms plus the specific, unambiguous ORM/driver/CLI equivalents the
    // issue names. Deliberately NOT bare `.drop(`/`.remove(` — those match too
    // much ordinary code (DOM `el.remove()`, list ops) and would false-positive.
    pattern: /\b(DROP\s+(TABLE|DATABASE|SCHEMA)|DELETE\s+FROM|TRUNCATE\s+(TABLE\s+)?)\b|\.dropDatabase\s*\(|\.deleteMany\s*\(|\bdropdb\b|\bmongo(sh)?\s+\S*\s*--eval\b|\bprisma\s+migrate\s+reset\b|\bsequelize\s+db:drop\b/i,
    reason: 'destructive database statement (SQL drop/delete/truncate, or ORM/CLI drop/reset)',
  }),
  Object.freeze({
    category: DESTRUCTIVE_CATEGORIES.REMOTE_EXEC,
    // Download-and-execute (#370): piping a fetched payload straight into an
    // interpreter runs untrusted code (supply-chain / RCE). Requires the pipe
    // into a shell/interpreter — `curl -o file url` (no pipe) is a plain
    // download and stays allowed.
    pattern: /\b(curl|wget|fetch)\b[^|;&]*\|\s*(sudo\s+)?(sh|bash|zsh|dash|ksh|fish|python[0-9.]*|perl|ruby|node)\b/i,
    reason: 'pipes a downloaded payload into an interpreter (download-and-execute / RCE)',
  }),
  Object.freeze({
    category: DESTRUCTIVE_CATEGORIES.SECRET_WRITE,
    // Shell redirect / tee into a secret, credential, or key path.
    pattern: />>?\s*(\S*[/\\])?(\.env(\.\S+)?|\.npmrc|\.pypirc|id_rsa|id_ed25519|id_ecdsa|\S*\.pem|\S*\.key|secrets?\.\S+|credentials?(\.\S+)?)\b|\btee\b[^|;&]*(\.env|id_rsa|\.pem|\.key|secrets?|credentials?)/i,
    reason: 'shell write into a secret, credential, or key path',
  }),
  Object.freeze({
    category: DESTRUCTIVE_CATEGORIES.SECRET_WRITE,
    // PowerShell content cmdlets (#286): Set-Content / Out-File / Add-Content
    // / Tee-Object targeting a secret, credential, or key path. The generic
    // `>` redirect rule above already covers PowerShell redirection — this
    // covers the cmdlet spellings that avoid `>` entirely.
    pattern: /\b(set-content|out-file|add-content|tee-object)\b[^|;&]*(\.env(\.\S+)?|\.npmrc|\.pypirc|id_rsa|id_ed25519|id_ecdsa|\S*\.pem|\S*\.key|secrets?|credentials?)/i,
    reason: 'PowerShell content cmdlet writing a secret, credential, or key path',
  }),
]);

// Path classification. A write target (relative or absolute) that lands on a
// secret/credential/key is SECRET_WRITE; a protected build/config path is
// PROTECTED_CONFIG_WRITE. The path is matched on its basename and on notable
// segments so `config/.env.production` and `deploy/terraform/main.tf` are both
// caught regardless of leading directories.
const SECRET_PATH_PATTERN = /(^|[/\\])(\.env(\.\S+)?|\.npmrc|\.pypirc|id_rsa|id_ed25519|id_ecdsa|credentials?(\.\w+)?|secrets?(\.\w+)?)$|\.(pem|key|p12|pfx|keystore)$/i;

// `.rstack[/\\]` protects the ENTIRE governance-state surface (approvals.json,
// policy.json, budget.json, rstack.config.json, session.json, validators/…) —
// forging any of these subverts a gate. `.claude/settings*.json` and
// `*rstack-hooks.json` are the HOST's enforcement wiring (#369): an agent that
// rewrites the file holding its own PreToolUse guard hook disables enforcement
// as surely as forging an approval, so those are protected on every write path
// too. We do NOT blanket-protect `.claude/` — agents legitimately author
// `.claude/agents/*.md`, commands, and skills; only the enforcement-bearing
// settings + hooks files are gated.
const PROTECTED_CONFIG_PATTERN = /(^|[/\\])(\.git[/\\]|\.github[/\\]workflows[/\\]|Dockerfile$|docker-compose\.ya?ml$|\.rstack([/\\]|$)|\.claude[/\\]settings(\.local)?\.json$|rstack-hooks\.json$|package-lock\.json$|yarn\.lock$|pnpm-lock\.ya?ml$)|\.(tf|tfvars)$/i;

function notDestructive() {
  return Object.freeze({ destructive: false, category: null, reason: null, matched: null });
}

function verdict(category, reason, matched) {
  return Object.freeze({ destructive: true, category, reason, matched });
}

// Write-capable command verbs whose arguments name paths they create, replace,
// move, remove, or re-permission (#369). A shell redirect (`>` / `>>`) into any
// path is a write regardless of the verb. This is what makes classifyCommand
// catch writes to protected/secret paths SYMMETRICALLY with the write-TOOL path
// (classifyWritePath already gates Write/Edit): the bash path historically
// flagged only secret redirects, so `echo forged > .rstack/runs/<id>/approvals.json`
// — and every other .rstack/ governance file, plus the host's own guard-hook
// config — was wide open. See the self-approval bypass (#369).
const WRITE_COMMAND_VERBS = new Set([
  'tee', 'cp', 'mv', 'install', 'dd', 'ln', 'rm', 'unlink', 'shred',
  'chmod', 'chown', 'chgrp', 'truncate', 'touch',
  // PowerShell / cmd content + item cmdlets (compared lowercased)
  'set-content', 'add-content', 'out-file', 'tee-object', 'clear-content',
  'remove-item', 'move-item', 'copy-item', 'new-item',
]);

function stripQuotes(token) {
  return token.replace(/^['"]+|['"]+$/g, '');
}

// Candidate write-target tokens for one command segment (already split on shell
// separators). Over-inclusive by design: only targets that classifyWritePath
// flags as protected/secret change the verdict, so extracting an extra
// non-protected token is harmless. This keeps the parser simple and avoids
// false negatives (missing a real write matters; a spurious safe target does not).
function writeTargetsInSegment(segment) {
  const targets = [];
  // Redirections: `> p`, `>> p`, `N> p`, `>| p`, glued `>p`.
  const redirectRe = /\d*>>?\|?\s*("[^"]*"|'[^']*'|[^\s|;&<>()]+)/g;
  let m;
  while ((m = redirectRe.exec(segment)) !== null) targets.push(stripQuotes(m[1]));
  const tokens = segment.trim().split(/\s+/).filter(Boolean);
  if (!tokens.length) return targets;
  const verb = stripQuotes(tokens[0]).toLowerCase().replace(/.*[/\\]/, ''); // basename of /bin/rm etc.
  // sed/perl only WRITE with an in-place flag (`-i`, `-pi`, `--in-place`);
  // without it they read to stdout, so a bare `sed 's/x/y/' file` is not a write.
  const inPlaceEditor = (verb === 'sed' || verb === 'perl') && /(^|\s)-\w*i\b|--in-place\b/.test(segment);
  if (WRITE_COMMAND_VERBS.has(verb) || inPlaceEditor) {
    for (const raw of tokens.slice(1)) {
      const tok = stripQuotes(raw);
      if (!tok || tok.startsWith('-')) continue; // skip flags
      const kv = /^of=(.+)$/i.exec(tok) || /^--?path[:=](.+)$/i.exec(tok); // dd of=… / -Path:…
      targets.push(kv ? kv[1] : tok);
    }
  }
  return targets;
}

// A write/move/remove/chmod/redirect whose target lands on a protected
// governance path or a secret — the command-side mirror of classifyWritePath.
function classifyProtectedWrite(command) {
  for (const segment of command.split(/\|\||&&|[|;&\n]/)) {
    for (const target of writeTargetsInSegment(segment)) {
      const v = classifyWritePath(target);
      if (v.destructive) {
        return verdict(v.category, `command writes to a protected or secret path (${target}): ${v.reason}`, v.category);
      }
    }
  }
  return null;
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
  // Symmetry with the write-TOOL path (#369): a write/move/remove/chmod or a
  // redirect targeting a protected governance path (all of .rstack/, the host
  // guard-hook config) or a secret is destructive even when no COMMAND_RULE
  // named it. Runs after the explicit rules so their precise reasons win.
  const protectedWrite = classifyProtectedWrite(command);
  if (protectedWrite) return protectedWrite;
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

  // Canonical tool name (#286): lowercase AND strip separators, so Claude
  // Code's PascalCase ("MultiEdit" -> "multiedit") and Pi's snake_case
  // ("multi_edit" -> "multiedit") both hit the same Set entry. Lowercasing
  // alone silently missed every PascalCase multi-word tool.
  const tool = String(arg.toolName || '').toLowerCase().replace(/[_-]/g, '');
  const input = arg.input && typeof arg.input === 'object' ? arg.input : arg;

  if (tool === 'bash' || tool === 'shell' || tool === 'powershell' || tool === 'pwsh' || tool === 'cmd'
    || (!tool && typeof input.command === 'string')) {
    return classifyCommand(input.command);
  }

  if (WRITE_TOOLS.has(tool)) {
    // notebook_path is NotebookEdit's target parameter — without it the tool
    // name matches but the classifier sees an empty path (#286).
    const target = input.file_path || input.path || input.filepath || input.target || input.notebook_path;
    return classifyWritePath(typeof target === 'string' ? target : '');
  }

  return notDestructive();
}

// Workspace-writing tool names, canonicalized (lowercase + separators stripped,
// so Claude Code PascalCase "MultiEdit" and Pi snake_case "multi_edit" both
// match). Hoisted to module scope so the guard's BLOCKED-task gate (#373) can
// ask "is this a write/edit tool" without re-declaring the list.
const WRITE_TOOLS = Object.freeze(new Set([
  'write', 'edit', 'multiedit', 'notebookedit', 'applypatch',
  'strreplace', 'strreplaceeditor', 'createfile', 'deletefile',
  'movefile', 'renamefile',
]));

/** True when `toolName` is a workspace-writing tool (any spelling). */
export function isWriteTool(toolName) {
  return WRITE_TOOLS.has(String(toolName || '').toLowerCase().replace(/[_-]/g, ''));
}

/**
 * True when a shell command writes a file (redirect/tee/cp/mv/dd/ln/…), even to
 * a non-protected path — reuses the same write-target extraction as the
 * protected-path classifier (#369). Scratch/discard targets (`/dev/null`, fd
 * dups like `2>&1`) do not count. Used by the guard's BLOCKED-task gate (#373)
 * so a hard-blocked task cannot keep mutating the workspace via bash.
 */
export function commandWritesFile(command) {
  if (typeof command !== 'string' || !command.trim()) return false;
  for (const segment of command.split(/\|\||&&|[|;&\n]/)) {
    for (const target of writeTargetsInSegment(segment)) {
      const t = String(target).trim();
      // Skip scratch/discard targets that aren't a persistent workspace change
      // (matches the validator sandbox's temp allowance): /dev/null, fd dups,
      // and the temp dirs.
      if (!t || t === '/dev/null' || /^&?\d+$/.test(t)) continue;
      if (/^(\/var\/tmp|\/private\/tmp|\/tmp)\//.test(t)) continue;
      return true;
    }
  }
  return false;
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
