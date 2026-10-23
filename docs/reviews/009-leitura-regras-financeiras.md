# Atualização 009 — Comentários para leitura das regras financeiras

Foram adicionadas explicações em português nos arquivos src/domain/money.ts, wallet.ts e apply-wager.ts. Nenhuma regra ou assinatura foi alterada.

Ordem sugerida de leitura:

1. Money: representação em centavos bigint, conversão decimal, imutabilidade e limite de persistência.
2. Wallet: abertura versus reidratação; cálculo antes da alteração; lançamento e versão.
3. applyWager: validação do contexto, referência pendente, LOSS, direção do movimento e rejeições.

Os comentários destacam a divisão de responsabilidades: o domínio decide efeitos, enquanto a persistência mantém lock e atomicidade. Retorno undefined de applyWager não significa necessariamente erro; o status da transação distingue rejeição, pendência e LOSS processado.

Verificação: formato, tipos e testes unitários executados após os comentários. Este registro é posterior à auditoria funcional 007 e não altera suas garantias.
