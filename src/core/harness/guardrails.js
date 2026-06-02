export const DEFAULT_HARNESS_GUARDRAILS = Object.freeze({
  maxTaskAttempts: 2,
  maxDestructiveTaskAttempts: 1,
  maxToolCallsPerTask: 40,
  maxMessagesPerTask: 25,
  requireBuilderContract: true,
  requireValidatorContract: true,
  requireEvidenceForPass: true,
  requireUserApprovalForDestructiveActions: true,
  requireUserApprovalForPublishDeployOrForcePush: true,
});

export function guardrailSummary(guardrails = DEFAULT_HARNESS_GUARDRAILS) {
  return Object.entries(guardrails).map(([key, value]) => `- ${key}: ${value}`).join('\n');
}
