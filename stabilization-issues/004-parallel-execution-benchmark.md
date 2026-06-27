# 004 – Parallel‑Execution Benchmark
**Disadvantage**: Performance latency (builder‑validator round‑trip).
**Proposed remediation**
- Identify data‑independent stages (see plan).
- Create `benchmark-harness.sh` that runs the pipeline sequentially then in parallel.
- Record `SEQ_TIME` and `PAR_TIME`; require `PAR_TIME ≤ 0.6 × SEQ_TIME` (≥ 40 % faster).
- Update `manifest.json` with `"parallel_groups": ["B"]` when target met.
**Web‑research needed**
- "Running CI stages in parallel safely"
- "GNU parallel vs. xargs for pipeline jobs"
**Acceptance criteria**
- Benchmark script runs without errors.
- Measured latency drop ≥ 40 %.
- Manifest updated accordingly.
