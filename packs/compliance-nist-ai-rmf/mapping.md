# NIST AI RMF → RStack evidence mapping

<!-- owner: RStack developed by Richardson Gunde -->

This pack maps the NIST AI Risk Management Framework's four functions onto the
RStack artifacts that evidence them. It adds no enforcement — it makes the
evidence a governed run already produces citable in a compliance review.

| AI RMF function | What the reviewer asks | RStack evidence |
| --- | --- | --- |
| **GOVERN** — policies, roles, accountability | Who approved this work, under what policy, with what authority? | `.rstack/policy.json` (required approvals, managers, review_policy), `approvals.json` with actor identity, guardrail-override audit events, profile posture in `rstack.config.json` |
| **MAP** — context, capabilities, risks identified | What was the system asked to do, and what risks were named before build? | run `manifest.json` (goal), stage-02 requirement spec with won't-have/out-of-scope, `decisions.json` + `dor-report.json` (decision queue), stage-12 threat model |
| **MEASURE** — risks analyzed, tracked, verified | How is the claim "it works and is safe" substantiated? | builder/validator contracts per task, `evidence.jsonl`, validation check ledgers, attestation envelopes (`attestations/`), drift report (`rstack-agents drift --json`) |
| **MANAGE** — risks prioritized, responded to, monitored | What happened when something failed, and who decided? | retry-policy decisions in `events.jsonl`, BLOCKED task states, approval queue resolutions, checkpoints + rollback records, Business Hub alerts |

## Using this in review

Run `rstack-agents drift --all --json` and `rstack-agents verify-attestations
--json` and attach both outputs plus the run's `approvals.json` to the review
packet — that covers the MEASURE and MANAGE rows with machine-checked, current
evidence rather than screenshots.
