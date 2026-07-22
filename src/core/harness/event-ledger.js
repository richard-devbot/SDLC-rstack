import { appendFile } from 'node:fs/promises';
import { join } from 'node:path';

import { withFileLock } from './safe-write.js';

/**
 * Append one complete event record to a run's canonical event ledger.
 *
 * The events ledger drives attempt limits, cost accounting, and lifecycle
 * state. Every writer must share its advisory lock: concurrent appendFile
 * calls are not a transaction and can leave a torn JSONL record that tolerant
 * readers would otherwise skip.
 */
export async function appendRunEvent(runDir, event) {
  const eventPath = join(runDir, 'events.jsonl');
  await withFileLock(eventPath, async () => {
    await appendFile(eventPath, `${JSON.stringify(event)}\n`);
  });
  return eventPath;
}
