export const CANONICAL_SDLC_STAGES = Object.freeze([
  { id: '00-environment', title: 'Environment', artifact: 'environment_report.json', agent: 'agent.00-environment' },
  { id: '01-transcript', title: 'Transcript', artifact: 'transcript.json', agent: 'agent.01-transcript' },
  { id: '02-requirements', title: 'Requirements', artifact: 'requirements.json', agent: 'agent.02-requirements' },
  { id: '03-documentation', title: 'Documentation', artifact: 'documentation.json', agent: 'agent.03-documentation' },
  { id: '04-planning', title: 'Planning', artifact: 'plan.json', agent: 'agent.04-planning' },
  { id: '05-jira', title: 'Jira', artifact: 'jira_tickets.json', agent: 'agent.05-jira' },
  { id: '06-architecture', title: 'Architecture', artifact: 'system_design.json', agent: 'agent.06-architecture' },
  { id: '07-code', title: 'Code', artifact: 'code_report.json', agent: 'agent.07-code' },
  { id: '08-testing', title: 'Testing', artifact: 'test_report.json', agent: 'agent.08-testing' },
  { id: '09-deployment', title: 'Deployment', artifact: 'deployment_report.json', agent: 'agent.09-deployment' },
  { id: '10-summary', title: 'Summary', artifact: 'summary.json', agent: 'agent.10-summary' },
  { id: '11-feedback-loop', title: 'Feedback loop', artifact: 'feedback.json', agent: 'agent.11-feedback-loop' },
  { id: '12-security-threat-model', title: 'Security threat model', artifact: 'threat_model.json', agent: 'agent.12-security-threat-model' },
  { id: '13-compliance-checker', title: 'Compliance checker', artifact: 'compliance_report.json', agent: 'agent.13-compliance-checker' },
  { id: '14-cost-estimation', title: 'Cost estimation', artifact: 'cost_estimate.json', agent: 'agent.14-cost-estimation' },
]);

const EXPECTED_STAGE_IDS = Object.freeze([
  '00-environment',
  '01-transcript',
  '02-requirements',
  '03-documentation',
  '04-planning',
  '05-jira',
  '06-architecture',
  '07-code',
  '08-testing',
  '09-deployment',
  '10-summary',
  '11-feedback-loop',
  '12-security-threat-model',
  '13-compliance-checker',
  '14-cost-estimation',
]);

export function assertCanonicalStages(stages = CANONICAL_SDLC_STAGES) {
  if (!Array.isArray(stages)) throw new Error('Canonical SDLC stages must be an array.');
  if (stages.length !== EXPECTED_STAGE_IDS.length) {
    throw new Error(`Expected 15 canonical SDLC stages, got ${stages.length}.`);
  }

  const ids = stages.map((stage) => stage.id);
  const mismatch = EXPECTED_STAGE_IDS.find((id, index) => ids[index] !== id);
  if (mismatch) {
    throw new Error(`Canonical SDLC stage order mismatch at ${mismatch}.`);
  }

  for (const stage of stages) {
    for (const field of ['id', 'title', 'artifact', 'agent']) {
      if (!stage[field]) throw new Error(`Canonical SDLC stage ${stage.id || '<unknown>'} missing ${field}.`);
    }
  }

  return true;
}

export function getCanonicalStage(stageId) {
  return CANONICAL_SDLC_STAGES.find((stage) => stage.id === stageId);
}

export function stageArtifactRelativePath(runId, stageId, artifactName) {
  const stage = getCanonicalStage(stageId);
  if (!stage) throw new Error(`Unknown canonical SDLC stage: ${stageId}`);
  const artifact = artifactName || stage.artifact;
  return `.rstack/runs/${runId}/artifacts/stages/${stage.id}/${artifact}`;
}

assertCanonicalStages();
