# Verificação de inicialização limpa — 22/10/2026

Projeto Compose isolado: jungle-release-check. Usou novo volume jungle-release-check_postgres-data e portas PostgreSQL 55432, LocalStack 45566 e API 33100. Não reutilizou nem apagou o banco da aplicação principal.

Procedimento: build da imagem local com lockfile congelado, subir api e dependências no novo projeto, aplicar todas as migrations em banco vazio, aguardar readiness e executar a demonstração completa. Resultado: demonstração e quatro testes de recuperação aprovados. O relatório efêmero da repetição foi escrito em /tmp/fresh-release para preservar o relatório principal versionado.

A configuração temporária de portas ficou em .tools/compose.release.yaml (ignorada no Git). Para reproduzir, use um arquivo override com as portas acima e um nome de projeto distinto:

```sh
docker compose -p jungle-release-check -f compose.yaml -f .tools/compose.release.yaml up -d api
docker compose -p jungle-release-check -f compose.yaml -f .tools/compose.release.yaml --profile tools run --rm -e REPORT_DIR=/tmp/fresh-release tools bun run demo
```

Limpeza restrita ao projeto e volume descartáveis: mesmo comando Compose com down -v. A opção -v é apropriada somente para este banco de verificação vazio de dados pessoais, não para a aplicação principal.

Override reproduzível (crie o arquivo temporário antes dos comandos acima):

```yaml
services:
  postgres:
    ports: !override
      - '55432:5432'
  localstack:
    ports: !override
      - '45566:4566'
  api:
    ports: !override
      - '33100:3000'
```

A tag !override exige Compose 2.24.4 ou mais recente. A alternativa é configurar POSTGRES_PORT, SQS_PORT e API_PORT no ambiente e usar somente compose.yaml com o nome de projeto isolado.

Limpeza confirmada: containers, rede e volume do projeto jungle-release-check removidos. Os dois workers adicionais do ensaio também foram removidos; API principal, PostgreSQL e LocalStack permaneceram saudáveis, com volume principal preservado.
