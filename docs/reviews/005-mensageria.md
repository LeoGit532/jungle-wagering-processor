# Atualizacao 005 - SQS, workers e concorrencia

Data: 22/10/2026.

## Mudancas

SDK AWS SQS 3.1155.0, filas FIFO separadas de entrada/DLQ/eventos, redrive policy, consumidor com o mesmo Wagering da API, ack apos commit e heartbeat de visibilidade. Erros permanentes vao a DLQ; transitorios recebem backoff e no maximo cinco entregas antes da DLQ.

Publisher usa SELECT FOR UPDATE SKIP LOCKED e publica fora da transacao financeira, marcando published_at apenas apos sucesso do SQS. Lock mantido durante a publicacao do item. Falha agenda retry exponencial; crash entre envio e commit pode duplicar evento e exige deduplicacao por eventId no consumidor externo.

Referencias usam tentativas persistentes e next_reference_at, relogio do PostgreSQL, backoff de 2s ate 1h, limite dez tentativas ou TTL de 24h, o que ocorrer primeiro. Esgotamento registra REFERENCE_NOT_FOUND e evento de rejeicao. Repetir tentativa pendente nao publica outro evento pending. Encerramento para novos polls e aguarda as operacoes em andamento antes de fechar o ORM.

Logs JSON com correlacao e identificadores; metricas Prometheus de status, duplicatas, retries, DLQ, lock, outbox lag e latencia. Compose com migration separada, API, workers adicionais opcionais e teste isolado em container.

## Evidencias

65 testes aprovados em oito arquivos, 199 assercoes. Inclui PostgreSQL e SQS reais, cinco entregas reais antes da DLQ (backoff antecipado no teste via ChangeMessageVisibility), dois publishers, referencia fora de ordem, backoff, expiracao, tres processos Bun independentes, wallets distintas e crash de worker depois do commit antes do ack. Nova conexao ORM apos o crash reconstruiu o mesmo saldo pelo ledger.

Smoke em containers: API saudavel em localhost:3100; duas apostas de 80 disputaram saldo 100, uma foi rejeitada; ganho 10 chegou pelo SQS e saldo final reconciliou em 30.00. A porta 3000 estava ocupada por outro processo e foi preservada.

## Revisao

1. messaging/sqs.ts: filas, timeout e endpoint.
2. workers/consumer.ts: por que ack vem depois do caso de uso.
3. workers/outbox.ts: janela de duplicacao e claim concorrente.
4. WagerStore.retryReference: lock, agendamento e expiracao.
5. tests/integration/processes.test.ts: barreira de inicio de tres processos e falha abrupta.
6. Dockerfile e compose.yaml: build reproduzivel e execucao local.

## Limites para revisar no Dia 3

Nao foi executado teste de carga nem validacao de todos os pontos de crash da outbox. O encerramento gracioso tem implementacao, mas falta teste especifico com sinal durante operacao em andamento. Outbox/Inbox usam schema/servicos; ainda nao existem classes de dominio dedicadas. Auth externa nao integrada. Metricas sao por processo e reiniciam com ele; nao sao usadas para garantias financeiras. Worker esgotado enquanto PostgreSQL esta fora preserva a mensagem na DLQ, sem gravar FAILED num banco indisponivel. Essas limitacoes precisam constar da entrega final.

Validacao adicional: suite executada dentro do container Linux com dependencias do build congeladas; 65 testes aprovados, 199 assercoes e typecheck aprovado.
