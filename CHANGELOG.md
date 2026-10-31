# Changelog

As mudanças de cada versão são registradas aqui. O projeto segue versionamento semântico.

## [Unreleased]

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

[Unreleased]: https://github.com/rumofy/BeagleDock/compare/v0.2.2...HEAD
[0.2.2]: https://github.com/rumofy/BeagleDock/compare/v0.2.1...v0.2.2
[0.2.1]: https://github.com/rumofy/BeagleDock/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/rumofy/BeagleDock/compare/v0.1.2...v0.2.0
[0.1.2]: https://github.com/rumofy/BeagleDock/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/rumofy/BeagleDock/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/rumofy/BeagleDock/releases/tag/v0.1.0
