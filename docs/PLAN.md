# Plano e andamento

- Estrutura, domínio, PostgreSQL/MikroORM e migrations: concluídos.
- API, SQS, inbox/outbox, referências e concorrência: concluídos.
- Auditoria, testes de recuperação, demonstração, carga e inicialização do zero: concluídos localmente.
- Documentação: README, arquitetura, API, matriz de requisitos, análise de carga e diagramas disponíveis no repositório.

Evidência Linux: 81 testes, 261 asserções, zero falhas. Demonstração também executada pelo candidato. Dois ensaios de 2.000 pedidos HTTP com saldos reconciliados e sem erros inesperados; limites da publicação documentados em PERFORMANCE.md.

CI aprovada para o commit 130b91a. Alterações posteriores devem ser publicadas e ter sua própria execução conferida. Registros de acompanhamento permanecem locais, fora do versionamento.

Antes da entrega: revisar o diff, publicar a versão final, conferir CI e acesso ao repositório, ensaiar PRESENTATION.md e preencher o formulário. A submissão ao recrutador ainda não foi confirmada.

Meta sugerida: 23/10/2026 até 18h. Limite conservador estimado: 24/10 às 10h27, assumindo 72h desde o e-mail de 21/10 às 10h27. Confirmar data nos cabeçalhos antes de depender desse limite.