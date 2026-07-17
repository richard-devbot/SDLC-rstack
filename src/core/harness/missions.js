/**
 * Canonical RStack delivery missions.
 *
 * Missions group reusable SDLC departments into the eight bounded pieces of
 * work planned by the Pi integration. A department can serve more than one
 * mission, so consumers must keep stage identity separate from mission
 * identity.
 *
 * owner: RStack developed by Richardson Gunde
 */
import { CANONICAL_SDLC_STAGES } from './stages.js';

const DEFINITIONS = [
  ['001-product-clarification', 'Product clarification', ['product', 'docs'], ['00-environment', '01-transcript']],
  ['002-requirements', 'Requirements and acceptance criteria', ['product', 'sdlc'], ['02-requirements', '04-planning', '05-jira']],
  ['003-architecture', 'Architecture and technical design', ['backend', 'frontend', 'devops', 'data', 'security'], ['06-architecture', '12-security-threat-model', '14-cost-estimation']],
  ['004-implementation', 'Implementation', ['backend', 'frontend', 'data'], ['07-code']],
  ['005-testing', 'Testing and QA', ['qa'], ['08-testing']],
  ['006-security-review', 'Security review', ['security', 'backend', 'devops'], ['12-security-threat-model', '13-compliance-checker']],
  ['007-documentation', 'Documentation', ['docs', 'product'], ['03-documentation', '10-summary']],
  ['008-release-readiness', 'Release readiness', ['devops', 'qa', 'docs', 'security'], ['09-deployment', '10-summary', '11-feedback-loop']],
];

const canonicalIds = new Set(CANONICAL_SDLC_STAGES.map((stage) => stage.id));

export const RSTACK_MISSIONS = Object.freeze(DEFINITIONS.map(
  ([id, title, domains, stageIds], order) => {
    if (stageIds.some((stageId) => !canonicalIds.has(stageId))) {
      throw new Error(`Mission ${id} references an unknown canonical stage`);
    }
    return Object.freeze({
      id,
      title,
      domains: Object.freeze([...domains]),
      stageIds: Object.freeze([...stageIds]),
      order,
    });
  },
));

export const MISSION_STAGE_IDS = Object.freeze(Object.fromEntries(
  RSTACK_MISSIONS.map((mission) => [mission.id, mission.stageIds]),
));

export function getRstackMission(id) {
  return RSTACK_MISSIONS.find((mission) => mission.id === id) ?? null;
}
