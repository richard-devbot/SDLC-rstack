// owner: RStack developed by Richardson Gunde
//
// Single source of stage metadata for the dashboard client (#95).
//
// Stage ids and order come from the canonical harness list
// (src/core/harness/stages.js) at process start (any restart regenerates it) — the dashboard never keeps its
// own stage list. What lives here is purely presentational decoration per
// canonical stage id: the Workflow Map business framing, the Studio personas
// (shared with the 3D studio), and the Run Report card chrome. Ids are
// validated against the canonical list at module load, so a stage added or
// renamed in the harness fails loudly here instead of silently drifting.

import { CANONICAL_SDLC_STAGES } from '../../../core/harness/stages.js';

// UI decoration per canonical stage id. Personas intentionally differ per
// surface (Workflow Map speaks to managers, Studio introduces characters,
// Run Report abbreviates) — the shared truth is the id set and order.
const STAGE_DECOR = {
  '00-environment': {
    workflow: {
      business: 'System Check',
      persona: 'IT Setup Specialist',
      role: 'Gets the studio ready',
      desc: 'Checks that every tool, folder and runtime needed for a run is available before work starts.',
      reads: 'kickoff context',
      writes: 'readiness report',
    },
    studio: ['DevOps Engineer', 'Prepare the Workshop'],
    card: { icon: '🧰', title: 'Environment', persona: 'DevOps' },
  },
  '01-transcript': {
    workflow: {
      business: 'Understanding The Ask',
      persona: 'Business Analyst',
      role: 'Captures the working session',
      desc: 'Turns the user conversation into a structured record so later agents do not guess intent.',
      reads: 'session transcript',
      writes: 'project brief',
    },
    studio: ['Business Analyst', 'Listen to the Customer'],
    card: { icon: '🎙', title: 'Transcript', persona: 'Business Analyst' },
  },
  '02-requirements': {
    workflow: {
      business: 'Define What To Build',
      persona: 'Senior Analyst',
      role: 'Writes the requirements',
      desc: 'Converts the brief into clear feature, constraint and success criteria for delivery.',
      reads: 'project brief',
      writes: 'requirements spec',
    },
    studio: ['Product Manager', 'Define What to Build'],
    card: { icon: '📋', title: 'Requirements', persona: 'Product Manager' },
  },
  '03-documentation': {
    workflow: {
      business: 'Business Paperwork',
      persona: 'Technical Writer',
      role: 'Prepares decision-ready docs',
      desc: 'Packages requirements into readable documents that business and delivery teams can review.',
      reads: 'requirements',
      writes: 'documentation set',
    },
    studio: ['Technical Writer', 'Write It Down'],
    card: { icon: '📝', title: 'Documentation', persona: 'Technical Writer' },
  },
  '04-planning': {
    workflow: {
      business: 'Delivery Plan',
      persona: 'Project Manager',
      role: 'Breaks work into steps',
      desc: 'Turns the scope into a staged plan with sequencing, milestones and handoff expectations.',
      reads: 'requirements',
      writes: 'implementation plan',
    },
    studio: ['Delivery Manager', 'Plan the Work'],
    card: { icon: '🗺', title: 'Planning', persona: 'Delivery Manager' },
  },
  '05-jira': {
    workflow: {
      business: 'Task Tickets',
      persona: 'Scrum Master',
      role: 'Creates trackable work',
      desc: 'Makes the work visible as tickets and acceptance criteria that teams can follow.',
      reads: 'delivery plan',
      writes: 'task tickets',
    },
    studio: ['Scrum Master', 'Create the Tickets'],
    card: { icon: '🎫', title: 'Tickets', persona: 'Scrum Master' },
  },
  '06-architecture': {
    workflow: {
      business: 'System Design',
      persona: 'Solution Architect',
      role: 'Designs the system',
      desc: 'Defines the architecture, data movement, major trade-offs and technical boundaries.',
      reads: 'requirements',
      writes: 'system design',
    },
    studio: ['Solution Architect', 'Design the System'],
    card: { icon: '🏛', title: 'Architecture', persona: 'Solution Architect' },
  },
  '07-code': {
    workflow: {
      business: 'Build The Software',
      persona: 'Senior Developer',
      role: 'Writes production code',
      desc: 'Implements the planned changes and records what changed through builder contracts.',
      reads: 'system design',
      writes: 'code report',
    },
    studio: ['Senior Developer', 'Build the Software'],
    card: { icon: '⚙️', title: 'Code', persona: 'Senior Developer' },
  },
  '08-testing': {
    workflow: {
      business: 'Quality Checks',
      persona: 'QA Lead',
      role: 'Validates the work',
      desc: 'Checks outcomes against requirements and attaches validation evidence to the run.',
      reads: 'code report',
      writes: 'test report',
    },
    studio: ['QA Engineer', 'Prove It Works'],
    card: { icon: '🧪', title: 'Testing', persona: 'QA Engineer' },
  },
  '09-deployment': {
    workflow: {
      business: 'Going Live',
      persona: 'DevOps Engineer',
      role: 'Prepares release',
      desc: 'Packages delivery, release checks, deployment evidence and rollout readiness.',
      reads: 'test report',
      writes: 'deployment report',
    },
    studio: ['Release Engineer', 'Ship It'],
    card: { icon: '🚀', title: 'Deployment', persona: 'Release Engineer' },
  },
  '10-summary': {
    workflow: {
      business: 'Handoff Package',
      persona: 'Delivery Lead',
      role: 'Summarizes the run',
      desc: 'Collects outcomes, proof and next steps into a handoff summary.',
      reads: 'all stage outputs',
      writes: 'run summary',
    },
    studio: ['Program Manager', 'Report the Outcome'],
    card: { icon: '📊', title: 'Summary', persona: 'Program Manager' },
  },
  '11-feedback-loop': {
    workflow: {
      business: 'Learning Loop',
      persona: 'Customer Success Lead',
      role: 'Captures feedback',
      desc: 'Feeds lessons, follow-ups and product signals back into the next iteration.',
      reads: 'handoff summary',
      writes: 'feedback record',
    },
    studio: ['Quality Coach', 'Close the Loop'],
    card: { icon: '🔄', title: 'Feedback Loop', persona: 'Quality Coach' },
  },
  '12-security-threat-model': {
    workflow: {
      business: 'Security Review',
      persona: 'Security Lead',
      role: 'Models threats',
      desc: 'Identifies security risks, attack surfaces and mitigation needs before shipment confidence is claimed.',
      reads: 'architecture and code',
      writes: 'threat model',
    },
    studio: ['Security Engineer', 'Find the Threats'],
    card: { icon: '🛡', title: 'Security', persona: 'Security Engineer' },
  },
  '13-compliance-checker': {
    workflow: {
      business: 'Compliance Check',
      persona: 'Compliance Lead',
      role: 'Checks obligations',
      desc: 'Reviews privacy, regulatory, policy and enterprise-readiness expectations for the run.',
      reads: 'requirements and evidence',
      writes: 'compliance report',
    },
    studio: ['Compliance Officer', 'Check the Rules'],
    card: { icon: '⚖️', title: 'Compliance', persona: 'Compliance Officer' },
  },
  '14-cost-estimation': {
    workflow: {
      business: 'Cost Forecast',
      persona: 'Finance Analyst',
      role: 'Estimates operating cost',
      desc: 'Captures cost signals and expected operating impact so business teams can plan responsibly.',
      reads: 'deployment design',
      writes: 'cost estimate',
    },
    studio: ['FinOps Analyst', 'Count the Cost'],
    card: { icon: '💰', title: 'Cost', persona: 'FinOps Analyst' },
  },
};

