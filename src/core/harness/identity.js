/**
 * User identity resolution — who is driving the run.
 *
 * Order: RSTACK_USER / RSTACK_USER_EMAIL env → git config → 'unknown'.
 * Many people in a company share the same bot (Slack etc.); identity makes
 * runs, approvals, and guidance attributable per person on the dashboard.
 *
 * owner: RStack developed by Richardson Gunde
 */

import { execFileSync } from 'node:child_process';

function gitConfig(key, cwd) {
  try {
    const out = execFileSync('git', ['config', key], {
      cwd, encoding: 'utf8', timeout: 3000, stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    return out || null;
  } catch {
    return null;
  }
}

/** Resolve { name, email } for the current actor. Never throws. */
export function resolveUserIdentity(projectRoot, env = process.env) {
  const name = env.RSTACK_USER || gitConfig('user.name', projectRoot) || 'unknown';
  const email = env.RSTACK_USER_EMAIL || gitConfig('user.email', projectRoot) || null;
  return { name, email };
}
