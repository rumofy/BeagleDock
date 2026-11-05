# Changelog

All notable changes to BeagleDock are recorded here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.15.0] - 2026-11-05

### Added

- Phone access: use the full chat from a phone on the same Wi-Fi or private network, for Claude Code, Codex CLI and Antigravity: model, level and permission, attachments and photos, dictation, commands and skills, the queue, plan review, approvals, quotas and notifications, with both screens kept in sync live. Turn it on in Settings → Phone access (off by default) and pair the phone with a QR code; the connection is encrypted, only paired devices on private networks can connect, and each device can be revoked.

## [0.14.1] - 2026-11-04

### Fixed

- Plan mode temporarily makes the conversation read-only; approving the plan or turning planning off restores the permission mode used before planning, including after restarting the app.
- Questions from the CLIs now show selectable answers, descriptions and a custom response field instead of raw JSON and permission buttons. Multiple questions and multiple selections are supported, and your answers are sent back to the conversation.

## [0.14.0] - 2026-11-04

### Added

- The interface is now available in English, Spanish and Brazilian Portuguese, chosen in Settings → Appearance. Notifications, the tray menu and the prompts the app sends to the CLIs on your behalf (handoff, continuation in another CLI, plan approval, assisted memory maintenance) follow the chosen language.

### Changed

- English is now the default interface language. If you used the app in Portuguese, switch back in Settings → Appearance.
- The conversation list in the sidebar is now ordered by last update: the conversation with the most recent message or reply comes first, and a new or reopened conversation goes to the top.

### Fixed

