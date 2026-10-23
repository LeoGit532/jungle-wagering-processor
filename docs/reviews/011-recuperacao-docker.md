# Atualização 011 — Recuperação do Docker Desktop

Em 23/10/2026, docker info não conseguia conectar ao pipe dockerDesktopLinuxEngine. O Docker Desktop estava fechado; ao iniciar, o log confirmou falha ao remover o socket temporário dockerInference dentro de AppData/Local/Docker/run.

Recuperação aplicada: encerrar os processos do Docker Desktop, renomear somente a pasta run para run-backup-20261023-111313, recriar run e iniciar o aplicativo. O caminho absoluto foi validado antes da renomeação. Não houve reset de fábrica, remoção de volumes ou recriação do banco do projeto.

Depois: docker info respondeu versão de servidor 28.4.0; docker compose up -d api iniciou os serviços existentes, migrations encerraram com sucesso e GET /health/ready retornou status ok. A recuperação tratou o ambiente local, sem alterar regras de aplicação. A suíte financeira não foi reexecutada nesta intervenção.
