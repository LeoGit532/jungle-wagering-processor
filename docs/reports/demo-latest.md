# Demonstration

- PASS: 50 parallel submissions produce one debit
- PASS: Different payload with the same key returns 409
- PASS: Two bets of 80 on 100 leave exactly 20
- PASS: Refund arriving before bet is resumed automatically
- PASS: SQS uses the same financial use case as HTTP
- PASS: Every demonstrated wallet reconciles with its ledger
- PASS: Process crashes and graceful shutdown checked by isolated integration tests

Recovery tests use isolated databases and queues. Financial examples are synthetic local data.
