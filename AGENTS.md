# BeagleDock

## Escopo das integrações

Pedidos de funcionalidade e correções nas integrações abrangem **Claude Code, Codex CLI e Antigravity (AGY)**. Não entregar uma mudança somente para um deles quando o usuário não restringir explicitamente o escopo. Preservar o identificador nativo e o histórico de cada conversa.

Manter testes de contrato dos três protocolos, testes unitários das regras e testes integrados do aplicativo. Ao validar streaming, verificar dados intermediários antes da conclusão; eventos finais simulados não comprovam saída ao vivo. Registrar versões verificadas e distinguir evidência simulada de diagnóstico com CLI real.

## Versões e distribuição

O aplicativo se chama BeagleDock e usa a licença Apache-2.0. Registrar funcionalidades, correções e mudanças de distribuição em `CHANGELOG.md`, na seção `Unreleased` até a próxima versão. Manter a versão do aplicativo sincronizada entre `package.json`, lockfile e contrato local. Preservar as identidades de armazenamento e hooks legados para não perder sessões, credenciais ou duplicar aprovações.

## Git

Somente criar commits e PRs quando solicitado. Não incluir coautoria, atribuição de IA ou links de sessão em commits e PRs.
