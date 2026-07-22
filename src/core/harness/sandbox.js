// owner: RStack developed by Richardson Gunde
//
// Transient Sandbox — "The Scientist" (#452). Executes builder-authored (i.e.
// UNTRUSTED) commands and captures the REAL exit code + output as evidence, so
// validation stops trusting the builder's self-reported `tests_run`.
//
// Security posture (Richardson's call): CONTAINER-ONLY. Code runs only inside a
// real container (docker/podman); there is no unconfined child-process tier.
// When no runtime is present the sandbox does NOT execute — it returns an
// `execution: unverified` record so the gate degrades to contract validation,
// never a false green and never unconfined.
//
// Every container invocation is locked down: no network by default, no host
// environment, all Linux capabilities dropped, non-root, memory/pids/cpu
// capped, root filesystem read-only with a small writable tmpfs, and the run's
// code mounted READ-ONLY. A hard wall-clock timeout force-removes the (named)
// container in the daemon AND kills the local client — killing the `docker run`
// client alone would orphan the container. Evidence is authored HERE from the
// child's exit code — never read from anything the executed code writes.

import { spawn, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve, join } from 'node:path';

const DEFAULT_TIMEOUT_MS = 120_000;
export const MAX_TIMEOUT_MS = 600_000;
const OUTPUT_TAIL_BYTES = 8 * 1024; // bounded like goal-check's maxBuffer precedent
const RUNTIMES = ['docker', 'podman'];

// Detect an available container runtime. Injectable probe so tests never shell
// out. Returns 'docker' | 'podman' | null.
export function detectContainerRuntime({ probe = defaultProbe } = {}) {
  for (const runtime of RUNTIMES) {
    if (probe(runtime)) return runtime;
  }
  return null;
}

function defaultProbe(runtime) {
  try {
    const res = spawnSync(runtime, ['--version'], { stdio: 'ignore', timeout: 5_000 });
    return res.status === 0;
  } catch {
    return false;
  }
}

// Build the locked-down `docker/podman run` argv for an untrusted command.
// Exported so the security flags are testable without a daemon.
export function buildSandboxArgv(runtime, { runDir, command, network = false, image = 'alpine:3.20', limits = {}, containerName }) {
  const mem = limits.memory ?? '512m';
  const pids = String(limits.pids ?? 256);
  const cpus = String(limits.cpus ?? 1);
  return [
    runtime, 'run', '--rm',
    // Named so the daemon-side container can be force-reaped on timeout — killing
    // the `docker run` client alone leaves the container running (a documented
    // docker/podman gotcha), so the timeout path also runs `rm -f <name>`.
    ...(containerName ? ['--name', containerName] : []),
    '--network', network ? 'bridge' : 'none', // exfiltration + malicious-install guard
    '--memory', mem, '--memory-swap', mem,     // no swap escape hatch
    '--pids-limit', pids,
    '--cpus', cpus,
    '--read-only',                              // root fs immutable…
    '--tmpfs', '/tmp:rw,size=64m',             // …except a small scratch
    '--cap-drop', 'ALL',
    '--security-opt', 'no-new-privileges',
    '--user', '1000:1000',                      // non-root
    '--env', 'HOME=/tmp',                        // no host env inherited (explicit, minimal)
    '-v', `${resolve(runDir)}:/work:ro`,        // code mounted READ-ONLY
    '-w', '/work',
    image,
    'sh', '-c', command,                         // shell runs INSIDE the container only
  ];
}

function tail(buffer) {
  const text = Buffer.isBuffer(buffer) ? buffer : Buffer.from(String(buffer ?? ''));
  if (text.length <= OUTPUT_TAIL_BYTES) return { text: text.toString('utf8'), truncated: false };
  return { text: text.subarray(text.length - OUTPUT_TAIL_BYTES).toString('utf8'), truncated: true };
}

