# Atualizacao 006 - Revisao de todo o codigo

Data: 22/10/2026. Escopo: todos os arquivos TypeScript de src e tests, incluindo migrations, fixtures de subprocessos e inicializacao.

## Referencias consultadas

- Robert C. Martin, Codigo Limpo: trechos de nomes significativos e funcoes (paginas impressas 19-20, 35-36 e 39-40; paginas 50-51, 66-67 e 70-71 do PDF fornecido).
- Michael C. Feathers, Trabalho Eficaz com Codigo Legado: apresentacao, paginas viii-x (paginas 7-9 do PDF escaneado), sobre apoio dos testes e mudancas graduais.

Foram consultados trechos especificos dos arquivos fornecidos, nao os livros completos. Nenhum texto ou exemplo de codigo dos livros foi incorporado ao projeto. Os PDFs e as imagens de consulta nao fazem parte da entrega.

## Revisao aplicada

- Prettier 3.6.2 fixado, configuracao unica e comandos format/format:check, cobrindo codigo, testes e migrations.
- applyWager separado em fluxo principal, validacao da wallet, identidade da referencia e validacao de reversao. Nomes transaction, wallet e reference substituem abreviacoes.
- WagerStore mantem a fronteira transacional, o EntityManager e o lock por wallet. Metodos nomeados isolam abertura, inbox, idempotencia, replay, aplicacao, ledger, eventos e retry.
- Portas e contratos de observacao ganharam arquivo proprio em application/ports/wagering.ts.
- Composicao NestJS movida para bootstrap; caso de uso permanece independente do framework.
- Controllers financeiros, health, filtro de erros e tokens separados. Codigos HTTP deixaram de depender de ternarios encadeados.
- Codificacao/validacao do cursor separada das consultas. SQL em varias linhas e mapeamento de respostas com nomes explicitos.
- Consumidor separa envelope, processamento, classificacao de falha, DLQ e heartbeat. Runtime separa polling do controle de encerramento.
- DomainError e WalletLedgerEntry ganharam modulos proprios, preservando exportacoes anteriores quando necessario.
- Nomes abreviados revisados tambem nos testes, observabilidade, filas e publishers. Foram renomeados 69 simbolos com referencias verificadas pelo TypeScript.
- Migrations passaram de strings SQL escapadas para templates legiveis, preservando o SQL pela transformacao da arvore sintatica. A suite verifica up/down/up.
- Placeholders .gitkeep foram removidos das pastas que ja possuem implementacao.

## O que foi preservado

Rotas, JSON, status HTTP, hashes de negocio, regras de saldo, estados, ordem de validacao, locks, transacoes, retries e semantica de ack. Nao foram acrescentadas funcionalidades nem corrigidas silenciosamente as pendencias de auditoria do Dia 3. Refatoracao nao implica aprovacao final de todos os requisitos.

## Validacao

Antes das mudancas: 65 testes aprovados e 199 assercoes. Apos dominio/persistencia: os mesmos 65 testes aprovados. Typecheck aprovado nas etapas intermediarias. Validacao final de toda a revisao e execucao Linux sera registrada abaixo.

## Roteiro de revisao

1. Ler applyWager de cima para baixo e identificar a sequencia de decisao.
2. Ler submit do WagerStore e localizar a fronteira SQL; abrir os metodos privados conforme necessario.
3. Conferir consumer.handle para encontrar commit/ack e encaminhamento de falha.
4. Conferir application/ports e bootstrap para entender dependencias.
5. Executar bun run format:check, bun run typecheck e a suite completa.

## Inventario revisado

- src/main.ts
- src/worker.ts
- src/domain/money.ts
- src/domain/wallet.ts
- src/domain/wager-transaction.ts
- src/domain/apply-wager.ts
- src/domain/events.ts
- src/domain/errors.ts
- src/domain/wallet-ledger-entry.ts
- src/application/contracts.ts
- src/application/wagering.ts
- src/infrastructure/telemetry.ts
- src/infrastructure/instrumented-wagering.ts
- src/bootstrap/create-app.ts
- src/interfaces/http/api.ts
- src/interfaces/http/tokens.ts
- src/interfaces/http/financial.controller.ts
- src/interfaces/http/health.controller.ts
- src/interfaces/http/api-error.filter.ts
- src/application/ports/wagering.ts
- src/infrastructure/persistence/entities.ts
- src/infrastructure/persistence/orm.ts
- src/infrastructure/persistence/migrate.ts
- src/infrastructure/persistence/wager-store.ts
- src/infrastructure/persistence/queries.ts
- src/infrastructure/persistence/ledger-cursor.ts
- src/infrastructure/messaging/sqs.ts
- src/infrastructure/workers/outbox.ts
- src/infrastructure/workers/consumer.ts
- src/infrastructure/workers/runtime.ts
- src/infrastructure/persistence/migrations/Migration202610210001.ts
- src/infrastructure/persistence/migrations/Migration202610220001.ts
- tests/unit/money.test.ts
- tests/unit/wallet.test.ts
- tests/unit/wager.test.ts
- tests/unit/contracts.test.ts
- tests/integration/persistence.test.ts
- tests/integration/http.test.ts
- tests/integration/messaging.test.ts
- tests/integration/processes.test.ts
- tests/fixtures/process-worker.ts

## Resultado final
65 testes aprovados, zero falhas, 199 assercoes no Windows e no container Linux apos a revisao completa. format:check e typecheck aprovados nos dois ambientes. Build Linux com bun install --frozen-lockfile aprovado. Os cenarios de concorrencia, falha e migrations continuaram passando. API local atualizada com a imagem revisada; publicacao GitHub ainda nao realizada.
