# Changelog

As mudanças de cada versão são registradas aqui. O projeto segue versionamento semântico.

## [Unreleased]

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

### Distribuição

- Licença Apache-2.0, avisos de terceiros e changelog incluídos nos pacotes.
- Dados, identidade do cofre e identificadores internos anteriores preservados por compatibilidade.
- Pacotes sem assinatura de código nesta versão; execução real das três CLIs em Windows e macOS ainda requer validação nessas plataformas.

[Unreleased]: https://github.com/rumofy/BeagleDock/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/rumofy/BeagleDock/releases/tag/v0.1.0