export const STAGE_IDS = Object.freeze(CANONICAL_SDLC_STAGES.map((stage) => stage.id));

// Enforced at load: decoration must cover the canonical stages exactly —
// same ids, same order, no extras. Prompt text never guards this; code does.
(function assertDecorMatchesCanonical() {
  const decorIds = Object.keys(STAGE_DECOR);
  if (decorIds.length !== STAGE_IDS.length) {
    throw new Error(`Dashboard stage decor lists ${decorIds.length} stages; harness has ${STAGE_IDS.length}.`);
  }
  STAGE_IDS.forEach((id, index) => {
    if (decorIds[index] !== id) {
      throw new Error(`Dashboard stage decor out of sync with canonical stages at ${id} (found ${decorIds[index]}).`);
    }
  });
})();

const pickTable = (field) =>
  Object.fromEntries(STAGE_IDS.map((id) => [id, STAGE_DECOR[id][field]]));

// Server-side views for other modules (the 3D studio serializes personas).
export const STUDIO_PERSONAS = Object.freeze(pickTable('studio'));

// Client-side script emitted into the served bundle ahead of the page
// modules. Every stage table the client uses is generated from the canonical
// list here — pages must not declare their own.
export const stageMetaScript = `
// ── stage meta (generated at process start from src/core/harness/stages.js) ──
var STAGE_IDS = ${JSON.stringify(STAGE_IDS)};
var WORKFLOW_STAGE_META = ${JSON.stringify(pickTable('workflow'), null, 2)};
var STAGE_PERSONAS = ${JSON.stringify(pickTable('studio'), null, 2)};
var STUDIO_STAGE_ORDER = STAGE_IDS.slice();
var STAGE_CARD_META = ${JSON.stringify(pickTable('card'), null, 2)};
var STAGE_CARD_ORDER = STAGE_IDS.slice();
`;
