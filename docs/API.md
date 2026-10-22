# Contratos HTTP e SQS

Base local: http://localhost:3100.

## Criar wallet

POST /wallets

    {"playerId":"0192f28f-5dc0-7d58-bdb2-814ad6a0f4a1","initialBalance":{"amount":"100.00","currency":"BRL"}}

Resposta 201 com id, playerId, balance e version. Duplicidade de playerId/moeda: 409. Use o ID retornado no walletId das operacoes.

## Submeter aposta

POST /wagering/transactions
Header Idempotency-Key: provider-a:transaction-123

    {"providerId":"provider-a","externalTransactionId":"transaction-123","playerId":"0192f28f-5dc0-7d58-bdb2-814ad6a0f4a1","walletId":"UUID-RETORNADO","roundId":"round-1","gameId":"game-1","kind":"BET","money":{"amount":"25.00","currency":"BRL"}}

Resposta: transactionId, status, balance, idempotentReplay; failureCode quando rejeitada. Reenvio identico preserva o saldo da resposta original e retorna idempotentReplay=true. Mesma chave/payload divergente ou identificador externo reutilizado com outra chave: 409.

REFUND e ROLLBACK exigem referenceExternalTransactionId. Referencia ausente retorna 202 e e reprocessada pelo worker. WIN pode referenciar BET; LOSS deve carregar amount 0.00 e nao gera ledger. REFUND reverte BET; ROLLBACK reverte BET, WIN ou REFUND. Reversoes sao integrais e limitadas uma vez por tipo por referencia.

## Status e erros

| Status | Significado |
|---|---|
| 200 | Operacao processada/replay ou consulta concluida |
| 201 | Wallet criada |
| 202 | Referencia/processamento pendente |
| 400 | Payload, moeda, UUID, cursor ou header invalido/ausente |
| 404 | Wallet/transacao inexistente |
| 409 | Wallet duplicada ou conflito de idempotencia |
| 422 | Operacao registrada e rejeitada por regra de negocio |
| 503 | Dependencia indisponivel, timeout de lock ou erro transitorio reconhecido |
| 500 | Erro interno inesperado |

Erros de contrato: {error:{code},correlationId}. Rejeicoes de negocio usam a resposta financeira com status=REJECTED e failureCode. X-Correlation-Id e aceito e devolvido, ou gerado na ausencia. Nao ha autenticacao externa nesta versao.

## Ledger e reconciliacao

GET /wallets/:id/ledger?limit=50 retorna items e nextCursor. Reenvie nextCursor sem modifica-lo; ele e vinculado a wallet e usa timestamp com microssegundos + UUID. limite de 1 a 100. POST /wallets/:id/reconciliation retorna storedBalance, calculatedBalance, difference, consistent e checkedEntries; nunca corrige divergencia silenciosamente.

## SQS

Envelope enviado para wager-transactions.fifo:

    {"messageId":"msg-123","type":"WagerTransactionRequested","occurredAt":"2026-10-22T12:00:00.000Z","data":{"providerId":"provider-a","externalTransactionId":"transaction-123","idempotencyKey":"provider-a:transaction-123","playerId":"UUID-DO-PLAYER","walletId":"UUID-DA-WALLET","roundId":"round-1","gameId":"game-1","kind":"BET","money":{"amount":"25.00","currency":"BRL"}}}

MessageGroupId recomendado: walletId. Use deduplicationId distinto para testar redelivery real; garantia final e PostgreSQL, nao FIFO. A chave de inbox e (consumerName,messageId). Eventos publicados em wager-events.fifo usam eventId estavel e walletId como grupo; consumidores externos devem deduplicar eventId persistentemente.
