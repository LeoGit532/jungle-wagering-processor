# Contribuir com o projeto

## Encontrar a responsabilidade correta

- Domínio: valores, invariantes e transições financeiras, sem NestJS, ORM ou SQS.
- Aplicação: validação de entrada, casos de uso e portas. Contratos públicos têm tipos explícitos; dados externos começam como unknown.
- Infraestrutura: persistência, filas e workers. Transportes diferentes chamam o mesmo caso de uso.
- HTTP: traduz contrato e resposta; não recalcula saldo nem replica regras financeiras.

Use o mapa em docs/diagrams/arquitetura.html para localizar os arquivos e docs/AUDIT.md para encontrar os testes de cada garantia.

## Alterar código que outra pessoa vai manter

Prefira nomes do domínio e funções com uma responsabilidade. Extraia uma etapa quando ela tiver uma intenção própria, como reivindicar evento ou agendar retry; não crie camadas para chamadas triviais. Use guard clauses e blocos explícitos em condicionais/loops. Comentários devem explicar uma decisão ou garantia que o código sozinho não evidencia.

Valide entradas antes de estreitar tipos. Não use as para transformar uma string externa em tipo financeiro sem validação. Estados e códigos financeiros usam as uniões do domínio; os formatos das consultas ficam em application/ports/financial-queries.ts. Reutilize parseWagerRequest para o envelope SQS e queue-policy.ts para a política compartilhada por broker/consumidor.

Mantenha o tratamento de erros intencional: rejeição de negócio é resultado persistido; falha de infraestrutura faz rollback e pode permitir retry. Um catch que continua o processamento precisa de justificativa, registro operacional e recuperação definida. Não registre o corpo financeiro completo nos logs.

## Preservar as garantias financeiras

Money usa centavos bigint e strings decimais; nunca number para aritmética financeira. Decisão de saldo exige lock da wallet. Saldo, transação, ledger, inbox e outbox confirmam atomicamente; ack só após commit. Outbox marca publicação após envio e pode repetir eventId. Não desabilite constraints/triggers para tornar um teste ou benchmark mais rápido.

Não edite migrations já aplicadas para alterar schema: acrescente uma migration reversível e valide em banco descartável. Nunca execute down -v sobre dados que precisam ser preservados.

## Verificar antes de propor uma mudança

Com Bun e dependências instaladas:

```sh
bun install --frozen-lockfile
bun run check
```

check executa formato, TypeScript e testes unitários. Para uma mudança que afete domínio persistido, HTTP, filas ou workers, faça também a verificação real em containers:

```sh
docker compose build api
docker compose --profile test run --rm tests
```

Os testes usam bancos e filas temporários exclusivos. Não substitua integração por mocks nos cenários de concorrência, commit/ack ou crash de processo. Acrescente teste quando mudar comportamento ou extrair uma fronteira com risco de regressão; não escreva testes que só repetem a implementação.

## Revisar em equipe

Mantenha o diff focado. Descreva o problema, o comportamento final e as verificações executadas. Aponte efeitos em contratos, migrations, ordem de locks, idempotência e recuperação. Separe alterações independentes em commits quando isso facilitar a revisão. Aguarde a CI do commit que será integrado.

.editorconfig e Prettier mantêm o formato entre editores; bun.lock fixa as dependências. Registros pessoais em docs/reviews, roteiros e arquivos .env permanecem fora do versionamento. Não publique credenciais ou dados reais nos exemplos.
