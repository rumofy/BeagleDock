# Validation of the background mode and the tray (issue #29)

Closing the window sends the app to the tray without interrupting conversations, queues and permission requests.
Only “Quit” in the tray closes the app, with a confirmation if a conversation is running (delivered in 0.2.0). In
this version:

- The tray icon gets a state badge: none (idle), amber (running), blue (replies not seen yet) and red (waiting for
  permission).
- The menu lists the conversations in progress (the ones waiting for permission first, up to 8) and clicking one
  opens the app on that conversation.
- With the window minimized or behind others, a new permission and a reply pop up as system notifications
  (permissions as critical, so they stay until seen, and leave the screen once answered anywhere); clicking one opens
  its conversation. Each pop-up stays referenced until closed, so its click isn't lost to garbage collection. Pending
  permissions (⚠) and replies that arrived with the window out of focus (✉) are also listed in the tray menu until
  opened, cleared or the window gets focus. A new permission or reply also flags the window in the taskbar.
- Settings: “Show system pop-ups” (on by default; off leaves only the tray menu and the taskbar flag).
- Settings: “Keep BeagleDock in the tray when closing the window” (off, closing the window asks to quit, with the
  same confirmation) and “Start with the system” (Linux: `~/.config/autostart/beagledock.desktop`, opening
  straight to the tray with `--hidden`; if the tray doesn't work, the window shows normally).

## Evidence

- Simulated: `test/background.test.js` (BGRA badge, icon switch by state, menu with the conversations, click on
  the menu and on the tray notices, closing with the background mode off) and `test/autostart.test.js` (start
  file, AppImage, `XDG_CONFIG_HOME`, failures).
- Integrated: `test:desktop` turns the preferences on and off, checks the start file in the test's HOME and that
  the preferences survive the restart, and sends `open-session` with the settings screen open to check that the
  interface goes back to the chat on the requested conversation. Closing the window with a session running and
  keeping it active was already covered.
- Real environment (Linux Mint, Cinnamon): Electron's `Notification` is supported and shows a pop-up from the project's
  Electron, and a minimized window reports `isFocused() === false`, so the pop-ups fire when minimized.
- Not verified: the badge drawn in a real desktop environment's tray (the tests use simulated `nativeImage` and
  `Tray`) or the real start with the system; check the icon on the first run.
