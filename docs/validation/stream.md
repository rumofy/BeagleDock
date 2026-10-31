# Validação do stream (issue #3)

Evidência **real** (CLIs autenticadas na máquina, `node test/native-cli-canary.cjs`), registrada em 2026-10-31.
Cada CLI executa um comando que imprime `FIRST`, quatro `TICK` (1 por segundo) e `LAST`; os tempos são
ms desde o início da execução, medidos no `pty-data` emitido pelo runner antes da conclusão.

| CLI | Versão | first | tick | last | chat (1º texto) | concluído | Saída ao vivo |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Claude Code | 2.1.316 | 9073 | 9973 | 12975 | 13961 | 13994 | sim (first < tick < last < concluído) |
| Codex CLI | 0.166.0 | 12152 | 9143 | 12145 | 7074 | 13948 | parcial: `first` só chega no snapshot final; `tick`/`last` chegam por delta |
| Antigravity (agy) | 1.4.12 | 8276 | 9178 | 11283 | 16077 | 19444 | sim |

A sessão nativa foi preservada na retomada nas três CLIs.

## Evidência simulada (offline)

- `test/stream-performance.test.js`: aplicação de cada quadro numa conversa de 400 mensagens com resposta
  de centenas de KB; p95 < 1/4 de quadro e pior quadro < 16 ms.
- `test/stream-apply.test.js`: lote por quadro, métricas (`ipc + espera do quadro + commit`) e agendador com
  prazo de segurança para janela oculta.
- `test:desktop`: três CLIs simuladas com saída antes da conclusão.

Eventos finais simulados não comprovam saída ao vivo; a tabela acima é a prova com CLI real.

## Limitações conhecidas

- Codex 0.166.0: o app-server não envia delta para a primeira linha de saída do comando. Linha do tempo real
  (comando imprimindo `M_FIRST` em t≈7,0 s e um `M_TICK_n` por segundo): o primeiro `outputDelta` chega em
  8015 ms já com `M_TICK_1`, e `M_FIRST` só aparece no snapshot final (12034 ms, marcado como "[Início da saída]").
  O app entrega cada delta no instante em que recebe; não há como antecipar nem simular essa linha.
- Antigravity 1.4.12: o stream-json só expõe os passos `user_input` e `agent_response` (com `--effort high`, sem
  ferramentas); não há passo de raciocínio. O app não exibe "pensando" para o Antigravity, em vez de simular.
- Claude Code: raciocínio ao vivo via `thinking_delta` (já coberto).
