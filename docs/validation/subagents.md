# Subagentes: permissões, contagem e saída

Verificação em Linux em 2026-10-31 para as issues #35 e #36.

## Diagnóstico

Na conversa relatada na #35, o histórico nativo do Codex registra uma chamada a
`spawn_agent`. A interface contava também `wait` e mensagens como agentes e
reatribuía as etapas do filho ao último item de comunicação. A suíte solicitada
ainda estava executando quando a pessoa interrompeu a conversa; o histórico não
comprova um loop de criação de agentes.

No AGY, o hook recebia o ID nativo do filho e o comparava ao ID do pai. Isso
negava o pedido antes de enviá-lo à interface. Além disso, o modo `inherit`
("Global da CLI") ignorava `toolPermission: "always-proceed"` do `settings.json`,
ferramentas de coordenação (`invoke_subagent`, `send_message`) exigiam confirmação
manual, e `step_type: "subagent"` marcava o agente como concluído ao lançá-lo
sem aninhar os comandos do filho na linha do tempo.

A ponte agora autentica a árvore de processos pelo segredo exclusivo herdado da
CLI, mantendo as decisões na conversa local que a lançou, respeita a política
global no modo `inherit`, não pede aprovação para ferramentas internas de
coordenação de subagentes nem leituras do `ai-memory`, e acompanha
`subagent_info.subagents` mantendo o subagente ativo e suas etapas aninhadas.
Outro segredo, um ID inválido e pedidos depois de encerrar a ponte não concedem
acesso. As regras globais de bloqueio da CLI continuam sendo preservadas.

## Evidência real

- Codex CLI 0.166.0: um subagente executou um comando Node de três segundos,
  imprimiu dois marcadores e concluiu; o adaptador recebeu um único agente,
  seu comando aninhado e a saída antes da resposta final do pai. A CLI enviou
  o marcador final por `outputDelta` e o inicial apenas no snapshot do comando.
  Essa ausência de um delta inicial vem da CLI; o aplicativo recuperou o trecho
  inicial sem repetir o trecho já recebido.
- Antigravity 1.4.12, Gemini 3.8 Flash: um subagente executou o mesmo comando,
  pediu permissão ao broker da conversa do pai e concluiu. Seu resultado chegou ao canal do shell
  cerca de 5,7 segundos antes da resposta final. O comando síncrono não produziu
  um log incremental: os dois marcadores ficaram disponíveis juntos no
  transcript nativo ao terminar o comando. Isso comprova recuperação da saída,
  não streaming intermediário desse comando.
- O probe autorizou automaticamente os pedidos reais referentes ao comando
  inofensivo. O clique em permitir/negar na janela foi validado com as CLIs
  simuladas, não com esses processos reais.
- Os probes usaram diretórios temporários com `.ai-memory.toml` apontando para
  `default/beagledock-probes`. Não executaram testes nem modificaram arquivos
  de outro projeto.

Para repetir o diagnóstico, use uma conversa em pasta temporária e peça um único
subagente para executar diretamente, sem pipes ou redirecionamento:

```sh
node -e "console.log('FIRST');setTimeout(()=>console.log('LAST'),3000)"
```

Observe a permissão do filho, a quantidade de agentes, a saída do shell antes da
resposta final e os eventos realmente expostos pela CLI. Não inferir saída ao
vivo a partir de snapshots finais.

## Evidência simulada

`npm test` cobre o contrato de eventos do Codex, a autorização de filhos
conhecidos, o isolamento de conversas desconhecidas, a ponte autenticada do AGY,
a leitura incremental de arquivos e o filtro de resultados de comandos no
transcript do filho. Os testes distinguem fim da criação do agente de fim do seu
trabalho e verificam que esperas e mensagens não criam novos agentes.

`npm run test:desktop` exercita o aplicativo com CLIs simuladas de Claude Code,
Codex e Antigravity. A cobertura adicional de filhos no Codex e AGY verifica
permitir/negar na interface e receber saída no shell antes da conclusão. Essa
cobertura não substitui a evidência real acima. O Claude Code não recebeu
alteração de protocolo neste trabalho; seu contrato e a integração existente
continuam na suíte de regressão.

O contrato v2 do Codex foi conferido com `codex app-server generate-ts` na CLI
instalada, incluindo `CollabAgentTool`, `SubAgentActivityKind` e `agentsStates`.
A [documentação oficial do App Server](https://learn.chatgpt.com/docs/app-server)
descreve o transporte de eventos e respostas interativas.
