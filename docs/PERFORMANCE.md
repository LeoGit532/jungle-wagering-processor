# Demonstração e análise de carga

## Demonstração

`docker compose --profile tools run --rm tools bun run demo` passou pelas duplicatas paralelas, conflito de hash, disputa por saldo, referência fora de ordem, entrada SQS, reconciliação e quatro testes de recuperação. Evidência: reports/demo-latest.json e .md.

Foi repetida com banco vazio em projeto Compose isolado, incluindo migrations e criação de filas; veja reports/release-check.md. Dados existentes da aplicação foram preservados.

## Experimento de carga

Ambiente: Bun 1.4.3, Linux x64/WSL2, i7-13650HX, 20 CPUs lógicas visíveis, aproximadamente 7,6 GiB de RAM disponíveis à VM. Cada execução fez quatro cenários sequenciais de 500 pedidos HTTP, concorrência 20; criação de wallets fora da medição. Percentis nearest rank incluem resposta/JSON; cinco chamadas readiness de aquecimento não equivalem a aquecimento financeiro prolongado.

| Cenário | req/s com 1 instância | p95 ms | req/s com 3 instâncias | p95 ms |
|---|---:|---:|---:|---:|
| Uma wallet | 204,1 | 131,4 | 175,5 | 169,0 |
| Dez wallets | 534,3 | 51,1 | 499,1 | 51,0 |
| Replay idempotente | 491,0 | 47,8 | 438,2 | 53,0 |
| Saldo insuficiente | 355,8 | 68,7 | 362,9 | 64,0 |

Nas duas execuções: zero erros inesperados, zero timeouts/conflitos de lock observados no contador da API, todas as wallets reconciliadas. No cenário de saldo insuficiente, 499 respostas 422 são rejeições esperadas; no replay, 499 repetições tiveram apenas uma aplicação. Os JSONs preservam p50/p95/p99, códigos HTTP, ambiente e metodologia completos.

| Saída assíncrona | 1 instância | 3 instâncias |
|---|---:|---:|
| Pico amostrado de eventos pendentes durante carga | 2.418 | 1.607 |
| Pico amostrado de lag durante carga | 5,52 s | 3,81 s |
| Pendentes após observação de drenagem | 1.467 | 0 |
| Janela de drenagem observada | 15,20 s | 9,03 s |

A execução base evidenciou que a publicação individual da outbox não acompanhou a entrada no curto intervalo. Aumentar de um para três publishers drenou o backlog dentro da observação, mas não aumentou a taxa HTTP; houve competição por recursos. Um lock por wallet continua necessário e serializa o cenário concentrado.

A segunda execução acrescentou dois workers à API, sem réplicas HTTP; portanto não mede escala horizontal HTTP. Experimentos foram sequenciais, em máquina compartilhada, com histórico crescente e sem repetições estatísticas. Não atribuir toda variação à topologia nem extrapolar um fator de ganho. A carga mede contadores de uma API e backlog global PostgreSQL, não agrega métricas de todos os workers. Picos foram amostrados a cada 500ms durante requisições; lag final é posterior à janela de drenagem.

Próxima investigação: histórico extenso na trigger de soma, limites do pool/broker e publicação em lote mantendo recuperação. Não remover invariantes para elevar um número de throughput.

Relatórios: reports/load-latest.json, load-latest.md, load-scaled.json e load-scaled.md. Cada execução sobrescreve somente o nome de relatório escolhido.
