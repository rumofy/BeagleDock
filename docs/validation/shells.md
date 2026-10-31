# Validação dos shells por comando (issue #7)

Cada trecho de saída do shell sai do backend com `shellId`: o id do evento da linha do tempo do comando que o
produziu. A interface lê título, estado e agente de lá. Saída que a CLI não permite atribuir fica sem `shellId`
e aparece só na aba "Tudo"; a origem nunca é inventada.

## Evidência real (`node test/native-cli-canary.cjs --parallel`), 2026-10-31

Dois comandos pedidos ao mesmo tempo; cada um imprime marcadores `PAR_A_*` / `PAR_B_*`.

| CLI | Versão | Origem distinta por comando | Sem mistura entre abas | Saída sem origem |
| --- | --- | --- | --- | --- |
| Codex CLI | 0.166.0 | sim (`exec-…` de cada comando) | sim | 0 |
| Claude Code | 2.1.316 | sim (`toolu_…` de cada ferramenta) | sim | 1 trecho |
| Antigravity | 1.4.12 | sim (`step-N` de cada `run_command`) | sim | 0 |

- Claude Code: o log ao vivo de uma ferramenta só é atribuído quando há exatamente uma em andamento; com duas,
  esse trecho fica sem origem, e o resultado final de cada ferramenta chega com a origem certa.
- Antigravity: o comando assíncrono é um passo `run_command` (`step-2`) e a saída vem depois pelo
  `manage_task`, cujo `TaskId` termina em `task-N` (N = passo do `run_command`). A saída é atribuída ao passo
  do comando, então cada comando tem uma única aba. Antes disso, cada comando aparecia em duas abas
  (`step-2` e `step-5`). A primeira tentativa do dia não pôde ser feita porque a CLI não respondia a prompts
  de modelo; foi refeita quando voltou.

## Evidência simulada

- Contratos nas três CLIs: `test/codex-stream.test.js` e `test/cli-runner.test.js` (comandos em paralelo
  etiquetados, sem mistura).
- Regras das abas (título/estado/agente, abas visíveis e menu "mais", limites por aba e por sessão):
  `test/native-commands.test.js`.
- Integrado: `test:desktop` abre o app com o Codex simulado, confere os dois `shellId`, as duas abas e a troca
  de aba.
