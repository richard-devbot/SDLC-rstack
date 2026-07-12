/**
 * Programmatic entry point for rstack-agents.
 *
 * Folder structure (SDLC layers):
 *   src/core/harness/   — core SDLC runtime (stages, contracts, evidence, guardrails, run-state)
 *   src/core/tracker/   — project registry, approval queue
 *   src/memory/         — episodic memory and diagnostics
 *   src/notifications/  — Slack / Discord / Teams webhooks
 *   src/observability/  — collectors (reporter, legacy dashboard), Business Hub dashboard, alerts
 *   src/hooks/          — auto-launch helpers
 *   src/commands/       — CLI commands (list, validate)
 *   src/utils/          — shared utilities
 */

// ── Core runtime ──────────────────────────────────────────────────────────────
export { CANONICAL_SDLC_STAGES, assertCanonicalStages } from './core/harness/stages.js';
export { validateBuilderContract, validateValidatorContract } from './core/harness/contracts.js';
export { evaluateReviewIndependence, reviewPolicyForProfile, loadReviewPolicy, validateReviewPolicyConfig, validatorTypeForStage, DEFAULT_REVIEW_POLICY, REVIEW_FALLBACK_BEHAVIORS } from './core/harness/review-independence.js';
export { attestRun, verifyRunAttestations, buildAttestation, signEnvelope, verifyEnvelopeSignature, subjectFiles, readHeadCommit, ATTESTATION_SCHEMA, PREDICATE_TYPES, ATTESTATION_KEY_ENV } from './core/harness/attestations.js';
export { evaluateUntrustedPr, loadGateConfig, renderGateSummary, globToRegExp, DEFAULT_GATE_CONFIG, TRUSTED_ASSOCIATIONS, GATE_VERDICTS } from './security/untrusted-pr-gate.js';
export { appendEvidenceEvent, validateEvidenceEvent } from './core/harness/evidence.js';
export { DEFAULT_HARNESS_GUARDRAILS, guardrailSummary } from './core/harness/guardrails.js';
export { validateApprovalRecord, auditRunApprovals, trustedApprovedArtifacts, approvalAuditEvent, isSafeRunId, isSafeArtifactName, RUN_APPROVAL_STATUSES, QUEUE_APPROVAL_STATUSES, DASHBOARD_APPROVAL_SOURCES } from './core/harness/approval-audit.js';
export { updateRunMetrics, createStageCheckpoint, rollbackStage, prepareRunState } from './core/harness/run-state.js';
export { extractBuilderTelemetry, builderTelemetryEvents, telemetryMetricsUpdate } from './core/harness/telemetry.js';
export { DEFAULT_CRITICAL_STAGE_IDS, CHECKPOINT_EVENT_TYPES, CHECKPOINT_PHASES, CHECKPOINT_MANIFEST_SCHEMA_VERSION, ROLLBACK_STATUSES, checkpointEvent, resolveCriticalStages, loadProjectCriticalStages, isCriticalStage, saveStageCheckpoint, verifyStageCheckpoint, rollbackToCheckpoint, stageCheckpointDir, stageCheckpointManifestPath } from './core/harness/checkpoints.js';
export { buildPipelineState, readPipelineState, summarizePipelineState, writePipelineState } from './core/harness/pipeline-state.js';
export { addDecision, decide, readDecisions, summarizeDecisions, writeDecisions } from './core/harness/decisions.js';
export { assertReadyForStage, dorCheck, readinessModeForProfile } from './core/harness/readiness.js';
export { evaluateGoal, readGoalEvidence, summarizeGoalDecision, normalizeGoalDefinition, normalizeGoalEvaluation, validateGoalEvaluation, validateStageGoalEvaluation, goalVerdictsFromFeedback, GOAL_STATUSES, GOAL_EVALUATION_RESULTS, MAINTENANCE_CATEGORIES } from './core/harness/goal-check.js';
export { planLoopDecision, resolveLoopBounds, loadProjectLoopBounds, evaluateLoopBudget, computeProgressFingerprint, DEFAULT_LOOP_BOUNDS, LOOP_HARD_CAP } from './core/harness/goal-loop.js';

// ── Memory ────────────────────────────────────────────────────────────────────
export { appendEpisode, appendLearning, formatEpisodesForPrompt, projectMemoryDir, readEpisodes, recallEpisodes, searchLearnings } from './memory/index.js';
export { runMemoryDiagnostics } from './memory/diagnostics.js';

// ── Notifications ─────────────────────────────────────────────────────────────
export { sendSlackNotification, formatSlackStageMessage, formatSlackTaskReportMessage } from './notifications/index.js';

// ── Alerts ────────────────────────────────────────────────────────────────────
export { evaluateAlerts, plainLanguageSummary, DEFAULT_ALERT_THRESHOLDS } from './observability/alerts/engine.js';

// ── Tracker ───────────────────────────────────────────────────────────────────
export { registerProject, readRegistry, knownProjectRoots } from './core/tracker/registry.js';
export { readApprovals, appendApproval, resolveApproval, pendingApprovals, approvalSummary } from './core/tracker/approvals.js';

// ── Hooks ─────────────────────────────────────────────────────────────────────
export { autoLaunchBusinessHub } from './hooks/auto-launch.js';

// ── Observers ─────────────────────────────────────────────────────────────────
export { generateRunReport } from './observability/collectors/reporter.js';
export { startDashboardServer } from './observability/collectors/legacy.js';

// ── Commands ──────────────────────────────────────────────────────────────────
export { listAgents, listSkills, listPlugins, addPlugin } from './commands/list.js';
export { validateCommand } from './commands/validate.js';
export { log } from './utils/logger.js';
