# Validation of the background mode and the tray (issue #29)

Closing the window sends the app to the tray without interrupting conversations, queues and permission requests.
Only “Quit” in the tray closes the app, with a confirmation if a conversation is running (delivered in 0.2.0). In
this version:

- The tray icon gets a state badge: none (idle), amber (running) and red (waiting for permission).
- The menu lists the conversations in progress (the ones waiting for permission first, up to 8) and clicking one
  opens the app on that conversation. Clicking the reply or pending permission notification does the same.
- Settings: “Keep BeagleDock in the tray when closing the window” (off, closing the window asks to quit, with the
  same confirmation) and “Start with the system” (Linux: `~/.config/autostart/beagledock.desktop`, opening
  straight to the tray with `--hidden`; if the tray doesn't work, the window shows normally).

## Evidence

- Simulated: `test/background.test.js` (BGRA badge, icon switch by state, menu with the conversations, click on
  the menu and on the notification, closing with the background mode off) and `test/autostart.test.js` (start
  file, AppImage, `XDG_CONFIG_HOME`, failures).
- Integrated: `test:desktop` turns the preferences on and off, checks the start file in the test's HOME and that
  the preferences survive the restart, and sends `open-session` with the settings screen open to check that the
  interface goes back to the chat on the requested conversation. Closing the window with a session running and
  keeping it active was already covered.
- Not verified: the badge drawn in a real desktop environment's tray (the tests use simulated `nativeImage` and
  `Tray`) or the real start with the system; check the icon on the first run.
