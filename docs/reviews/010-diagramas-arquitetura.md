# Atualização 010 — Guia visual da arquitetura e do fluxo

Criados docs/diagrams/arquitetura.html e arquitetura.svg, vinculados ao README e à arquitetura. O HTML é independente, sem bibliotecas, fontes externas ou chamadas à API. SVG é a visão estática para o GitHub; não exige executar o HTML.

O mapa contém onze componentes: HTTP, caso de uso, fila de eventos, fila de solicitações, consumidor, store, domínio, DLQ, worker de referências, banco e publisher. Cada seleção revela responsabilidade, limite e links relativos aos fontes. A borda de transação destaca a coordenação do WagerStore e os dados PostgreSQL; o domínio é chamado durante a transação.

A segunda visão compara seis exemplos: BET processado, replay, conflito de chave/payload, saldo insuficiente, REFUND antes do BET e LOSS. Explica saldo, ledger, versão, eventos, commit versus rollback e ack. São exemplos documentais, não simulações conectadas à API.

Validação em navegador Edge headless: onze componentes renderizados, seleção e links conferidos, seis cenários e estados HTTP, exportação SVG, impressão PDF gerada, largura móvel de 390px sem overflow horizontal e zero erros JavaScript. Capturas de desktop e fluxo foram inspecionadas visualmente; os arquivos de conferência permanecem em .tools, ignorada pelo Git. Não foram alteradas regras de aplicação.

O estilo escuro segue a referência indicada na conversa (Cocoon-AI/architecture-diagram-generator). A implementação foi escrita para este projeto, sem instalar a skill remota ou copiar seu template. A skill visualize local foi consultada; por se tratar de documentação standalone no repositório, o contrato de visualização inline não se aplica.

Para revisar: abrir o HTML localmente, selecionar WagerStore/OutboxPublisher e comparar o fluxo de rejeição confirmada com o conflito que faz rollback. Verificar a janela de crash após envio antes da marcação de publicação.
