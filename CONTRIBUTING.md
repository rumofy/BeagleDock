# Como contribuir

Obrigado pelo interesse no BeagleDock! Issues e PRs são bem-vindos, em português ou inglês.

## Antes de começar

- Leia o [README](README.md) para preparar o ambiente (`npm ci`, `npm run dev`).
- As regras do projeto (versão, changelog, estrutura do frontend, Git) estão em [AGENTS.md](AGENTS.md). Elas valem para pessoas e agentes de IA.
- Mudanças nas integrações devem cobrir **Claude Code, Codex CLI e Antigravity**, salvo quando a issue restringir o escopo.
- Toda mudança perceptível ao usuário entra em `## [Unreleased]` no [CHANGELOG.md](CHANGELOG.md).

## Antes de abrir o PR

```sh
npm test
npm run typecheck
npm run build:vite
```

Use `BEAGLEDOCK_DATA_DIR` apontando para uma pasta temporária ao testar; nunca use seus dados pessoais em testes. Ao mexer em streaming ou protocolos das CLIs, siga [test/PROTOCOLS.md](test/PROTOCOLS.md) e diga no PR se a evidência é de CLI simulada ou real, com as versões usadas.

## Windows

O BeagleDock é suportado oficialmente só no Linux. O código já trata caminhos, launchers `.cmd` e o shell do Windows, mas o aplicativo **nunca foi validado** nessa plataforma. Se você usa Windows, sua ajuda é muito valiosa.

### Preparar o ambiente

Node.js 22.12 ou superior, Python e Visual Studio Build Tools com a carga de trabalho C++ (para compilar `node-pty` e `sqlite3`). Depois:

```powershell
npm ci
npm test
$env:BEAGLEDOCK_DATA_DIR = "$env:TEMP\beagledock-teste"
npm run dev
```

### O que precisa ser validado

Para cada CLI instalada (Claude Code, Codex CLI, Antigravity):

1. **Descoberta:** o app encontra a CLI e mostra versão, modelos e níveis.
2. **Conversa:** enviar uma mensagem, ver a resposta chegando aos poucos (streaming) e reabrir a conversa depois de reiniciar o app.
3. **Aprovação:** em "Aceitar edições", pedir um comando e aprovar/recusar pelo painel. No Antigravity isso usa um hook com socket local, o ponto mais sensível no Windows.
4. **Parar:** interromper uma resposta com um comando longo em execução e conferir no Gerenciador de Tarefas se não sobrou processo filho.
5. **Terminal:** abrir o shell integrado e conferir cores, redimensionamento e entrada de texto.
6. **Cotas e consumo:** os indicadores de uso aparecem para cada CLI.
7. **Empacotamento (opcional):** `npm run build:electron -- --win --dir` e abrir o executável gerado.

Registre o resultado com o modelo de issue **Relato de plataforma**, mesmo que tudo funcione: um relato positivo também ajuda. Correções específicas do Windows devem manter o comportamento no Linux e, quando possível, vir com teste em `test/` que simule a plataforma (veja `test/data.test.js`).

## macOS

Também não testado. Relatos com o mesmo roteiro são bem-vindos. Pontos já conhecidos: o Claude Code pode guardar credenciais no Keychain (a cota pode não aparecer) e o app não é assinado.

## Segurança

Não abra issue pública para vulnerabilidades. Veja [SECURITY.md](SECURITY.md).
