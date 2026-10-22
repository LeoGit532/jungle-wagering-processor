# Atualizacao 003 - PostgreSQL e persistencia transacional

Data: 21/10/2026.

## Mudancas

MikroORM 6.6.17, schema e migration reversivel; WagerStore com abertura, lock por wallet, idempotencia persistente, snapshot de replay e gravacao atomica de ledger/inbox/outbox. Eventos de integracao com subclasses concretas. bun.lock gerado em container Linux.

## Evidencias

- 8 testes reais PostgreSQL aprovados, 26 assercoes.
- Abertura contabilizada com saldo reconstruido pelo ledger.
- Duplicidade de wallet, saldo negativo e alteracao de saldo sem ledger rejeitados no banco.
- Ledger rejeita UPDATE e DELETE.
- Duas apostas de 80 sobre 100: uma processada, uma rejeitada, saldo 20, um debito.
- 50 reenvios paralelos: apenas um processamento; replay preserva saldo original mesmo depois de nova movimentacao; payload divergente conflita.
- Inbox redelivery e conflito de hash.
- Falha injetada na outbox desfaz inbox, wallet, transacao e ledger.
- Migration up/down/up validada em banco temporario isolado.

Os testes iniciais identificaram um erro de trigger ao resolver campos diferentes entre wallet e ledger. A condicao foi corrigida com blocos IF separados e a suite passou depois da correcao.

## Ambiente

Docker Desktop falhou por sockets temporarios inacessiveis. Pasta C:/Users/leand/AppData/Local/Docker/run preservada como run-backup-challenge-20261021; pasta run recriada. Docker Engine 28.4.0 voltou a responder e PostgreSQL 17 iniciou. Nenhum reset de fabrica foi usado. Nao remover o backup sem necessidade.

Bun Windows continuou falhando ao substituir lockfile. Geracao com oven/bun:1.4.3 Linux concluiu com sucesso (202 pacotes). Validacao final frozen-lockfile e suite completa sera registrada abaixo.

## Revisao sugerida

1. Ler as garantias e limitacoes novas em ARCHITECTURE.md.
2. Revisar migrations/Migration202610210001.ts: CHECK, UNIQUE, FKs e triggers diferidos.
3. Revisar WagerStore: por que o lock vem antes da movimentacao e onde ocorre o commit.
4. Executar test:integration com Docker ativo.
5. Entender o teste de falha da outbox: evento e saldo nunca podem ser confirmados separadamente.

## Ainda pendente

API financeira e caso de uso com hash canonico, portas, validacoes HTTP e Auth extension; reprocessamento de referencias; SQS e publishers; metricas; testes com tres processos, crash e reinicio. Os testes paralelos desta etapa usam varias conexoes no mesmo processo, nao tres instancias. Persistencia base do Dia 1 pronta; desafio completo ainda nao.

## Validacao final
43 testes aprovados, zero falhas, 101 assercoes. Typecheck aprovado. bun install --frozen-lockfile --lockfile-only aprovado em container Linux com projeto montado somente para leitura. Persistencia e dominio do Dia 1 concluidos; API e mensageria seguem pendentes.
