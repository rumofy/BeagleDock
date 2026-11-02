# BeagleDock

## Escopo das integrações

Pedidos de funcionalidade e correções nas integrações abrangem **Claude Code, Codex CLI e Antigravity (AGY)**. Não entregar uma mudança somente para um deles quando o usuário não restringir explicitamente o escopo. Preservar o identificador nativo e o histórico de cada conversa.

Manter testes de contrato dos três protocolos, testes unitários das regras e testes integrados do aplicativo. Ao validar streaming, verificar dados intermediários antes da conclusão; eventos finais simulados não comprovam saída ao vivo. Registrar versões verificadas e distinguir evidência simulada de diagnóstico com CLI real.

Diagnóstico com CLI real roda sempre numa pasta criada por `node test/probe-dir.cjs <nome>` (ou `makeProbeDir` nos scripts de teste), nunca em `/tmp` solto nem em `mktemp -d`: o `.ai-memory.toml` dela concentra as sessões no projeto `beagledock-probes` em vez de criar um projeto novo no ai-memory a cada pasta.

## Versões e distribuição

O aplicativo se chama BeagleDock e usa a licença Apache-2.0. A versão existe **só** em `package.json`: nunca escrever o número da versão em README, docs, código ou nomes de arquivo fixos. Quem precisa dela lê de `package.json`/`app.getVersion()`; `docs/openapi.json` é sincronizado pelo script de versão e verificado nos testes.

### Changelog

`CHANGELOG.md` segue [Keep a Changelog 1.1.0](https://keepachangelog.com/pt-BR/1.1.0/) e [SemVer](https://semver.org/lang/pt-BR/):

- Toda mudança perceptível ao usuário entra em `## [Unreleased]` no mesmo trabalho que a introduz, numa destas seções, nesta ordem: `Adicionado`, `Alterado`, `Descontinuado`, `Removido`, `Corrigido`, `Segurança`. Uma linha por mudança, em pt-BR, escrita para o usuário (o quê e por quê), sem nomes de arquivos internos nem detalhes de implementação. Refatorações e testes sem efeito visível não entram.
- Nunca editar à mão as seções de versões já lançadas, a data nem os links do rodapé.
- Lançar versão: `npm version patch|minor|major` (correção / funcionalidade / quebra de compatibilidade). O script move o `Unreleased` para `## [x.y.z] - AAAA-MM-DD`, atualiza os links de comparação e o `docs/openapi.json`. Ele não faz commit nem tag; isso só quando o usuário pedir. Os nomes antigos (CapyAI, Bleagle/BleagleDock) não são usados em código, identidades ou documentação; a migração única de dados, configurações e hooks antigos para as identidades BeagleDock deve continuar funcionando sem perder sessões nem duplicar aprovações.

A distribuição é apenas local, em Linux (`.deb`/AppImage gerados na própria máquina). O CI (`.github/workflows/`) só roda tipos, testes e build do frontend nos PRs e publica a release no GitHub quando a tag `vX.Y.Z` é enviada, com as notas do `CHANGELOG.md` e sem pacotes anexados. Não adicionar empacotamento no CI nem alvos para outras plataformas sem pedido explícito. Ao lançar uma versão e integrar a branch de release (`release/X.Y.Z`) na `main`, criar e enviar a tag da versão imediatamente (`git tag vX.Y.Z <commit> && git push origin vX.Y.Z`) para publicar a release no GitHub automaticamente.

## Estrutura do frontend

`src/App.tsx` só compõe o layout. Cada área fica em `src/features/<área>/` (componentes, hooks e utilitários próprios); estado compartilhado e chamadas ao backend ficam em hooks (`src/hooks/`) e no cliente tipado da API (`src/api/`), nunca via `(window as any)`. Componentes de interface reutilizáveis ficam em `src/components/`.

## Git

Somente criar commits e PRs quando solicitado. Ao concluir a integração de uma branch de release (`release/X.Y.Z`) na `main`, a criação e o push da tag `vX.Y.Z` são imediatos para disparar a release. Não incluir coautoria, atribuição de IA ou links de sessão em commits e PRs.
