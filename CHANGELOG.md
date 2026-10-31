# Changelog

As mudanças de cada versão são registradas aqui. O projeto segue versionamento semântico.

## [Unreleased]

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

[Unreleased]: https://github.com/rumofy/BeagleDock/compare/v0.1.2...HEAD
[0.1.2]: https://github.com/rumofy/BeagleDock/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/rumofy/BeagleDock/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/rumofy/BeagleDock/releases/tag/v0.1.0
