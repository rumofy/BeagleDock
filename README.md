# BeagleDock

**Multi-CLI for Developers · Apache-2.0**

Toolkit desktop para usar Claude Code, Codex CLI e Antigravity com conversas persistentes, catálogo local de modelos, histórico e consumo registrado pelas ferramentas.

Código: [rumofy/BeagleDock](https://github.com/rumofy/BeagleDock). Mudanças por versão: [CHANGELOG.md](CHANGELOG.md). Licença: [Apache 2.0](LICENSE); avisos de terceiros: [NOTICE](NOTICE). Como contribuir: [CONTRIBUTING.md](CONTRIBUTING.md).

## Plataformas

| Plataforma | Situação |
| --- | --- |
| Linux x64 | **Suportada.** Desenvolvida, testada e empacotada (`.deb`/AppImage). |
| Windows | **Experimental, aberta à comunidade.** O código trata caminhos, launchers `.cmd` e shell do Windows, mas o aplicativo nunca foi validado nessa plataforma. |
| macOS | **Não testada.** Há tratamento de Homebrew e `zsh`, sem validação nem assinatura de código. |

Quer ajudar a levar o BeagleDock para o Windows? Veja [o que precisa ser validado](CONTRIBUTING.md#windows) e abra um relato com o modelo **Relato de plataforma**.

## Desenvolvimento

Use Node.js 22.12 ou superior, npm e as CLIs instaladas e autenticadas no sistema. O aplicativo descobre executáveis no PATH e nos diretórios comuns de cada plataforma; o terminal usa o shell do sistema. As instruções para Windows e macOS abaixo valem para quem quer testar ou contribuir; essas plataformas ainda não são suportadas.

```sh
npm ci
npm run dev
```

`npm ci` compila as dependências nativas para o Electron e a plataforma atual. Instale Python e ferramentas C++: make/GCC no Linux, Xcode Command Line Tools no macOS ou Visual Studio Build Tools com C++ no Windows. A compilação local evita carregar binários SQLite que exijam uma glibc mais nova que o sistema Linux de destino. A pasta de dados é `~/.beagledock` (banco `beagledock.db`); ela não faz parte da distribuição. Use `BEAGLEDOCK_DATA_DIR` para um banco isolado de desenvolvimento/teste. Não aponte testes para seus dados pessoais.

A aplicação inicia sem perfil, conversas ou projetos de exemplo. Cadastre os projetos pela interface. Em desenvolvimento, o diretório atual pode ser oferecido como workspace inicial.

## Conversas e permissões

O SQLite guarda a associação entre a conversa do aplicativo e o ID nativo da CLI. Claude e AGY reutilizam um processo com stream-json; após reiniciar ou trocar modelo/permissão, retomam o ID salvo. Codex usa um app-server persistente, retomando o ID salvo com `thread/resume` após reiniciar. Abrir uma conversa pelo histórico importa seu ID e diretório originais, incluindo AGY. O chat acompanha automaticamente perguntas enviadas e a resposta recebida, incluindo atualizações de streaming. Uma conversa iniciada fica associada ao projeto original; crie outra para mudar de projeto. Falha ao retomar nunca dispara uma conversa nova silenciosamente.

As CLIs precisam oferecer os argumentos usados (confira `--help`): Claude com stream-json e controle stdio de permissões, Codex com `app-server`, AGY com stream-json, `--conversation` e hooks. O adaptador AGY usa seu protocolo `event: user` / `init` / `step_update` / `result`; Claude usa envelopes `type`. A consulta não interativa de cotas exige AGY 1.1.11 ou superior.

- **Plano/restrito:** modo de planejamento em Claude/AGY e sandbox read-only no Codex. Ações bloqueadas pelo modo de somente leitura não são liberadas automaticamente.
- **Aceitar edições:** acceptEdits/accept-edits nas CLIs correspondentes e workspace-write no Codex.
- **Acesso total:** exige escolha explícita na interface; permite o modo sem aprovações da CLI.

Essas políticas seguem as garantias de cada CLI; modo de planejamento não equivale a isolamento do sistema operacional. Envios para a mesma conversa entram em fila automática; outras conversas continuam independentes. Anexos não são enviados silenciosamente: enquanto a integração de anexos não estiver disponível, informe o caminho do arquivo no projeto.

## Modelos e consumo

O aplicativo importa IDs dos caches do Claude e Codex e consulta `agy models`. Os seletores de modelo e nível são separados e vêm dos metadados das CLIs: `thinking.effort_options`/`runtime.effort_levels` do Claude, `supported_reasoning_levels` do Codex e variantes rotuladas pelo `agy models`. Não há lista fixa de níveis. Alterações no catálogo substituem as opções disponíveis; sem metadados, o nível fica no padrão da CLI. O backend valida a seleção atual e converte modelo + nível no ID nativo correto do AGY. Respeita `CLAUDE_CONFIG_DIR` e `CODEX_HOME`; sem catálogo, permite usar o modelo padrão da CLI. Não distribui listas inventadas nem baixa pesos de modelos: os provedores usados são os das CLIs autenticadas. Atualize/autentique a CLI para preencher seu catálogo local.

Ferramentas e consumo são atualizados a cada 15 segundos e após uma execução; o catálogo remoto do AGY é consultado no máximo uma vez por minuto. Histórico e skills atualizam a cada 30 segundos. Logs são processados fora do processo da interface.

Claude consulta sua API de uso quando as credenciais OAuth locais estão disponíveis. Codex mostra o último rate-limit registrado com data e indicação de leitura antiga. AGY consulta `agy -p /usage --output-format json` a cada 45 segundos, sem gerar conversa, e mostra cotas separadas por grupo de modelos. O resumo do AGY usa sempre o grupo Gemini Models, independentemente do modelo do chat; os demais grupos permanecem visíveis nos detalhes. Buckets ausentes, desabilitados ou vencidos ficam como **N/D**. Prompts/tokens vêm dos logs locais; tokens em cache são um subconjunto da entrada e não são somados novamente. Os totais de tokens cobrem os últimos sete dias de registros disponíveis, com deduplicação de snapshots. Uma falha de consulta marca dados antigos como desatualizados. Configuração MCP é apresentada como configurada, sem presumir conexão ativa.

## Credenciais e navegador

Chaves cadastradas são criptografadas com `safeStorage` do Electron. O backend Linux `basic_text` é recusado. Quando não há cofre disponível, novas chaves não são salvas. Credenciais antigas em texto puro são migradas quando o desktop abre com o cofre disponível; o SQLite usa secure_delete e uma compactação após a migração. Isso não apaga cópias de segurança anteriores do banco. O renderer recebe apenas indicadores de chave cadastrada. As CLIs continuam usando a própria autenticação; cadastrar uma chave não configura as CLIs nem habilita um provedor API adicional.

A ponte HTTP fica desligada no fluxo desktop, evitando dois backends concorrentes. Para desenvolver exclusivamente no navegador, ative a variável antes de executar `npm run dev:vite`:

```sh
# Linux/macOS
BEAGLEDOCK_BROWSER_BRIDGE=1 npm run dev:vite
```

```powershell
# Windows PowerShell
$env:BEAGLEDOCK_BROWSER_BRIDGE = '1'
npm run dev:vite
```

Abra **http://127.0.0.1:5173**. A ponte exige origem local, token temporário e corpo JSON limitado. Não exponha a porta em túneis ou proxies. O navegador não dispõe do cofre do Electron para cadastrar chaves. O contrato local está em [docs/openapi.json](docs/openapi.json).

## Explorador do ai-memory

A aba de memória lista os projetos do servidor ai-memory, agrupa as páginas por pasta, mostra a saúde da base (órfãs, duplicadas, obsoletas) e renderiza cada página em Markdown, com `[[links]]` navegáveis. A **Manutenção Assistida** abre uma conversa na CLI escolhida (modelo e nível como no chat) com um roteiro para consolidar páginas fragmentadas; por padrão ela apresenta o plano e aguarda a sua aprovação antes de qualquer exclusão. Páginas em `decisions/` nunca são excluídas pelo roteiro, e excluir um projeto exige digitar `workspace/projeto`. O servidor e o token são lidos de `AI_MEMORY_SERVER_URL`/`AI_MEMORY_AUTH_TOKEN` ou dos arquivos de `~/.config/ai-memory` e `~/.local/share/ai-memory`; o token nunca chega à interface.

## Verificação e pacotes

```sh
npm test
npm run typecheck
npm run build:vite
npm run build:electron -- --dir
# Linux com sessão gráfica: teste Electron com CLIs offline
npm run test:desktop
```

Os testes usam bancos temporários, logs de exemplo, processos CLI simulados e um servidor HTTP local sem acesso a contas reais. Eles cobrem retomada, permissões, concorrência, erros, métricas, catálogos, criptografia e proteção da ponte.

## Instalação local (Linux)

O pacote é gerado e instalado na própria máquina; o CI roda apenas tipos, testes e build do frontend, sem publicar instaladores.

```sh
npm ci
npm run build          # typecheck + frontend + pacotes em release/
npm run install:local  # instala o .deb gerado (pede sudo)
```

O `release/` recebe `BeagleDock-<versão>-linux-amd64.deb` e `BeagleDock-<versão>-linux-x86_64.AppImage`.

**Debian/Ubuntu (recomendado):**

Instala em `/opt/BeagleDock`, cria o comando `beagledock` e o atalho no menu de aplicativos. Para atualizar, gere o pacote novo (`npm run build`) e rode `npm run install:local` de novo; para remover, `sudo apt remove beagledock`. Conversas e credenciais ficam em `~/.beagledock` e não são apagadas na remoção.

**AppImage (sem instalar):**

```sh
chmod +x release/BeagleDock-*-linux-x86_64.AppImage
./release/BeagleDock-*-linux-x86_64.AppImage
```

Se o AppImage reclamar de FUSE, instale `libfuse2` (no Debian 13: `sudo apt install libfuse2t64`).

### Versões e changelog

A versão do aplicativo existe só em `package.json`. As mudanças perceptíveis ao usuário são registradas em `CHANGELOG.md` (seção `Unreleased`) e, para lançar, use `npm version patch|minor|major`: o script move o `Unreleased` para a nova versão e sincroniza links e `docs/openapi.json`, sem commit nem tag. As regras completas estão em `AGENTS.md`.

Para só testar o empacotamento sem gerar instaladores, use `npm run build:electron -- --dir` e execute `release/linux-unpacked/beagledock`. Não há atualização automática do aplicativo nem assinatura de código; os botões de atualização da interface atualizam apenas as CLIs.

Referência do protocolo Codex: [documentação oficial de modo não interativo](https://learn.chatgpt.com/docs/non-interactive-mode).

Referências do AGY: [relatório de uso](https://antigravity.google/docs/cli/commands/usage/) e [protocolo headless](https://antigravity.google/docs/cli/headless).

Os ícones de provedores são arquivos dos sites oficiais, empacotados para uso offline; as fontes e hashes estão em [public/providers/SOURCES.md](public/providers/SOURCES.md).

As configurações mostram as permissões globais nativas de cada CLI. Salvar altera somente os campos escolhidos, preservando regras e demais opções. No chat, “Global da CLI” herda esses padrões nas próximas execuções; uma seleção específica vale apenas para a conversa. O chat apresenta pedidos elegíveis de aprovação por ação. No AGY, plano/restrito aplicam regras explícitas para bloquear comandos, MCP e acesso web e escrita. Aceitar edições pode solicitar aprovação de comandos pelo painel. Regras globais de negação são preservadas.

O sino guarda avisos de novos modelos detectados nos catálogos sincronizados, novas instalações das três CLIs suportadas e versões estáveis publicadas. A consulta de versões ocorre a cada hora e pode ser acionada manualmente; falhas ficam visíveis. Fontes: releases oficiais de Claude Code/Codex no GitHub e manifesto oficial do atualizador AGY. Nenhuma lista de modelos é fornecida por esses avisos.

“Atualizar CLI” executa `claude update` ou `agy update`; para Codex identifica instalações npm ou Homebrew. No npm mantém o prefixo da instalação detectada. Instalações não reconhecidas exigem seu gerenciador original. Atualizações aguardam as execuções terminarem, encerram processos ociosos e preservam os identificadores das conversas para retomada. Não executam elevação automática de privilégios.

Referências: [permissões do Claude](https://code.claude.com/docs/en/permissions), [configurações Codex](https://learn.chatgpt.com/docs/config-file/config-reference), [schema AGY](https://antigravity.google/schemas/v1/settings.json) e [atualização AGY](https://antigravity.google/docs/cli/commands/changelog).

Durante uma resposta, o chat continua aceitando mensagens. Elas entram em uma fila por conversa e seguem automaticamente, na ordem, após o turno atual, mantendo o identificador nativo. A fila de execução fica no processo atual; mensagens já salvas continuam no histórico depois de reiniciar. Excluir uma conversa cancela também seus envios pendentes.

O shell usa xterm, preserva cores ANSI e mostra comandos, diagnósticos e resultados incrementais recebidos da CLI. Quando o provedor só publica a saída de uma ferramenta ao terminar, o shell recebe essa saída nesse momento; o aplicativo não consegue antecipar bytes que a CLI não transmite. Títulos de saudações são substituídos pelo primeiro pedido com assunto identificável, inclusive no histórico salvo.

A marca é **BeagleDock**, com [mascote beagle](public/brand/beagledock-logo.png). Na primeira execução após a renomeação, o aplicativo migra automaticamente os dados e as configurações da versão anterior (pasta de dados, banco, perfil do Electron e hook de aprovação do AGY) sem perder conversas. As chaves de API cadastradas no app, cifradas pelo cofre do sistema com o nome antigo, podem precisar ser recadastradas; as CLIs mantêm a própria autenticação. `BEAGLEDOCK_DATA_DIR` configura um diretório alternativo. Detalhes e prompt do logo: [identidade visual](docs/brand/LOGO.md).

O chat agora apresenta pedidos de permissão por ação nos três provedores. Claude usa o protocolo de controle stdio; Codex usa os pedidos do app-server; AGY usa um hook `PreToolUse` com socket autenticado, ativo apenas quando lançado pelo BeagleDock. O hook preserva as outras configurações e guarda uma cópia anterior de `hooks.json`; fora do BeagleDock delega à política original. Autorizar uma vez não cria uma liberação global nem remove regras explícitas de bloqueio.

O streaming lê artefatos de tarefas da sessão nativa para Claude/AGY e usa os deltas do app-server para Codex. O chat mostra atividade e tempo decorrido durante ferramentas. Cenários, versões verificadas e diagnóstico opcional com CLIs reais: [contratos de CLI](test/PROTOCOLS.md).

**Parar** interrompe a execução e os comandos filhos da CLI, cancela os envios já na fila e as aprovações pendentes daquela conversa. O identificador nativo, as mensagens e o texto parcial da resposta são mantidos. Novas mensagens podem retomar a mesma conversa; os outros chats continuam independentes. Com uma execução ativa, `para`, `parar`, `pare`, `cancela`, `cancelar`, `stop` e `/stop` também acionam a interrupção imediatamente, sem entrar na fila.
