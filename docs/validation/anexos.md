# Validação dos anexos do chat (issue #15)

Imagens e arquivos anexados (colar, arrastar ou escolher) e `@arquivo` do projeto são normalizados para o
formato de cada CLI. O que a CLI não suporta vira aviso na interface; não há anexo simulado.

| CLI | Imagem | Outros arquivos e `@arquivo` |
| --- | --- | --- |
| Claude Code | bloco `image` em base64 na mensagem de usuário (`--input-format stream-json`) | caminho no texto |
| Codex CLI | `localImage` no `turn/start` do app-server | `mention` (nome + caminho) |
| Antigravity | sem campo nativo verificado: caminho da imagem no texto, com aviso | caminho no texto |

Os anexos ficam em `attachments/<conversa>/` na pasta de dados do app (modo 600). Limites: 10 arquivos por
mensagem e 15 MB por arquivo. `@arquivo` só vira menção se o arquivo existir dentro do projeto da conversa.

## Evidência real, 2026-10-31

Imagem PNG vermelha 16×16 anexada com o pedido “responda a cor dominante em uma palavra, sem usar ferramenta”:

| CLI | Versão | Resposta |
| --- | --- | --- |
| Claude Code | 2.1.316 | `red` |
| Codex CLI | 0.166.0 | `red` |
| Antigravity | 1.4.12 | `red`, abrindo a imagem pelo caminho enviado no texto (o app avisa que não há campo nativo) |

## Evidência simulada

- Contratos do envio nos três protocolos: `test/attachments.test.js` (Claude e Antigravity) e
  `test/codex-stream.test.js` (Codex).
- Regras de gravação, limites, menções e busca de arquivos: `test/attachments.test.js`.
- Integrado: `test:desktop` solta uma imagem e um arquivo no compositor, envia e confere o que a CLI da
  conversa recebeu.
