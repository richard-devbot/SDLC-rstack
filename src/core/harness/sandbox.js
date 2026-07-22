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
// code mounted READ-ONLY. A hard wall-clock timeout kills the whole process
// tree. Evidence is authored HERE from the child's exit code — never read from
// anything the executed code writes.

import { spawn, spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const DEFAULT_TIMEOUT_MS = 120_000;
const MAX_TIMEOUT_MS = 600_000;
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
export function buildSandboxArgv(runtime, { runDir, command, network = false, image = 'alpine:3.20', limits = {} }) {
  const mem = limits.memory ?? '512m';
  const pids = String(limits.pids ?? 256);
  const cpus = String(limits.cpus ?? 1);
  return [
    runtime, 'run', '--rm',
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

  const argv = buildSandboxArgv(runtime, { runDir, command, network, image, limits });
  const spawnImpl = deps.spawn ?? spawn;
  const start = deps.now ? deps.now() : Date.now();

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
    const timer = setTimeout(() => {
      timedOut = true;
      try { child.kill('SIGKILL'); } catch { /* already gone */ }
    }, bounded);
    timer.unref?.();

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
