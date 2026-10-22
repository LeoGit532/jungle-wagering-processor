# Arquitetura e decisoes

## Estado atual

Dia 2 implementado: dominio, persistencia, API financeira, SQS, inbox/outbox, retry de referencias e observabilidade basica. 65 testes aprovados, 199 assercoes, tanto no Windows quanto em container Linux; typecheck aprovado. O sistema roda localmente pelo Compose. A auditoria final do desafio e os limites abaixo ainda fazem parte do Dia 3.

## Responsabilidades

src/domain nao depende de NestJS ou ORM. Money, Wallet, ledger, WagerTransaction e eventos encapsulam estado/regras. Factories create/open/from e rehydrate separam validacao de criacao de reconstrucao de estado persistido. Datas de estado sao strings ISO para evitar mutacao indireta de Date.

Wagering e o caso de uso compartilhado por HTTP e SQS, com WageringPort e ProviderIdentityPort. Contratos da borda validam UUIDs, valores monetarios e campos permitidos antes de construir objetos de dominio. createApplication e a composicao NestJS. Infraestrutura contem PostgreSQL, queries, SQS e loops de workers.

## Dinheiro e contratos

Money e imutavel e usa bigint em centavos. Nao usa number para valores financeiros. Somar/subtrair retorna outra instancia; moeda diferente gera erro. Valores negativos so surgem internamente por subtract/negate, por exemplo na diferenca de reconciliacao. Contratos externos exigem string decimal com exatamente duas casas e BRL; o dominio suporta outras moedas e o conflito e testado. Nenhum arredondamento silencioso e feito.

Persistencia usa NUMERIC(30,2), lido como string e reidratado para Money. MikroORM 6.6.17 usa EntitySchema separado para WalletRow; a Unit of Work atualiza a wallet. Ledger/transacoes/inbox/outbox usam SQL parametrizado do mesmo EntityManager. A migration explicita guarda constraints e triggers que nao cabem no mapeamento simplificado. Nao executar schema:update no lugar das migrations.

Interpretacoes adicionais: movimentos BET/WIN/REFUND/ROLLBACK exigem valor positivo; LOSS exige zero. WIN/LOSS com referencia devem apontar para BET. Uma transacao terminal nao muda de estado; PENDING e PENDING_REFERENCE podem concluir, rejeitar, falhar ou continuar aguardando.

## Transacao SQL e concorrencia

Cada operacao usa em.fork().transactional(), lock pessimista SELECT FOR UPDATE por wallet, lock_timeout de 5s e statement_timeout de 15s. Wallets distintas podem progredir em paralelo. Nao ha lock global nem deduplicacao financeira em memoria.

Abertura positiva grava wallet, OPENING interno, ledger CREDIT e outbox na mesma transacao, com version=1. Abertura zero nao gera ledger. Movimentacao grava a transacao, altera saldo/versao, insere ledger, marca inbox quando houver e enfileira eventos atomicamente. Ack SQS somente apos o caso de uso retornar, portanto apos commit.

Schema protege wallet unica por player/moeda, saldo nao negativo, chave idempotente unica, identificador externo unico por provedor, lancamento unico por transacao/wallet e reversao unica por referencia/tipo quando processada. Ledger tem CHECK de aritmetica e FK composta para moeda/wallet/transacao. Triggers bloqueiam UPDATE/DELETE do ledger e mudanca de transacao terminal. Constraint triggers diferidos conferem no commit saldo agregado versus ledger, quantidade de lancamentos por transacao e valor/moeda da transacao. Transacao rejeitada por conflito de moeda pode ser auditada; apenas PROCESSED exige moeda igual a wallet.

Custo conhecido: trigger de reconciliacao soma historico por wallet em cada transacao. Favorece correção neste timebox e precisa medicao em historicos grandes. Nao comprova continuidade cronologica de cada balanceBefore/balanceAfter, apenas aritmetica individual e saldo agregado. Administradores podem desabilitar triggers; privilegios de producao precisam ser segregados. TRUNCATE ainda merece endurecimento na revisao final.

## Idempotencia e replay

Header HTTP Idempotency-Key e obrigatorio e nao entra no payloadHash. JSON canonico ordena recursivamente as chaves dos campos de negocio validados, preserva arrays e strings decimais; SHA-256 produz o hash. UUIDs sao normalizados para minusculas. Campos desconhecidos sao rejeitados.

A mesma chave e hash retornam transactionId e resposta financeira persistida com idempotentReplay=true. O saldo da resposta nao e recalculado pelo saldo atual. Outra chave reutilizando a identidade externa, ou mesma chave com payload divergente, gera conflito. Constraints SQL resolvem disputas entre instancias. O estado de entrada e copiado para que um rollback de infraestrutura nao deixe o objeto do chamador terminal.

Inbox deduplica por consumerName/messageId e confere hash do envelope completo. Tanto inbox quanto idempotencia de negocio sao necessarios: mensagens diferentes podem solicitar a mesma transacao, e uma mensagem pode ser entregue mais de uma vez.

## Referencias e reversoes

Referencia e resolvida por providerId/externalTransactionId e validada por wallet, player, moeda e rodada. Ausente ou ainda nao terminal: PENDING_REFERENCE. Rejeitada/falha: REFERENCE_REJECTED. REFUND so reverte BET; ROLLBACK reverte BET, WIN ou REFUND. Reversao exige valor integral e unicidade por tipo. Reversao de credito que produziria saldo negativo registra REVERSAL_INSUFFICIENT_FUNDS, distinto de INSUFFICIENT_FUNDS para aposta.

