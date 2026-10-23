# Load experiment

Recorded: 2026-10-22T23:13:11.286Z

Bun 1.4.3; linux/x64; 13th Gen Intel(R) Core(TM) i7-13650HX; 20 available CPU threads. Processing instances: 3.

500 requests per scenario, concurrency 20. Wallet creation is excluded. Percentiles include response parsing.

| Scenario | Requests | req/s | p50 ms | p95 ms | p99 ms | Unexpected errors | Business rejections | Lock conflicts | Reconciled |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---|
| hot-wallet | 500 | 175.5 | 109.5 | 169.0 | 218.9 | 0.00% | 0 | 0 | true |
| ten-wallets | 500 | 499.1 | 40.0 | 51.0 | 55.5 | 0.00% | 0 | 0 | true |
| idempotent-replay | 500 | 438.2 | 45.0 | 53.0 | 60.3 | 0.00% | 0 | 0 | true |
| insufficient-balance | 500 | 362.9 | 53.7 | 64.0 | 66.8 | 0.00% | 499 | 0 | true |

Outbox peak lag during offered load: 3.81 s; peak pending: 1607; remaining after bounded drain: 0.

Analysis: compare the serialized hot wallet with independent wallets; replay still visits PostgreSQL for persistent guarantees. The outbox publishes asynchronously, so HTTP throughput alone is insufficient to describe total processing capacity. Expected insufficient-funds rejections are kept separate from unexpected errors. This is a synthetic local run, without a production RPS claim. Full settings and raw measurements are in the JSON report.