// Run `command` for `taskId` inside a transient container against runDir's code.
// Returns a harness-authored `execution` evidence record. `spawnImpl` and
// `runtime` are injectable so tests exercise the argv + exit-code mapping and
// the no-runtime degrade path without a real daemon.
export function runInSandbox(runDir, { taskId, command, network = false, timeoutMs = DEFAULT_TIMEOUT_MS, image, limits } = {}, deps = {}) {
  const runtime = deps.runtime ?? detectContainerRuntime({ probe: deps.probe });
  const bounded = Math.min(Math.max(1, Number(timeoutMs) || DEFAULT_TIMEOUT_MS), MAX_TIMEOUT_MS);

  // No runtime → never execute unconfined. Degrade to a labeled non-verdict.
  if (!runtime) {
    return Promise.resolve({
      task_id: taskId, kind: 'execution', status: 'observed', tier: 'unverified',
      evidence: 'no container runtime available — execution not verified (contract validation only)',
      command, exit_code: null, duration_ms: 0, network, truncated: false,
    });
  }

  const containerName = deps.containerName ?? `rstack-sbx-${randomUUID()}`;
  const argv = buildSandboxArgv(runtime, { runDir, command, network, image, limits, containerName });
  const spawnImpl = deps.spawn ?? spawn;
  const start = deps.now ? deps.now() : Date.now();

  // Force-remove the container in the daemon. Killing the `docker run` client
  // does NOT stop the container, so on timeout we reap by name. Fire-and-forget,
  // best-effort — an orphan is bad, but blocking the verdict on cleanup is worse.
  const reapContainer = () => {
    try {
      const reaper = spawnImpl(runtime, ['rm', '-f', containerName], { stdio: 'ignore' });
      reaper?.on?.('error', () => {});
      reaper?.unref?.();
    } catch { /* daemon gone / already reaped */ }
  };

  return new Promise((resolvePromise) => {
    let child;
    try {
      child = spawnImpl(argv[0], argv.slice(1), { stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (err) {
      resolvePromise({
        task_id: taskId, kind: 'execution', status: 'observed', tier: 'unverified',
        evidence: `container runtime failed to start: ${err?.message ?? err}`,
        command, exit_code: null, duration_ms: 0, network, truncated: false,
      });
      return;
    }

    const out = []; const errBuf = [];
    child.stdout?.on('data', (d) => out.push(d));
    child.stderr?.on('data', (d) => errBuf.push(d));

    let settled = false;
    let timedOut = false;
    // NOT unref'd: a kill-timeout for a runaway container MUST be allowed to
    // fire — unref would let the loop resolve with the timer pending (and a
    // hung child unkilled). It is always cleared on close, so it never keeps
    // the process open longer than the bounded window.
    const timer = setTimeout(() => {
      timedOut = true;
      reapContainer(); // stop the container in the daemon, not just the client…
      try { child.kill('SIGKILL'); } catch { /* already gone */ } // …then the client
    }, bounded);

    const finish = (exitCode) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const stdout = tail(Buffer.concat(out.map((c) => (Buffer.isBuffer(c) ? c : Buffer.from(c)))));
      const stderr = tail(Buffer.concat(errBuf.map((c) => (Buffer.isBuffer(c) ? c : Buffer.from(c)))));
      const duration = (deps.now ? deps.now() : Date.now()) - start;
      const passed = !timedOut && exitCode === 0;
      resolvePromise({
        task_id: taskId, kind: 'execution',
        status: passed ? 'PASS' : 'FAIL',
        tier: runtime,
        evidence: timedOut
          ? `execution timed out after ${bounded}ms (killed)`
          : `exit ${exitCode} in ${duration}ms`,
        command, exit_code: timedOut ? null : exitCode, duration_ms: duration,
        network, stdout_tail: stdout.text, stderr_tail: stderr.text,
        truncated: stdout.truncated || stderr.truncated,
      });
    };

    child.on('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolvePromise({
        task_id: taskId, kind: 'execution', status: 'observed', tier: 'unverified',
        evidence: `container execution error: ${err?.message ?? err}`,
        command, exit_code: null, duration_ms: 0, network, truncated: false,
      });
    });
    child.on('close', (code) => finish(code));
  });
}

// ---------------------------------------------------------------------------
// #452 PR2 — wiring the Scientist into the validate gate.
//
// Sandbox execution config lives in .rstack/rstack.config.json under a `sandbox`
// block, sibling to `guardrails` (read the same way loadProjectGuardrails does).
// ---------------------------------------------------------------------------

export const DEFAULT_SANDBOX_CONFIG = Object.freeze({
  enabled: true,           // auto-run whenever a runtime + authoritative command exist
  image: 'alpine:3.20',    // shell-only default; set node:/python: images to run real suites
  network: false,          // OFF by default (exfiltration + malicious-install guard)
  timeoutMs: DEFAULT_TIMEOUT_MS,
  command: null,           // project-global authoritative test command (trusted)
  perStage: {},            // canonical-stage-id -> { command, image?, network?, timeoutMs? }
  limits: { memory: '512m', pids: 256, cpus: 1 },
});

// Merge + validate a raw `sandbox` block into an effective config. Unknown keys
// are ignored; bad-typed values fall back to the default (never silently weaken
// the network/isolation posture).
export function resolveSandboxConfig(raw = {}) {
  const cfg = {
    ...DEFAULT_SANDBOX_CONFIG,
    limits: { ...DEFAULT_SANDBOX_CONFIG.limits },
    perStage: {},
  };
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return cfg;
  if (typeof raw.enabled === 'boolean') cfg.enabled = raw.enabled;
  if (typeof raw.image === 'string' && raw.image.trim()) cfg.image = raw.image.trim();
  if (typeof raw.network === 'boolean') cfg.network = raw.network;
  const timeout = Number(raw.timeout_ms ?? raw.timeoutMs);
  if (Number.isFinite(timeout) && timeout > 0) cfg.timeoutMs = Math.min(timeout, MAX_TIMEOUT_MS);
  if (typeof raw.command === 'string' && raw.command.trim()) cfg.command = raw.command.trim();
  if (raw.limits && typeof raw.limits === 'object' && !Array.isArray(raw.limits)) {
    if (typeof raw.limits.memory === 'string' && raw.limits.memory.trim()) cfg.limits.memory = raw.limits.memory.trim();
    if (Number.isFinite(Number(raw.limits.pids))) cfg.limits.pids = Number(raw.limits.pids);
    if (Number.isFinite(Number(raw.limits.cpus))) cfg.limits.cpus = Number(raw.limits.cpus);
  }
  const per = raw.per_stage ?? raw.perStage;
  if (per && typeof per === 'object' && !Array.isArray(per)) {
    for (const [stageId, entry] of Object.entries(per)) {
      if (entry && typeof entry === 'object' && typeof entry.command === 'string' && entry.command.trim()) {
        const stageTimeout = Number(entry.timeout_ms ?? entry.timeoutMs);
        cfg.perStage[stageId] = {
          command: entry.command.trim(),
          image: typeof entry.image === 'string' && entry.image.trim() ? entry.image.trim() : undefined,
          network: typeof entry.network === 'boolean' ? entry.network : undefined,
          timeoutMs: Number.isFinite(stageTimeout) && stageTimeout > 0 ? Math.min(stageTimeout, MAX_TIMEOUT_MS) : undefined,
        };
      }
    }
  }
  return cfg;
}