Worker persiste reference_attempts e next_reference_at e usa relogio do PostgreSQL. Backoff exponencial de 2s com teto de 1h, dez tentativas ou TTL de 24h (o que ocorrer antes). O limite de dez tentativas cobre atrasos curtos e impede pendencias indefinidas; o TTL evita reativar referencias muito antigas apos indisponibilidade prolongada. Esgotamento gera REFERENCE_NOT_FOUND e evento de rejeicao. Dois workers reavaliam estado/due sob lock da wallet, impedindo aplicacao duplicada. Repetir espera nao emite outro evento pending.

## Filas e outbox

SQS FIFO e otimizacao de ordenacao, nao garantia final. Entrada wager-transactions.fifo, DLQ wager-transactions-dlq.fifo e saida wager-events.fifo sao separadas. SDK usa endpoint configurado, inclusive quando a QueueUrl retornada pelo LocalStack usa hostname diferente.

Consumidor recebe uma mensagem por poll, com visibilidade de 30s e heartbeat a cada 10s. Erro de negocio e terminal e recebe ack; payload/conflito permanente vai a DLQ; infraestrutura transitoria recebe backoff 2^tentativa (maximo 60s). A quinta entrega falha vai a DLQ, com redrive policy tambem configurada. Se publicar na DLQ falhar, nao ocorre ack. Mensagem permanece recuperavel. Falha enquanto banco esta indisponivel nao grava FAILED nesse banco; o envelope e preservado na DLQ para analise/reprocessamento.

Publisher usa FOR UPDATE SKIP LOCKED para um item devido, segura o lock durante envio ao SQS e marca published_at somente depois do sucesso. Falha agenda retry exponencial com teto de 60s; nao ha descarte automatico de eventos confirmados. Multiplos publishers podem progredir sem reivindicar o mesmo item. Se o processo morrer depois do envio e antes do commit da publicacao, pode haver duplicata; eventId e estavel e o consumidor externo deve deduplicar persistentemente. FIFO dedup ajuda por tempo limitado. O sistema nao promete exactly-once no broker.

Eventos concretos: WagerTransactionProcessed, WagerTransactionRejected, WagerTransactionPendingReference e WalletBalanceChanged; valores monetarios no envelope sao MoneyProps. Nao ha publicacao antes do commit financeiro.

## HTTP e observabilidade

API usa 400 para contrato invalido, 404 para recurso inexistente, 409 para conflito, 422 para rejeicao financeira, 202 para pendente e 503 para falhas transitorias reconhecidas. Consultas retornam 200 e criacao da wallet 201. Erro inesperado permanece 500.

Ledger usa cursor opaco vinculado a wallet, ordenado por created_at com microssegundos e id. Limit de 1 a 100. Reconciliacao le saldo e soma sob lock, devolve diferenca, emite log/metrica em divergencia e nao corrige silenciosamente.

Logs JSON com correlationId e identificadores disponiveis, sem payload financeiro completo. X-Correlation-Id e validado ou gerado; consumidor SQS usa messageId como correlacao. Metricas Prometheus por instancia cobrem status, duplicatas, retries, DLQ, conflitos de lock HTTP, outbox lag e latencia. Metricas reiniciam com o processo e nunca sao garantia de idempotencia. Lag observado e o do item reivindicado; nao e uma consulta global instantanea da fila inteira.

Liveness publica informa processo vivo. Readiness verifica PostgreSQL e as filas SQS. Autenticacao externa foi adiada conforme permitido pelo desafio, priorizando correção financeira. DevelopmentProviderIdentity e no-op deliberado; ProviderIdentityPort pode receber validacao OIDC por IdP externo e verificacao do provider no token. Sem tabela artesanal de senhas.

## Execucao, shutdown e validacao

Compose faz build de uma imagem compartilhada, aplica migrations em servico separado e sobe a API com os loops de consumo, outbox e referencias. Profile scaled acrescenta workers sem porta HTTP. Profile test executa a suite em Linux com dependencies congeladas, bancos e filas temporarios. API local usa porta 3100 (configuravel por API_PORT), preservando o processo que ja ocupava 3000 nesta maquina.

SIGTERM/SIGINT interrompem novos polls e aguardam o trabalho em andamento antes de fechar broker/ORM. Compose concede 45s. Long polling e timeout SDK/SQL limitam esperas usuais. Ainda falta o teste especifico de sinal durante uma operacao em andamento.

Testes comprovam races de saldo, 50 duplicatas paralelas, tres processos reais, wallets distintas, inbox/redelivery, concorrencia de publishers, referencias fora de ordem/expiradas, falha injetada na outbox com rollback financeiro e worker encerrado abruptamente depois do commit antes do ack. Reabrir a conexao apos a falha preservou reconciliacao. O experimento de carga e outros pontos de crash da outbox ainda nao foram executados.

## Pendencias da auditoria final

Adicionar/revisar classes de dominio InboxMessage e OutboxMessage (hoje representadas por schema/servicos), tratar limite de saldo NUMERIC no dominio/borda, endurecer TRUNCATE, ampliar teste de shutdown e janela de falha da outbox, rever metricas em todos os caminhos e conferir cada requisito do README. A reversao da segunda migration pode exigir ambiente descartavel se houver rejeicoes em moeda diferente, pois o schema antigo era mais restritivo. Nenhum deploy externo nem envio de teste foi feito.

## Revisao estrutural 006

Composicao NestJS em src/bootstrap, portas em application/ports, adaptadores HTTP separados por responsabilidade, cursor isolado das consultas e metodos nomeados para cada etapa transacional. DomainError e WalletLedgerEntry possuem modulos dedicados. Formato de dados e regras foram preservados; a evidencia e a mesma suite de caracterizacao/integracao/concorrencia.
