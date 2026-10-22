# Jungle Gaming - Distributed Wagering Processor

Processador financeiro em Bun 1.4.3, TypeScript estrito, NestJS, PostgreSQL 17, MikroORM 6.6.17 e SQS via LocalStack.
Desafio: https://github.com/junglegaming/backend-challenge

## Subir com Docker

Requisito: Docker Desktop com engine Linux e Compose.

    docker compose build api
    docker compose up -d api

O Compose inicia PostgreSQL e LocalStack, aplica migrations em um servico separado e sobe a API com os workers. Nao depende de Bun instalado no host. A API fica em http://localhost:3100; health: /health/live e /health/ready. API_PORT altera a porta publicada; a interna e 3000.

Para tres instancias de processamento (API com workers + dois workers adicionais):

    docker compose --profile scaled up -d --scale worker=2 api worker

Para parar mantendo dados: docker compose down. O volume postgres-data preserva o banco. Nao use down -v se quiser manter o historico.

## Testes e tipos em containers

Depois do build da API:

    docker compose --profile test run --rm tests
    docker compose --profile test run --rm tests bun run typecheck

Os testes criam bancos wager_test_<uuid> e filas com prefixos exclusivos, usando PostgreSQL/LocalStack reais. O usuario de teste precisa de CREATEDB. Apenas os bancos/filas temporarios da suite sao removidos; o banco wagering da aplicacao nao e limpo. Os testes iniciam tres processos Bun reais e encerram abruptamente um worker apos commit, antes do ack.

## Desenvolvimento com Bun

    bun install --frozen-lockfile
    docker compose up -d postgres localstack
    bun run db:up
    bun run dev
    bun test tests/unit
    bun run test:integration
    bun run typecheck

Se a API do Compose estiver na porta 3100, o processo local continua usando PORT (default 3000). Pare o servico api se quiser evitar que seus workers consumam as mesmas filas durante depuracao local. WORKERS_ENABLED=false permite executar apenas HTTP.

Bun local nesta maquina: .tools/node_modules/.bin/bun.cmd (ignorado no Git). O Windows apresentou EINVAL ao substituir lockfile; bun.lock foi gerado com Bun Linux no Docker. A imagem executa install --frozen-lockfile durante o build.

## Endpoints

| Metodo | Rota | Finalidade |
|---|---|---|
| POST | /wallets | Criar carteira e abertura contabil |
| GET | /wallets/:id | Saldo e versao |
| GET | /wallets/:id/ledger?limit=50&cursor=... | Historico com cursor opaco |
| POST | /wallets/:id/reconciliation | Comparar saldo e ledger |
| POST | /wagering/transactions | Processar operacao com Idempotency-Key |
| GET | /wagering/transactions/:id | Consultar pelo ID interno |
| GET | /providers/:provider/wagering/transactions/:external | Consultar pelo ID externo |
| GET | /health/live | Liveness publica |
| GET | /health/ready | PostgreSQL e SQS |
| GET | /metrics | Metricas Prometheus por instancia |

Exemplos de contratos em docs/API.md. Identificadores playerId/walletId sao UUIDs. Dinheiro na borda exige string com duas casas, moeda BRL e ate 28 digitos inteiros. OPENING nao e aceito externamente. LOSS usa zero. Autenticacao externa nao foi integrada; ProviderIdentityPort e o ponto de extensao documentado em ARCHITECTURE.md.

## Filas

wager-transactions.fifo recebe WagerTransactionRequested. wager-transactions-dlq.fifo recebe falhas permanentes e tentativas esgotadas. wager-events.fifo recebe os eventos da outbox e nao alimenta o consumidor de solicitacoes. Os workers criam as filas no LocalStack, incluindo redrive policy.

## Configuracao

.env.example documenta as variaveis locais. Compose configura URLs internas de PostgreSQL/LocalStack. Fora de Docker, os defaults usam localhost:5432 e localhost:4566. Credenciais de exemplo sao apenas locais. Para conferir o ambiente: docker compose ps e docker compose logs api.

## Migrations

bun run db:up aplica migrations pendentes. bun run db:down reverte a ultima; pode remover dados ou falhar se dados existentes violarem as constraints antigas. Use reversao apenas em ambiente descartavel ou com backup. Nao use schema:update no lugar das migrations.

## Organizacao e revisao

src/domain contem regras independentes de framework; src/application contem contratos e caso de uso compartilhado; src/infrastructure contem persistencia, SQS, observabilidade e workers; src/interfaces/http contem a API NestJS.

Leia ARCHITECTURE.md para decisoes e limites, docs/reviews/004-api.md e 005-mensageria.md para revisar o Dia 2, docs/PLAN.md para o que falta e docs/DELIVERY.md para o envio. Nenhuma entrega externa foi feita.

## Padrao de codigo

Execute bun run format para aplicar a formatacao e bun run format:check para verifica-la. Os comandos cobrem src, testes e migrations. A revisao de legibilidade e responsabilidades esta registrada em docs/reviews/006-refatoracao.md.
