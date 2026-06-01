/**
 * Programmatic entry point for rstack-agents.
 *
 * Folder structure:
 *   src/harness/        — core SDLC runtime (stages, contracts, evidence, guardrails, run-state)
 *   src/memory/         — episodic memory and diagnostics
 *   src/notifications/  — Slack / Discord / Teams webhooks
 *   src/alerts/         — threshold evaluation, plain-language summaries
 *   src/tracker/        — project registry, approval queue
 *   src/hooks/          — auto-launch helpers
 *   src/observers/      — reporter and legacy static dashboard helpers
 *   src/dashboard/      — Business Hub server and redesigned UI
 *   src/commands/       — CLI commands (list, validate)
 *   src/utils/          — shared utilities
 */

// ── Core runtime ──────────────────────────────────────────────────────────────
export { CANONICAL_SDLC_STAGES, assertCanonicalStages } from './harness/stages.js';
export { validateBuilderContract, validateValidatorContract } from './harness/contracts.js';
export { appendEvidenceEvent, validateEvidenceEvent } from './harness/evidence.js';
export { DEFAULT_HARNESS_GUARDRAILS, guardrailSummary } from './harness/guardrails.js';
export { updateRunMetrics, createStageCheckpoint, rollbackStage, prepareRunState } from './harness/run-state.js';

// ── Memory ────────────────────────────────────────────────────────────────────
export { appendEpisode, appendLearning, formatEpisodesForPrompt, projectMemoryDir, readEpisodes, recallEpisodes, searchLearnings } from './memory/index.js';
export { runMemoryDiagnostics } from './memory/diagnostics.js';

// ── Notifications ─────────────────────────────────────────────────────────────
export { sendSlackNotification, formatSlackStageMessage, formatSlackTaskReportMessage } from './notifications/index.js';

// ── Alerts ────────────────────────────────────────────────────────────────────
export { evaluateAlerts, plainLanguageSummary, DEFAULT_ALERT_THRESHOLDS } from './alerts/engine.js';

// ── Tracker ───────────────────────────────────────────────────────────────────
export { registerProject, readRegistry, knownProjectRoots } from './tracker/registry.js';
export { readApprovals, appendApproval, resolveApproval, pendingApprovals, approvalSummary } from './tracker/approvals.js';

// ── Hooks ─────────────────────────────────────────────────────────────────────
export { autoLaunchBusinessHub } from './hooks/auto-launch.js';

// ── Observers ─────────────────────────────────────────────────────────────────
export { generateRunReport } from './observers/reporter.js';
export { startDashboardServer } from './observers/legacy.js';

// ── Commands ──────────────────────────────────────────────────────────────────
export { listAgents, listSkills, listPlugins, addPlugin } from './commands/list.js';
export { validateCommand } from './commands/validate.js';
export { log } from './utils/logger.js';