// Load the effective sandbox config from .rstack/rstack.config.json. A malformed
// file yields the (safe) defaults with a stderr note — mirrors
// loadProjectGuardrails so the two never disagree on config-read semantics.
export async function loadSandboxConfig(projectRoot) {
  const configPath = join(projectRoot, '.rstack', 'rstack.config.json');
  if (!existsSync(configPath)) return resolveSandboxConfig();
  try {
    const parsed = JSON.parse(await readFile(configPath, 'utf8'));
    return resolveSandboxConfig(parsed?.sandbox || {});
  } catch (error) {
    if (error instanceof SyntaxError) {
      console.error(`[rstack] Ignoring malformed ${configPath} for sandbox config: ${error.message}. Sandbox defaults apply.`);
      return resolveSandboxConfig();
    }
    throw error;
  }
}

// AUTHORITATIVE command resolution. The command executed for the gate MUST come
// from a trusted source — a plan-time task field or project config — NEVER from
// the untrusted builder's self-reported `tests_run`. If the builder chose the
// command it would just declare `tests_run: ["true"]` and mint itself a green,
// defeating the whole point of running the code. Returns { command, image,
// network, timeoutMs, limits } or null when nothing authoritative is configured
// (→ honest `observed` degrade at the gate, never a false PASS).
export function resolveSandboxCommand({ config = DEFAULT_SANDBOX_CONFIG, stageIds = [], task = {} } = {}) {
  // 1. Plan-time task command (written by the planner, not the builder).
  const taskCommand = typeof task?.test_command === 'string' && task.test_command.trim() ? task.test_command.trim() : null;
  if (taskCommand) {
    return { command: taskCommand, image: config.image, network: config.network, timeoutMs: config.timeoutMs, limits: config.limits };
  }
  // 2. Per-stage configured command (first matching canonical stage).
  for (const stageId of stageIds) {
    const entry = config.perStage?.[stageId];
    if (entry?.command) {
      return {
        command: entry.command,
        image: entry.image ?? config.image,
        network: entry.network ?? config.network,
        timeoutMs: entry.timeoutMs ?? config.timeoutMs,
        limits: config.limits,
      };
    }
  }
  // 3. Project-global configured command.
  if (config.command) {
    return { command: config.command, image: config.image, network: config.network, timeoutMs: config.timeoutMs, limits: config.limits };
  }
  return null;
}

// Map a runInSandbox evidence record → a validation.json check entry, shaped so
// priorCritiqueBlock (#451) can surface the REAL captured output to the next
// builder attempt. On FAIL the evidence IS the actual logs (per the posture:
// "the Evidence must be the actual log output, not a summary"), never a
// paraphrase.
export function executionCheck(record, command) {
  if (!record || record.tier === 'unverified' || record.status === 'observed') {
    return {
      name: 'sandbox_execution',
      status: 'WARN',
      evidence: `${record?.evidence ?? 'execution unverified'} — gate fell back to contract validation (command: ${command ?? 'n/a'})`,
    };
  }
  if (record.status === 'PASS') {
    return {
      name: 'sandbox_execution',
      status: 'PASS',
      evidence: `sandboxed ${record.tier} run passed: ${record.evidence} — \`${command}\``,
    };
  }
  const logs = [record.stderr_tail, record.stdout_tail]
    .map((section) => String(section ?? '').trim())
    .filter(Boolean)
    .join('\n');
  const failure = record.exit_code === null ? 'timed out' : `exit ${record.exit_code}`;
  return {
    name: 'sandbox_execution',
    status: 'FAIL',
    root_cause: `sandboxed ${record.tier} run ${failure}`,
    evidence: logs
      ? `Command \`${command}\` ${failure} in the ${record.tier} sandbox. Actual output:\n${logs}`
      : `Command \`${command}\` ${failure} in the ${record.tier} sandbox (no output captured).`,
    remediation: 'Fix the failing command shown above — these are the errors from a real sandboxed run, not a self-report.',
  };
}
