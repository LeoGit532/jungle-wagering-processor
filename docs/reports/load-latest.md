# Load experiment

Recorded: 2026-10-22T23:02:35.084Z

Bun 1.4.3; linux/x64; 13th Gen Intel(R) Core(TM) i7-13650HX; 20 available CPU threads. Processing instances: 1.

500 requests per scenario, concurrency 20. Wallet creation is excluded. Percentiles include response parsing.

| Scenario | Requests | req/s | p50 ms | p95 ms | p99 ms | Unexpected errors | Business rejections | Lock conflicts | Reconciled |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---|
| hot-wallet | 500 | 204.1 | 96.1 | 131.4 | 173.2 | 0.00% | 0 | 0 | true |
| ten-wallets | 500 | 534.3 | 36.1 | 51.1 | 57.8 | 0.00% | 0 | 0 | true |
| idempotent-replay | 500 | 491.0 | 39.4 | 47.8 | 48.8 | 0.00% | 0 | 0 | true |
| insufficient-balance | 500 | 355.8 | 54.4 | 68.7 | 79.4 | 0.00% | 499 | 0 | true |

Outbox peak lag during offered load: 5.52 s; peak pending: 2418; remaining after bounded drain: 1467.

Analysis: compare the serialized hot wallet with independent wallets; replay still visits PostgreSQL for persistent guarantees. The outbox publishes asynchronously, so HTTP throughput alone is insufficient to describe total processing capacity. Expected insufficient-funds rejections are kept separate from unexpected errors. This is a synthetic local run, without a production RPS claim. Full settings and raw measurements are in the JSON report.

At the end of the 15.20 second drain observation, lag was 18.34 seconds with 1467 events still pending. This is a measured egress bottleneck in the single-publisher configuration, not a claim that events were lost. Peak sampling covered the request phase only.
