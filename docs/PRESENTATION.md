# Apresentação técnica — roteiro de 5 a 7 minutos

Use como roteiro de estudo; execute a demonstração e confira as decisões no código antes da entrevista.

## 1. Problema e execução (um minuto)

A mesma aposta pode chegar por HTTP ou SQS, ser duplicada ou disputar saldo. O projeto compartilha um caso de uso e confirma cada efeito financeiro no PostgreSQL. Mostre README, readiness e o comando de demonstração.

## 2. Dinheiro e transação (um minuto)

Abra Money e apply-wager: centavos bigint, strings decimais, moeda e capacidade explícitas. Abra WagerStore: lock por wallet e confirmação conjunta de transação, saldo, ledger, inbox e outbox. Explique por que duas apostas de 80 sobre saldo 100 não podem ambas debitar. Carteiras independentes não usam lock global.

## 3. Repetição e entrega (um minuto)

Idempotência é regra de negócio persistida: chave + hash canônico e resposta original. Inbox deduplica a entrega do envelope; são problemas diferentes. Outbox impede publicar uma mudança financeira que sofreu rollback. Depois do envio, um crash ainda pode duplicar evento; eventId estável e dedup persistente no assinante resolvem o efeito duplicado.

## 4. Evidência de falhas (um a dois minutos)

Mostre resilience.test.ts: encerramento após commit antes de publicar; encerramento após publicar antes de marcar; SIGTERM durante uma operação. Mostre processes.test.ts: três runtimes Bun reais. A demonstração verifica saldo e ledger, além de respostas HTTP. Uma falha transitória de lock retorna 503; a mesma chave pode ser repetida com segurança.

## 5. Medidas e decisões (um minuto)

Mostre os dois relatórios de carga. Uma wallet serializa: aproximadamente 204 req/s no ensaio base; dez wallets, 534 req/s. Não extrapole para produção. Um publisher deixou 1.467 eventos após 15s; três drenaram em cerca de 9s. Mais workers ajudam a saída, mas competem por CPU/banco e não removem a serialização da mesma wallet. O segundo ensaio teve HTTP mais lento em alguns cenários.

## Perguntas para ensaiar

- Por que não usar number? Frações decimais financeiras não têm representação binária exata; bigint e strings evitam arredondamento implícito.
- Por que lock e constraints? Lock serializa decisões de saldo; constraints protegem unicidade e invariantes contra outros caminhos de escrita.
- O que acontece se o processo cair após commit e antes do ack? Redelivery encontra estado persistido e não repete o movimento.
- E depois de enviar um evento? Pode duplicar. O teste força esse caso e deduplica por eventId em tabela do assinante.
- E se a referência chegar depois? Estado pendente e agenda persistida; expiração/tentativas impedem espera infinita.
- O que ficou de fora? Auth externa, carga prolongada e histórico extenso; o emulador local não conserva filas entre resets. São limites documentados.
- O que você melhoraria com mais tempo? Medir o custo da soma do ledger em wallets antigas, agregar métricas de todas as instâncias, estudar publicação em lote mantendo garantias e integrar IdP externo.
- Como usou IA? Descreva com precisão a assistência recebida em implementação, refatoração, testes e documentação; explique quais decisões e comportamentos você revisou e consegue demonstrar. Não atribua a si verificações que não realizou.
