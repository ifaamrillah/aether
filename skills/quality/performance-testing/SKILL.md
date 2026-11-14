---
name: performance-testing
description: Measure application latency, throughput, resource usage, rendering performance, and scaling behavior against agreed targets. Use for performance-sensitive changes and release readiness.
license: MIT
metadata:
  author: Aether
  version: "0.1.0"
  category: quality
---

# Performance Testing

## Objective
Produce repeatable measurements with controlled conditions and actionable bottleneck analysis.

## Procedure
1. Define target metrics, workload profile, environment, baseline, and acceptable thresholds.
2. Identify critical paths and representative data sizes or concurrency patterns.
3. Warm up the system and collect multiple measurements; record percentiles rather than only averages.
4. Measure CPU, memory, I/O, network, database, rendering, and garbage collection where applicable.
5. Compare baseline and candidate using the same workload and environment.
6. Profile suspected bottlenecks and distinguish measurement noise from material regressions.
7. Recommend changes and re-measure after remediation.

## Deliverable
Performance report with targets, workload, environment, raw results, percentile metrics, bottleneck evidence, comparison, and recommendation.

## Guardrails
- Do not fabricate benchmark data or claim improvements without comparable measurements.
- Do not run load tests against production without explicit authorization and a defined safety limit.
- Do not compare runs from materially different environments without qualification.
- Do not optimize for synthetic metrics that do not represent user workloads.
