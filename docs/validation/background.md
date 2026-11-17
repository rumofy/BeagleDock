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
  same confirmation) and “Start with the system” (Linux: `~/.config/autostart/beagledock.desktop`; Windows and
  macOS: the user's login items through Electron, with no administrator rights; either way it opens straight to
  the tray with `--hidden`, and if the tray doesn't work the window shows normally).
- Terminal mode: the end-of-turn notification ("Your turn") reads the CLI's native history right away and goes out
  as soon as the reply's text is there, or after at most 1.5 s with the generic text; the history retries
  (0.8 s, 1.5 s, 3 s) go on only to save the reply. Before 0.18.0 the notification waited for the retries, up to
  about 5 s after the CLI finished. Antigravity's end of turn is still detected by 3 s of silence on its screen.
- Windows: the app sets its AppUserModelId (`dev.beagledock.desktop`, the installer shortcut's), so the
  notifications show as BeagleDock and group with it.

## Evidence

- Simulated: `test/background.test.js` (BGRA badge, icon switch by state, menu with the conversations, click on
  the menu and on the tray notices, closing with the background mode off) and `test/autostart.test.js` (start
  file, AppImage, `XDG_CONFIG_HOME`, Windows/macOS login items, failures) and `test/terminal-history.test.js`
  (first read without waiting, then the retries).
- Integrated: `test:desktop` turns the preferences on and off, checks the start file in the test's HOME and that
  the preferences survive the restart (on Windows it leaves “Start with the system” alone, since the login item
  is the real user's registry, shared with an installed BeagleDock), and sends `open-session` with the settings screen open to check that the
  interface goes back to the chat on the requested conversation. Closing the window with a session running and
  keeping it active was already covered.
- Real environment (Linux Mint, Cinnamon): Electron's `Notification` is supported and shows a pop-up from the project's
  Electron, and a minimized window reports `isFocused() === false`, so the pop-ups fire when minimized.
- Not verified: the badge drawn in a real desktop environment's tray (the tests use simulated `nativeImage` and
  `Tray`) or the real start with the system; check the icon on the first run.
