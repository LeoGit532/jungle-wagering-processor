# Atualização 007 — Auditoria final

Status: implementada e validada localmente em Linux em 22/10/2026. Os registros 001 a 006 descrevem estados anteriores; as pendências funcionais resolvidas nesta etapa estão discriminadas aqui.

## Mudanças

- InboxMessage e OutboxMessage com transições explícitas, snapshots/payloads imutáveis e integração na persistência/publicação.
- Limite NUMERIC(30,2) no domínio e rejeição auditável de crédito acima da capacidade, sem alteração financeira.
- Migration reversível bloqueia TRUNCATE direto/cascata do ledger e versão incoerente com mudança de saldo.
- Registro terminal FAILED após esgotamento de falha de infraestrutura quando o banco permite; indisponibilidade do banco fica explícita no log e envelope da DLQ.
- Métricas de lock centralizadas para HTTP/workers; backlog global da outbox; correlação propagada nos eventos de resultado.
- Publisher processa até 25 eventos por ciclo; preserva lock, commit posterior ao envio e eventId estável.
- TypeScript verifica também locais/parâmetros não utilizados; formato e finais de linha padronizados.
- CI Docker configurada para build congelado, formato, tipos e suíte completa; execução no GitHub ainda pendente de push.

## Verificação

Build Linux aprovado, migrations up/down/up em banco temporário, 81 testes aprovados, 261 asserções, zero falhas. Cenários novos incluem overflow, TRUNCATE/cascade, versão, refunds concorrentes, LOSS, modelos de mensagens, crash nas duas janelas da outbox, assinante deduplicando evento e SIGTERM durante operação. Teste HTTP com lock PostgreSQL real comprova 503 e retry seguro da mesma chave.

```sh
docker compose build api
docker compose --profile test run --rm tests
docker compose --profile test run --rm tests bun run typecheck
docker compose --profile test run --rm tests bun run format:check
```

A matriz completa fica em ../AUDIT.md. Demonstração, carga e inicialização limpa estão na revisão 008 e ../reports. As verificações não demonstram capacidade de produção, indisponibilidade física completa do banco ou autenticação externa.

## Para revisar pessoalmente

Leia Money/apply-wager, o fluxo transacional de WagerStore, Consumer/OutboxPublisher e resilience.test.ts. Execute a demonstração e use ../PRESENTATION.md para explicar as garantias e seus limites. As alterações estão locais; commit/push e entrega continuam manuais.
