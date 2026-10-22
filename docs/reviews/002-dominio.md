# Atualizacao 002 - Money e regras financeiras

Data: 21/10/2026. Status: implementacao de dominio validada; persistencia ainda pendente.

## O que mudou

- Money imutavel com centavos bigint, entrada decimal e JSON com duas casas.
- Wallet com debit/credit, versionamento e geracao de ledger balanceado.
- Ledger com estado congelado e verificacao de aritmetica.
- WagerTransaction com factories, snapshots e transicoes explicitas.
- applyWager: BET, WIN, LOSS, REFUND e ROLLBACK, referencias ausentes, reversao parcial, referencia invalida e saldo insuficiente para reversao.
- Bun 1.4.3 instalado localmente em .tools, ignorado no Git; script test adicionado.

## Verificacoes executadas

- Bun: 35 testes aprovados, zero falhas; 75 assercoes em tres arquivos.
- TypeScript: bun run typecheck aprovado.
- bun install: dependencias disponiveis para testes e typecheck, mas encerrado com erro EINVAL/NtSetInformationFile ao substituir o lockfile. Nova tentativa com --lockfile-only teve o mesmo erro. Lockfile ainda nao confirmado como gerado e valido. Resolver antes da entrega.
- PostgreSQL, SQS, API em execucao e concorrencia real nao foram testados nesta etapa.

## Como repetir neste computador

Runtime local: .\.tools\node_modules\.bin\bun.cmd
Executar: bun.cmd test tests/unit e bun.cmd run typecheck, usando o caminho completo acima enquanto Bun nao estiver no PATH.

## Roteiro de revisao

1. src/domain/money.ts: por que bigint evita erros como 0.1 + 0.2 e como os centavos viram JSON.
2. src/domain/wallet.ts: como um debito rejeitado preserva saldo e versao.
3. src/domain/wager-transaction.ts: quais estados sao terminais.
4. src/domain/apply-wager.ts: como uma referencia ausente aguarda e como um rollback de ganho pode falhar por saldo.
5. tests/unit: executar e relacionar cada cenario com uma regra do desafio.

## Limites e proxima etapa

Ainda nao ha idempotencia persistente, protecao de concorrencia, OPENING persistido, eventos de integracao, inbox/outbox ou migrations. O estado em memoria nao substitui constraints SQL. Fechar eventos e hash canonico, implementar schema/MikroORM e resolver lockfile antes da etapa de API.
