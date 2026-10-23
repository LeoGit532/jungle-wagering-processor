# Auditoria do desafio

Revisão final em 23/10/2026 contra o README do repositório junglegaming/backend-challenge. Resultado local Linux: **88 testes, 274 asserções, zero falhas**. Esta matriz liga requisitos às implementações e evidências; não substitui a leitura dos testes.

| Requisito | Implementação | Evidência |
|---|---|---|
| Bun, TS estrito, Nest, MikroORM, PostgreSQL, SQS | package.json, tsconfig.json, bootstrap, orm, compose.yaml | Build frozen-lockfile, typecheck, HTTP e integração reais |
| Dinheiro preciso, moeda, limite e saldo não negativo | domain/money.ts, wallet.ts, apply-wager.ts | money.test.ts, wallet.test.ts, audit.test.ts |
| Entidades e eventos encapsulados | domain, incluindo InboxMessage/OutboxMessage | wager.test.ts, message-models.test.ts |
| BET/WIN/LOSS/REFUND/ROLLBACK e OPENING interno | apply-wager.ts, wager-transaction.ts, wager-store.ts | wager.test.ts, persistence.test.ts, audit.test.ts |
| Ledger imutável e versão coerente | migrations, constraint triggers, wallet | persistence.test.ts, audit.test.ts: UPDATE/DELETE/TRUNCATE/cascade/versão |
| Atomicidade financeira + inbox + outbox | WagerStore.persistSubmission/withTransaction | persistence.test.ts, messaging.test.ts, resilience.test.ts |
| Idempotência persistente/hash canônico | contracts.ts, store, constraints SQL | contracts.test.ts, persistence.test.ts, http.test.ts |
| 50 duplicatas simultâneas, um débito | lock por wallet e constraints | persistence.test.ts; demo-latest.json |
| Apostas concorrentes maiores que saldo | domínio sob lock pessimista | persistence.test.ts; demonstração de duas apostas de 80 em saldo 100 |
| Três processos reais e wallets distintas | testes/fixtures e processos Bun | processes.test.ts |
| Refunds distintos concorrendo pela mesma referência | unicidade por referência/tipo processado | audit.test.ts |
| Referência entregue antes da original e expiração | worker de referências, estado/tentativas persistidos | messaging.test.ts, demo.ts |
| Envelope SQS e política compartilhada | application/wager-request.ts, messaging/queue-policy.ts | wager-request.test.ts; messaging.test.ts |
| Inbox e redelivery, ack após commit | consumer.ts e store | messaging.test.ts, processes.test.ts |
| Commit financeiro antes de publicação; recuperação | outbox SQL e publisher independente | resilience.test.ts: processo termina antes de publicar |
| Múltiplos publishers | FOR UPDATE SKIP LOCKED | messaging.test.ts |
| Falha depois do envio e antes da marcação | eventId estável, pelo menos uma vez | resilience.test.ts: duplicata real e assinante com PK persistente |
| Retry, DLQ e FAILED auditável | consumer.ts, Wagering.recordFailure | messaging.test.ts, resilience.test.ts; exceção se banco indisponível documentada |
| Encerramento durante operação em andamento | runtime.stop e handlers de sinais | resilience.test.ts: SIGTERM real no Linux |
| API, consultas, cursor e reconciliação | interfaces/http, persistence/queries | http.test.ts, persistence.test.ts |
| Taxonomia de erros e lock transitório | api-error.filter, respostas financeiras | http.test.ts: 503 com lock real e retry seguro |
| Logs, correlationId e métricas | telemetry, instrumented-wagering | http.test.ts; relatórios de carga |
| Migrations reversíveis | três migrations explícitas e migrate CLI | persistence.test.ts; up/down/up em banco descartável |
| Inicialização do zero | Compose isolado jungle-release-check | reports/release-check.md |
| Experimento de carga reproduzível | scripts/load.ts, profile tools | reports/load-latest.json e load-scaled.json |
| Instruções e decisões | README, ARCHITECTURE, API | demonstração executada usando os comandos documentados |
| CI | .github/workflows/ci.yml | Configurada; execução GitHub pendente do próximo push |
| Auth por IdP externo | ProviderIdentityPort | Adiada conforme permitido; adaptador de desenvolvimento não autentica |

Os arquivos de testes citados ficam em tests/unit ou tests/integration. Caminhos de implementação partem de src.

Limites: não foi executado teste prolongado com histórico extenso nem indisponibilidade física completa do PostgreSQL. Falhas de publicação são injetadas, e as janelas de crash encerram processos reais. Não há autenticação externa, garantia exactly-once no broker, contabilidade de partidas dobradas ou durabilidade de filas do emulador após seu reset. A janela de drenagem da carga é limitada e relata eventos restantes sem escondê-los. Ver ARCHITECTURE.md.
