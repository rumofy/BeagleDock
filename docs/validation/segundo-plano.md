# Validação do segundo plano e da bandeja (issue #29)

Fechar a janela leva o app para a bandeja sem interromper conversas, filas e pedidos de permissão. Só “Sair”
na bandeja encerra o app, com confirmação se houver conversa em execução (entregue na 0.2.0). Nesta versão:

- O ícone da bandeja ganha um selo de estado: nenhum (ocioso), âmbar (rodando) e vermelho (aguardando permissão).
- O menu lista as conversas em andamento (as que aguardam permissão primeiro, até 8) e clicar em uma abre o
  app naquela conversa. O clique na notificação de resposta ou de permissão pendente faz o mesmo.
- Configurações: “Manter o BeagleDock na bandeja ao fechar a janela” (desligado, fechar a janela pede para sair,
  com a mesma confirmação) e “Iniciar junto com o sistema” (Linux: `~/.config/autostart/beagledock.desktop`,
  abrindo já na bandeja com `--hidden`; se a bandeja não funcionar, a janela aparece normalmente).

## Evidência

- Simulada: `test/background.test.js` (selo em BGRA, troca de ícone por estado, menu com as conversas, clique no
  menu e na notificação, fechar com o segundo plano desligado) e `test/autostart.test.js` (arquivo de início,
  AppImage, `XDG_CONFIG_HOME`, falhas).
- Integrada: `test:desktop` liga e desliga as preferências, confere o arquivo de início no HOME do teste e que as
  preferências sobrevivem à reinicialização, e envia `open-session` com a tela de configurações aberta para
  conferir que a interface volta ao chat na conversa pedida. Fechar a janela com sessão rodando e mantê-la ativa
  já era coberto.
- Não verificado: o selo desenhado na bandeja de um ambiente de área de trabalho real (os testes usam
  `nativeImage` e `Tray` simulados) nem o início real com o sistema; confira o ícone na primeira execução.
