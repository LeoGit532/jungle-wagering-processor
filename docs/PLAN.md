# Plano e andamento

- Dia 1: estrutura, dominio, PostgreSQL/MikroORM, migrations e constraints - concluido e registrado nas revisoes 001 a 003.
- Dia 2: API financeira, hash canonico, SQS, inbox/outbox, referencias, concorrencia e execucao em containers - implementado e validado nas revisoes 004 e 005.
- Dia 3: auditoria contra o README do desafio, revisar limites/modelagem de Inbox/Outbox, falhas e shutdown, documentacao final, execucao do zero e ensaio de apresentacao. Resolver qualquer divergencia encontrada antes da entrega.

Estado: 65 testes aprovados; validacao da suite em container tambem sera registrada ao concluir. Nao houve entrega externa.

Meta de envio: 23/10/2026 ate 18h. Prazo conservador estimado: 24/10 as 10h27, assumindo 72h desde o e-mail de 21/10 as 10h27. Confirmar data nos cabecalhos antes de depender desse limite.

Validacao Linux concluida: docker compose --profile test run --rm tests aprovou os 65 testes; verificacao de tipos pelo mesmo servico aprovada. API, PostgreSQL e LocalStack saudaveis no Compose.

Revisao 006: todo o codigo e testes revisados quanto a nomes, responsabilidades e formatacao. Pendencias funcionais da auditoria do Dia 3 permanecem separadas dessa refatoracao.