- Voice dictation in English no longer swaps short words that sound like a registered name (for example, “checks” turning into “Codex”) or drops the word right after a correctly spelled name (“BeagleDock is” turning into “BeagleDock”).
- When Claude Code or Codex CLI keeps working on its own (for example, the main agent continuing after a background agent finishes), the conversation no longer looks finished: the sidebar, the header and the Stop button now show that the AI is still running.
- A plan waiting for approval no longer looks like a permission request. It has its own card in the conversation, the popup for other conversations only opens the conversation for review (it can't approve the plan), and switching the conversation to “Full access” no longer approves a pending plan or answers a pending question on your behalf.
- The plan proposed by Claude Code or Codex CLI now appears in full inside the reply in the chat and stays in the history after approval, instead of only showing up in a small box of the approval request.

## [0.13.1] - 2026-11-04

### Corrigido

- No modo terminal do Codex CLI, confirmar uma tela de abertura (confiança da pasta, revisão de hooks) não gera mais a notificação falsa de que a resposta terminou.

## [0.13.0] - 2026-11-03

### Adicionado

- Opção “Interface das conversas” nas configurações, para o Claude Code, o Codex CLI e o Antigravity: com “Terminal da CLI”, cada conversa abre na interface da própria CLI, continuando a mesma conversa. Você digita direto nela. Anexar imagem (Ctrl+V ou arrastar o arquivo), plano, aprovações, atalhos e fila funcionam como na CLI. Do BeagleDock ficam só o Handoff (cola o pedido e envia na CLI) e o Ditado (cola o texto sem enviar). As mensagens trocadas no terminal (as suas e as respostas da IA) entram no histórico da conversa ao fim de cada resposta, inclusive numa conversa nova aberta direto no terminal, que fica ligada à do BeagleDock para o chat continuar de onde parou. Voltar para “Chat do BeagleDock” encerra as CLIs do terminal.
- Notificação do sistema quando termina (ou falha) uma resposta que você pediu, no chat e no modo terminal, para o Claude Code, o Codex CLI e o Antigravity, com o começo da resposta. Ela só aparece com a janela do BeagleDock fora de foco (minimizada, na bandeja ou atrás de outra janela), e clicar nela abre a conversa. No modo terminal, a notificação também avisa quando a CLI para esperando você, como num pedido de aprovação.
- A aba Shells mostra lado a lado todas as conversas abertas no modo terminal, para acompanhar várias CLIs ao mesmo tempo, com opção de ampliar uma delas.
- Botões para a IA responder na hora uma mensagem enviada durante um comando demorado. No Claude Code, “Responder agora” manda o comando para o segundo plano, onde ele continua rodando, e “Interromper e responder” cancela o comando. No Codex CLI, “Interromper e responder” cancela a etapa em andamento e manda a mensagem em seguida. No Antigravity, que só lê a mensagem no fim da resposta, continua valendo o “Enviar agora” da fila.
- A lista de conversas e o topo do chat mostram quando a resposta terminou, mas um comando ou agente continua rodando em segundo plano. Antes a conversa parecia parada.

### Removido

- O ditado não traz mais nomes nem trocas embutidos: saíram o glossário de ferramentas (GitHub, TypeScript, Supabase e outros) e as trocas fixas de expressões faladas (“cloud coding”, “anti gravity”, “git hub”, “ag”). Agora vale só o que você cadastra no vocabulário do ditado, mais o nome do projeto aberto e o da CLI da conversa. O que você cadastra com maiúscula continua sendo reconhecido pelo som (“Bigodok” vira “BeagleDock”), e uma troca específica é cadastrada no mesmo lugar, como “ag => AGY”.

### Corrigido

- Uma mensagem enviada durante a resposta do Claude Code ou do Codex CLI não fica mais com “Na fila · envio automático…” depois de entregue. Agora aparece “Entregue · a IA lê quando a etapa atual terminar”.
- No Claude Code, um comando mandado para o segundo plano no meio da resposta não aparece mais como concluído enquanto ainda roda.
- Depois que uma mensagem enviada durante a resposta é entregue, no Claude Code e no Codex CLI, a resposta anterior para de aparecer “em andamento” e as etapas novas (comandos, leituras, raciocínio) aparecem na resposta à mensagem nova, e não mais na anterior. Antes, com duas entregas seguidas, a resposta do meio podia ficar presa em “Raciocinando…”.
- O histórico (Ctrl+H) passa a mostrar as conversas do Antigravity feitas só na interface da CLI, que antes ficavam de fora, e as mensagens importadas do Antigravity aparecem sem os metadados internos que a CLI junta ao texto.
- O ditado não altera mais o texto dentro de links: em `https://...?logo=linux`, o “linux” deixava de ficar como foi escrito e virava “Linux”. O texto em volta do link continua sendo corrigido normalmente.

## [0.12.0] - 2026-11-02

### Adicionado

- Botão “Aprovar plano e executar” no campo de mensagem, no Claude Code, no Codex CLI e no Antigravity: quando a conversa está no modo plano e a IA terminou de apresentar o plano, um clique tira a conversa do modo plano (Aceitar edições) e pede para ela implementar. Antes, responder “sim” deixava a conversa presa no modo somente leitura.

### Corrigido

- Aprovar o plano no pedido do Claude Code agora tira a conversa do modo plano de verdade: o seletor passa para “Aceitar edições”, a IA executa sem pedir cada edição e a próxima mensagem não volta ao modo plano. Antes, a aprovação não ficava registrada no BeagleDock, e a conversa podia voltar ao plano no meio do trabalho. O pedido também mostra o plano em texto legível e as opções “Aprovar o plano e executar” e “Continuar planejando”.
- No Antigravity, trocar o nível de permissão, o modelo ou o raciocínio com a conversa aberta não faz mais a mensagem seguinte terminar em “Execução interrompida”.
- O ditado reconhece mais formas faladas dos nomes das CLIs: “cloud coding”, “Claudio Coding” e “Cláudio Code” viram “Claude Code”, e “ag” vira “AGY”.

## [0.11.1] - 2026-11-02

### Corrigido

- O ditado por voz sempre continua no fim do texto do campo de mensagem, com o cursor indo para o fim, e dá para gravar várias observações seguidas e enviar tudo de uma vez. Antes, um trecho novo podia entrar no meio ou no início do que já estava escrito.

## [0.11.0] - 2026-11-02

### Adicionado

- Opção “Começar com a última escolha de cada CLI”, em Configurações → Novos chats: ligada, o chat novo do Claude Code, do Codex CLI ou do Antigravity já abre com o modelo, o nível de raciocínio e a permissão (inclusive o acesso total) que você escolheu por último numa conversa da mesma CLI, sem precisar configurar tudo de novo. Se o modelo saiu da lista da CLI, o chat volta ao modelo padrão e mantém a permissão.

### Corrigido

- Reabrir pelo histórico uma conversa do terminal que já estava no BeagleDock não apaga mais o nível de raciocínio e a permissão escolhidos nela.

## [0.10.0] - 2026-11-02

### Adicionado

- Busca na conversa aberta com Ctrl+F: realça todas as ocorrências, mostra quantas são (“3 de 12”) e navega com Enter e Shift+Enter (ou F3). Não diferencia maiúsculas nem acentos (“acao” acha “Ação”), acompanha o texto que ainda está chegando e já busca pelo trecho selecionado, se houver. Esc fecha.
- Limpeza dos projetos temporários do ai-memory na Wiki: testes com CLI real em pastas temporárias criavam um projeto novo a cada pasta, e ninguém os apagava. Agora você escolhe em quantos dias um projeto temporário parado é apagado sozinho (padrão de 7 dias, 0 desliga) e tem o botão “Limpar temporários agora”. Só entram projetos em que todas as sessões vieram de pastas temporárias; projetos de verdade, como os seus repositórios, nunca são apagados.
- Ditado por voz com glossário de desenvolvimento já cadastrado (GitHub, TypeScript, Supabase, pull request, deploy e outros) e com as confusões mais comuns resolvidas pela expressão: “cloud code” vira “Claude Code”, mas “cloud” sozinho continua sendo nuvem.

### Corrigido

- O ditado local agora reconhece os nomes das CLIs, do projeto aberto e dos termos que você cadastra mesmo quando o modelo os escreve de outro jeito: “Bigodok” vira “BeagleDock”, “iMemory” vira “ai-memory”, “Rumofine Next” vira “RumofyNext”. Antes, só acertava as maiúsculas de um nome que já tinha saído escrito certo. Palavras em português parecidas, como “memória” ou “bigode”, não são trocadas.
- O ditado não altera mais texto dentro de caminhos, nomes de arquivo e variáveis (por exemplo, `package.json` virava `package.JSON`).

## [0.9.0] - 2026-11-02

### Adicionado

- Ditado por voz no campo de mensagem: clique no microfone (ou use Ctrl+Shift+M), fale e conclua. O texto aparece no campo para você revisar antes de enviar, no Claude Code, no Codex CLI e no Antigravity. Esc descarta a gravação.
- O ditado roda no seu computador, sem conta, sem chave e sem internet: usa o modelo de voz Parakeet, que entende português, pontua sozinho e transcreve alguns segundos de fala em cerca de 1 a 2 segundos. O modelo (669 MB) é baixado uma vez, na primeira vez que você usa o microfone, e só ocupa memória enquanto transcreve.
- Vocabulário do ditado nas configurações: termos que precisam sair com a grafia certa e trocas como “cloud code => Claude Code”. Os nomes do projeto e da CLI já entram sozinhos. Quem preferir pode transcrever por uma API na nuvem (OpenAI ou compatível).

## [0.8.0] - 2026-11-02

### Adicionado

- O histórico (Ctrl+H) agora lista as conversas salvas no BeagleDock, abertas e fechadas, com título, pasta e número de mensagens. Clicar reabre a própria conversa com tudo o que foi salvo, e a busca procura também no texto das mensagens.
- Dá para apagar uma conversa definitivamente pelo histórico, com confirmação. Isso remove as mensagens, as imagens e também o arquivo da conversa no Claude Code, no Codex CLI ou no Antigravity.
- Imagens coladas ou anexadas são otimizadas antes do envio: são convertidas para WebP e reduzidas quando o maior lado passa de 2576 px, o limite que os modelos aproveitam. Assim ocupam menos espaço sem perder legibilidade.

### Alterado

- Na barra lateral, “Arquivar” e “Excluir” deram lugar a “Fechar”: a conversa sai da lista, a CLI é encerrada e a conversa continua no histórico, pronta para ser reaberta. As conversas que você tinha arquivado aparecem no histórico como fechadas.
- A lista de conversas na barra lateral não mostra mais o nome do modelo, para sobrar espaço ao assunto. Com o mouse em cima, aparecem o assunto completo e o modelo.
- As imagens das conversas passam a ficar em arquivos na pasta de dados do BeagleDock, e não mais dentro do banco. O banco fica bem menor e as conversas fechadas não são carregadas ao abrir o app. As imagens que já estavam salvas são migradas sozinhas, sem perder nada.

### Corrigido

- O histórico não mostrava as conversas feitas pelo BeagleDock nem as do Claude Code abertas sem o terminal interativo. Agora elas aparecem, e as sessões vazias criadas por testes e sondagens deixam de poluir a lista.

## [0.7.0] - 2026-11-02

### Adicionado

- Compactação preventiva no Claude Code: uma conversa parada com mais de 200 mil tokens de contexto é compactada sozinha nos últimos 5 minutos de validade do cache, quando reler o contexto ainda é barato, em vez de reprocessar tudo a preço cheio ao voltar.

### Alterado

- O limite da compactação automática agora tem a opção “Automático”, que passa a ser o padrão: acompanha a janela do modelo (40% dela, por exemplo 400 mil numa janela de 1 milhão). Janelas de 200 mil ou ainda desconhecidas continuam em 200 mil, e um valor escolhido por você sempre vale como está.

## [0.6.1] - 2026-11-02

### Alterado

- O shell da conversa voltou a ser um fluxo único com toda a saída, sem abas por comando, para ser possível acompanhar o que está rodando. A opção de fechar abas sozinha saiu das configurações.

## [0.6.0] - 2026-11-02

### Adicionado

- A barra de contexto mostra por quanto tempo o cache de prompt continua válido. No Claude Code há contagem regressiva real (“cache expira em 42 min”), destacada nos últimos 5 minutos e trocada por “cache expirado” quando passa do prazo, para você saber quando a próxima mensagem vai reprocessar o contexto inteiro. O Codex CLI e o Antigravity não informam a validade do cache, então neles aparece o tempo desde a última chamada.
- No Antigravity, a barra de contexto agora mostra quanto foi lido do cache na última resposta.
- Ao trocar de modelo numa conversa grande (acima de 100 mil tokens), a barra de contexto avisa na hora que a próxima mensagem vai reprocessar o contexto inteiro, porque o cache é separado por modelo. Ao enviar, o app pergunta antes: dá para enviar assim mesmo, voltar ao modelo anterior (aproveitando o cache ainda quente), compactar no modelo anterior antes de trocar ou voltar a editar. Vale para Claude Code, Codex CLI e Antigravity.
- A lista de conversas marca como “fria” as conversas grandes cujo cache já expirou, com o tamanho do contexto, para você ver antes de abrir que retomá-las vai sair caro.
- A barra de contexto mostra quanto a última resposta acrescentou ao contexto e destaca quando foi muito (50 mil tokens ou mais), o que costuma ser um arquivo, log ou saída de comando grande que vai encarecer todas as mensagens seguintes.
- O nível de permissão pode ser trocado durante a resposta (no seletor do cabeçalho e nos atalhos Alt+P/Alt+M). No Claude Code o novo nível vale na hora, na própria resposta em andamento. No Antigravity, a partir de “Aceitar edições”, as próximas ferramentas já seguem o novo nível; o restante da política entra na próxima mensagem. No Codex CLI vale a partir da próxima mensagem. Um aviso junto ao seletor diz qual foi o caso. Passar para “Acesso total” com uma aprovação esperando libera essa ação uma vez, sem gravar regra permanente.

### Corrigido

- O aviso de conversa grande e parada passa a usar a validade de cache informada pelo Claude Code (1 hora ou 5 minutos) e o horário da última resposta do modelo, em vez de supor sempre 1 hora.

## [0.5.2] - 2026-11-02

### Corrigido

- No tema escuro, os indicadores de cota (5h e semanal), o cabeçalho e o rodapé do terminal flutuante/aba de shells e as listas suspensas de seleção de workspace, modelo, nível de raciocínio e permissão agora têm contraste alto e permanecem legíveis.

## [0.5.1] - 2026-11-02

### Alterado

- O tema escuro agora usa a paleta de cores do VS Code (cinzas escuros neutros e texto claro de alto contraste), substituindo os tons amarelados e sépia por um visual mais confortável e familiar.

## [0.5.0] - 2026-11-01

### Adicionado

- A barra de contexto mostra o cache de prompt da última resposta (lido e escrito) no Claude Code e no Codex CLI, e destaca quando o cache inteiro foi reescrito, que é o que gasta muita cota ao retomar uma conversa parada. O Antigravity não informa esse dado.
- Compactação automática do contexto, configurável em Configurações (“Contexto das conversas”; padrão 200 mil tokens, ou desligada). Conversas longas ficam muito mais baratas de retomar depois de paradas, porque o cache expirado deixa de reprocessar centenas de milhares de tokens. Vale para Claude Code, Codex CLI e Antigravity.
- O botão “Compactar” agora também funciona no Antigravity.
- Ao enviar uma mensagem numa conversa grande (acima de 100 mil tokens) que ficou parada por mais de 1 hora, o app avisa que o cache expirou e que a mensagem vai reprocessar o contexto inteiro, e deixa escolher entre enviar assim mesmo, compactar antes de enviar ou voltar a editar.

### Corrigido

- Os textos que a IA escreve entre as ferramentas (“vou rodar os testes…”, “passou, agora…”, a conclusão) não ficam mais empilhados numa caixa só: cada trecho aparece na própria caixa, o que facilita separar o que você já leu do que é novo. Vale para Claude Code, Codex CLI e Antigravity; conversas antigas continuam como estavam.
- A mensagem que você envia enquanto a IA ainda está respondendo não fica mais com a resposta dela em cima: o que a IA escreve depois de recebê-la aparece numa caixa nova, abaixo da sua mensagem, e o histórico reaberto mantém essa ordem. Vale para Claude Code e Codex CLI.

## [0.4.0] - 2026-11-01

### Adicionado

- Mensagens na fila ganharam os botões “Enviar agora” (interrompe a execução atual e envia a mensagem em seguida) e “Remover da fila” (a mensagem nunca chega à IA e some do histórico). Vale para Claude Code, Codex CLI e Antigravity.
- No Claude Code e no Codex CLI, uma mensagem escrita durante a execução agora é entregue à IA na próxima etapa, como nas CLIs originais, em vez de esperar o fim de toda a resposta. O Antigravity não aceita isso durante o turno e segue usando a fila.
- As abas do shell rolam na horizontal (inclusive com a roda do mouse) e mostram todas as abas; a aba escolhida sempre fica à vista.

### Alterado

- Os detalhes da cota de cada CLI na barra lateral (última leitura, reinício, tokens e cotas por grupo) agora ficam recolhidos por padrão, num botão “Detalhes da cota”, para sobrar mais espaço à lista de conversas. Os percentuais de 5h e da semana continuam sempre visíveis.
- A barra de contexto não estima mais a janela do modelo: mostra apenas os tokens reais informados pela CLI e só exibe a porcentagem quando a CLI informa a janela.
- O cabeçalho da conversa se ajusta a telas menores, quebrando em linhas em vez de cortar os controles.

### Corrigido

- Quando a resposta termina mas um comando segue rodando em segundo plano (como uma suíte de testes) e a IA aguarda o aviso, a mensagem agora mostra que o comando ainda está em andamento, em vez de parecer concluída. Se a CLI encerrar antes do aviso, o comando deixa de constar como rodando.
- Mensagens já emitidas pela IA não são mais substituídas ao fim do turno: o texto completo do Claude Code é preservado, inclusive quando o limite de uso é atingido, e a mensagem de erro deixou de aparecer duplicada.

## [0.3.2] - 2026-11-01

### Corrigido

- O atalho /handoff agora pede à CLI da conversa que salve um handoff de verdade com a skill do ai-memory, em vez de só listar os handoffs pendentes e parecer travado.

## [0.3.1] - 2026-10-31

### Corrigido

- A contagem de agentes na Atividade não inclui mais comandos rodando em segundo plano: um único agente deixou de aparecer como dezenas.
- Quando a resposta termina mas agentes seguem trabalhando em segundo plano, a mensagem agora avisa isso de forma visível, em vez de parecer concluída.

## [0.3.0] - 2026-10-31

### Adicionado

- Modo de permissão por atalho: Alt+P liga e desliga o modo plano e Alt+M percorre os modos da conversa (da permissão global da CLI ao acesso total). O modo atual continua visível no cabeçalho, a troca vale para a próxima execução sem perder o histórico e, durante uma resposta, o app avisa em vez de trocar.
- Em “Gerenciar workspaces”, cada pasta ganhou o botão para abrir o projeto no VS Code.
- Bandeja do sistema mais completa: o ícone ganha um selo de estado (âmbar com conversa rodando, vermelho aguardando permissão), o menu lista as conversas em andamento e clicar em uma delas, ou na notificação de resposta ou de permissão pendente, abre a conversa correspondente no app.
- Preferências de segundo plano nas configurações: manter o app na bandeja ao fechar a janela (desligado, fechar a janela encerra o app, avisando se houver conversa em execução) e iniciar junto com o sistema, já na bandeja e sem mostrar a janela (Linux).
- Continuar em outra CLI: o botão “Continuar em” do cabeçalho cria uma conversa nova na CLI escolhida com um resumo do que foi feito (pedido original, última resposta, arquivos alterados e comandos que falharam), sem tocar na conversa original. Quando a cota da CLI atual está perto do fim e outra tem folga, o chat sugere a troca. O resumo vem só do histórico local, sem segredos, e a nova CLI é instruída a tratá-lo como informação e a conferir o estado real do projeto antes de continuar.
- Anexos no chat: cole, arraste ou escolha imagens e arquivos no campo de mensagem, com pré-visualização e remoção, e eles chegam de verdade à CLI no formato dela (imagem como imagem no Claude Code e no Codex; arquivos por menção ou caminho). No Antigravity, que não tem campo nativo de imagem, o caminho vai no texto e o app avisa.
- Ao digitar “@” no campo de mensagem, aparecem os arquivos do projeto da conversa (respeitando o .gitignore); o arquivo escolhido é enviado à CLI como menção.
- Gerenciar workspaces: tela para ver se cada pasta ainda existe, se tem git e ai-memory e quantas conversas usa, renomear, trocar a pasta (com o seletor do sistema) e remover do cadastro. Isso nunca altera nem apaga conversas, histórico ou identificadores nativos.
- Shell com abas: cada comando que roda em paralelo (ou que um agente lançou) ganha a própria aba no shell, com o comando, o estado (rodando, concluído ou erro) e o agente de origem. Só comandos viram aba; leitura de arquivo e outras ferramentas ficam só em “Tudo”, que continua mostrando o fluxo único de sempre. Abas novas não tomam o foco, uma marca avisa de saída nova e, com muitos comandos, as mais antigas ficam no menu “mais”. Comandos concluídos podem ser fechados (× ou “Limpar concluídas”), e a saída continua em “Tudo”. Nas configurações, o fechamento automático das abas concluídas com sucesso (padrão: 2 minutos sem serem vistas) pode ser ajustado ou desligado; erros e abas com saída não vista nunca fecham sozinhos.

### Alterado

- O atalho “Shells PTY Ativos” da barra lateral virou “Shells” e passou a contar os comandos rodando agora, os mesmos das abas do shell, em vez das conversas em andamento.

## [0.2.2] - 2026-10-31

### Adicionado

- Autocomplete de comandos no campo de mensagem: ao digitar “/”, aparecem os comandos e as skills nativos da CLI da conversa, lidos da própria CLI a cada consulta, e por isso acompanham as atualizações dela. No Codex aparecem só as skills, porque ele não informa os comandos internos.
- Os comandos “/model”, “/effort” e “/permissions” abrem o seletor correspondente do app, que mantém o modelo, o esforço e a permissão da conversa.
- Endereços web (http e https) nas respostas viram links clicáveis e abrem no navegador padrão; links dentro do app também abrem fora dele, sem que a janela do BeagleDock navegue.

## [0.2.1] - 2026-10-31

### Corrigido

- A caixa de processamento mantém a altura durante a execução, sem oscilar quando mudam a atividade, o raciocínio, os tempos e os detalhes das ferramentas.
- O Codex e o Antigravity mantêm as etapas de cada subagente agrupadas durante todo o trabalho, sem encerrar o agente antes de concluir nem pedir confirmação para criar subagentes ou entregar a resposta final ao agente pai.
- No modo “Global da CLI”, a ponte de permissões do Antigravity respeita a política global configurada na CLI em vez de pedir confirmação manual para cada ferramenta.
- Pedidos de permissão de subagentes do Codex e do Antigravity aparecem na conversa que os lançou, em vez de serem negados silenciosamente.
- O shell mostra os comandos e a saída dos subagentes do Codex e do Antigravity; quando a CLI só registra o resultado ao concluir o comando, ele aparece assim que fica disponível.

## [0.2.0] - 2026-10-31

### Adicionado

- Linha do tempo ao vivo em cada resposta, igual para Claude Code, Codex e Antigravity: raciocínio, comandos, ferramentas, MCPs, edição de arquivos, plano, agentes e compactação de contexto, com estado, duração e erro de cada etapa. Ela fica salva com a conversa, com tokens e senhas mascarados.
- Visão de agentes: quando a resposta lança subagentes, cada agente aparece na linha do tempo com o que está fazendo, as ferramentas e os tokens usados e o resumo final, e as etapas dele ficam aninhadas sob ele. Agentes lançados em segundo plano continuam aparecendo, com progresso e resultado, depois que a resposta termina, e isso fica salvo no histórico. No Claude Code isso vem dos eventos de tarefa da própria CLI; no Codex, das conversas de agentes que o protocolo informa; no Antigravity, das ferramentas de subagente.
- Respostas espontâneas da CLI: quando um agente em segundo plano termina e o agente principal responde por conta própria (como no terminal), a resposta aparece no chat ao vivo, fica salva no histórico, a conversa ganha a etiqueta “novo” e, com a janela fora de foco, chega uma notificação do sistema. Vale para Claude Code e Codex.
- Indicador “último evento há Xs” durante a execução, que avisa quando a CLI está enviando sinais mas sem progresso real, ou sem eventos; apenas informa, sem interromper nada.
- Bandeja do sistema com a quantidade de sessões rodando e aguardando permissão, e notificação do sistema para permissões pendentes quando a janela está fora de foco. Uma segunda abertura do aplicativo apenas traz a janela de volta, `beagledock --quit` pede para encerrar a instância em execução, e o sistema não suspende o app enquanto houver sessão rodando.
- Pedidos de permissão aparecem no próprio chat com as opções nativas de cada CLI: no Claude Code, permitir sempre uma regra, uma pasta ou um modo; no Codex, permitir nesta sessão, uma regra de comando, negar e continuar ou negar e interromper; no Antigravity, permitir ou negar. No Claude Code, a negação pode levar uma instrução para a IA, e opções perigosas (como ignorar todas as permissões) pedem confirmação. A conversa que aguarda permissão fica destacada no cabeçalho e na lista de conversas.
- Renomear (duplo clique ou F2), arquivar e desarquivar conversas, com uma seção “Arquivadas” por CLI que mantém o histórico; o nome dado por você nunca é trocado pelo automático, e a lista funciona pelo teclado. Excluir passa a pedir confirmação.
- Barra de contexto da sessão no chat, com a ocupação da janela do modelo no Claude Code e no Codex e o uso em tokens no Antigravity (que não informa a janela), aviso ao passar de 70% e 90%, indicação de quando a CLI está compactando e do antes e depois da última compactação. O botão “Compactar” usa o comando nativo do Claude Code e do Codex; o Antigravity não oferece compactação em modo programático.
- Blocos de código nas respostas, com destaque de sintaxe e botão “Copiar”, também enquanto a resposta ainda está chegando.
- Botão “VS Code” no cabeçalho do chat e referências a arquivos nas respostas (como `src/app.ts:42`) que abrem o arquivo na linha exata no VS Code.
- Tema claro, escuro ou do sistema e zoom da interface (Ctrl +, Ctrl −, Ctrl 0) nas configurações, com a escolha guardada.
- Rascunho por conversa: o texto digitado é guardado ao trocar de conversa e ao fechar o app, e a lista marca as conversas com mensagem não enviada.

### Alterado

- Fechar a janela agora leva o BeagleDock para a bandeja sem interromper sessões, filas nem aprovações; só o item “Sair” da bandeja encerra o app, com confirmação se houver sessão rodando. Sem bandeja disponível, o app se comporta como um aplicativo comum.
- Execuções longas deixam de ser encerradas após 15 minutos, e pedidos de permissão deixam de ser negados automaticamente após 2 minutos: ambos aguardam você, como no terminal. Parar a sessão continua cancelando tudo.
- Minimizada ou na bandeja, a interface continua recebendo o stream sem atraso.
- O chat acompanha o fim da resposta somente enquanto você está no fim; ao subir para ler, a rolagem não é mais puxada de volta, e um botão leva ao fim.
- O streaming é entregue à tela uma vez por quadro e as mensagens antigas não são mais redesenhadas a cada trecho; numa conversa de 400 mensagens com resposta de 370 KB, o custo de aplicar cada quadro caiu para menos de 2 ms, e há um teste que falha se passar de um quadro.
- Ao cadastrar um workspace, a pasta é escolhida no seletor de arquivos do sistema, com o nome sugerido a partir dela e aviso se já estiver cadastrada; digitar o caminho continua possível.

### Corrigido

- Cotas de 5h e semanal do Claude Code e do Codex agora são lidas das próprias CLIs (`/usage` e limites da conta), sem usar modelos nem logs antigos, e deixam de aparecer como “desatualizadas” ou com valores velhos. A consulta é periódica (a cada 45 s com a janela aberta e a cada 10 min em segundo plano) e não grava sessões no histórico nem dispara os hooks do Claude Code.
- O painel lateral mostra quando cada janela de cota reinicia, conforme informado pela CLI, no seu fuso horário.
- O erro de autenticação de MCP do Codex deixa de poluir o shell visível; o app avisa qual MCP precisa de login e mostra o comando para resolver.

## [0.1.2] - 2026-10-31

### Corrigido

- Indicador do ai-memory no chat mostra o projeto de memória do workspace e o estado real do servidor, em vez de sempre “OFF”.

## [0.1.1] - 2026-10-31

### Adicionado

- Versão do aplicativo exibida na barra lateral.
- Explorador do ai-memory redesenhado em três painéis (projetos, páginas agrupadas com saúde da base e leitor em Markdown com `[[links]]`), exclusão de páginas e projetos com confirmação e **Manutenção Assistida**: uma conversa em Claude, Codex ou Antigravity, acompanhada no próprio painel, que planeja e executa a limpeza da wiki com aprovação e limite de exclusões.

### Alterado

- Todos os nomes antigos (CapyAI, Bleagle/BleagleDock) foram renomeados para BeagleDock: pasta de dados `~/.beagledock` com banco `beagledock.db`, perfil do Electron e appId `dev.beagledock.desktop`, API `window.beagleAPI`, rotas `/__beagledock/` e variáveis `BEAGLEDOCK_*` (as variáveis `CAPYAI_*` e `BLEAGLEDOCK_*` deixam de ser aceitas). Na primeira execução, os dados antigos são migrados automaticamente (sem sobrescrever dados já existentes) e o hook de aprovação do AGY antigo é removido de `~/.gemini/config/hooks.json` para não duplicar aprovações. As chaves de API cadastradas no app dependem do cofre do sistema ligado ao nome antigo: se não puderem ser lidas, são descartadas e uma notificação pede o recadastro; as CLIs mantêm a própria autenticação.
- A verificação com CLIs reais (`npm run test:cli-live`) usa diretórios `beagledock-*-probe-*` com `.ai-memory.toml` apontando para o projeto único `beagledock-probes`.
- Distribuição apenas local: removido o workflow de CI que empacotava para Linux, Windows e macOS; o README documenta como gerar e instalar o `.deb`/AppImage na própria máquina.

### Corrigido

- Ícone do aplicativo no menu e na barra de tarefas do Linux.

## [0.1.0] - 2026-10-31

Primeira versão do **BeagleDock — Multi-CLI for Developers**.

### Adicionado

- Aplicativo Electron para Claude Code, Codex CLI e Antigravity, com descoberta de executáveis locais.
- Conversas persistidas em SQLite e retomada pelo identificador nativo da CLI, inclusive após reiniciar e trocar modelo ou permissão.
- Sincronização dos catálogos e níveis dos modelos disponíveis nas CLIs, histórico e dados de consumo.
- Chat e shell com saída incremental, cores ANSI, acompanhamento automático de rolagem e indicadores de atividade.
- Execuções independentes entre conversas e fila de mensagens por conversa.
- Aprovação e negação de ações na interface para os três provedores e edição de permissões globais.
- Botão Parar e comandos de interrupção no chat, cancelando execução, processos filhos, fila e aprovações pendentes.
- Notificações de modelos detectados e versões das CLIs; atualização das CLIs pela interface.
- Consulta de projetos, skills, MCPs e ai-memory; credenciais da aplicação protegidas pelo cofre do sistema.
- Mascote beagle e identidade visual BeagleDock.
- Testes unitários, de contrato e integração Electron com CLIs simuladas; diagnóstico opcional com CLIs reais.
- Configuração de instaladores Windows, Linux e macOS, incluindo builds para Intel e Apple Silicon no macOS.

### Corrigido

- Preservação do histórico sem criação silenciosa de outra sessão durante a retomada.
- Interface responsiva durante comandos e alternância entre conversas em execução.
- Leitura incremental de tarefas do Claude/AGY e integração Codex pelo app-server.
- Orientação ao Claude para evitar filtros que retêm a saída de testes até o término.
- Separação entre modelo e nível, resumo de cota AGY pelo grupo Gemini Models e nomes completos nas notificações de modelos.
- Títulos de conversas baseados no primeiro pedido com assunto, evitando saudações como título permanente.
- Posicionamento do painel de notificações dentro dos limites da janela.

### Alterado

- Licença Apache-2.0, avisos de terceiros e changelog incluídos nos pacotes.
- Dependências nativas compiladas na plataforma de destino, evitando binários SQLite com exigência de glibc superior à do sistema de build.
- Dados, identidade do cofre e identificadores internos anteriores preservados por compatibilidade.
- Pacotes sem assinatura de código nesta versão; execução real das três CLIs em Windows e macOS ainda requer validação nessas plataformas.

[Unreleased]: https://github.com/rumofy/BeagleDock/compare/v0.15.0...HEAD
[0.15.0]: https://github.com/rumofy/BeagleDock/compare/v0.14.1...v0.15.0
[0.14.1]: https://github.com/rumofy/BeagleDock/compare/v0.14.0...v0.14.1
[0.14.0]: https://github.com/rumofy/BeagleDock/compare/v0.13.1...v0.14.0
[0.13.1]: https://github.com/rumofy/BeagleDock/compare/v0.13.0...v0.13.1
[0.13.0]: https://github.com/rumofy/BeagleDock/compare/v0.12.0...v0.13.0
[0.12.0]: https://github.com/rumofy/BeagleDock/compare/v0.11.1...v0.12.0
[0.11.1]: https://github.com/rumofy/BeagleDock/compare/v0.11.0...v0.11.1
[0.11.0]: https://github.com/rumofy/BeagleDock/compare/v0.10.0...v0.11.0
[0.10.0]: https://github.com/rumofy/BeagleDock/compare/v0.9.0...v0.10.0
[0.9.0]: https://github.com/rumofy/BeagleDock/compare/v0.8.0...v0.9.0
[0.8.0]: https://github.com/rumofy/BeagleDock/compare/v0.7.0...v0.8.0
[0.7.0]: https://github.com/rumofy/BeagleDock/compare/v0.6.1...v0.7.0
[0.6.1]: https://github.com/rumofy/BeagleDock/compare/v0.6.0...v0.6.1
[0.6.0]: https://github.com/rumofy/BeagleDock/compare/v0.5.2...v0.6.0
[0.5.2]: https://github.com/rumofy/BeagleDock/compare/v0.5.1...v0.5.2
[0.5.1]: https://github.com/rumofy/BeagleDock/compare/v0.5.0...v0.5.1
[0.5.0]: https://github.com/rumofy/BeagleDock/compare/v0.4.0...v0.5.0
[0.4.0]: https://github.com/rumofy/BeagleDock/compare/v0.3.2...v0.4.0
[0.3.2]: https://github.com/rumofy/BeagleDock/compare/v0.3.1...v0.3.2
[0.3.1]: https://github.com/rumofy/BeagleDock/compare/v0.3.0...v0.3.1
[0.3.0]: https://github.com/rumofy/BeagleDock/compare/v0.2.2...v0.3.0
[0.2.2]: https://github.com/rumofy/BeagleDock/compare/v0.2.1...v0.2.2
[0.2.1]: https://github.com/rumofy/BeagleDock/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/rumofy/BeagleDock/compare/v0.1.2...v0.2.0
[0.1.2]: https://github.com/rumofy/BeagleDock/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/rumofy/BeagleDock/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/rumofy/BeagleDock/releases/tag/v0.1.0
