// The phone always uses the chat, and the desktop may have the same conversation open in the CLI's
// terminal. Only one process may use a native conversation, so before a chat turn an open terminal
// hands the conversation over:
// - replying or waiting for an answer (an approval, a menu): it is left alone and the chat waits;
// - idle: the end-of-turn sync still retrying finishes first (the CLI may save its reply after going
//   idle, and a closed terminal's late reply would never reach BeagleDock's history), then the terminal
//   closes, its last messages are saved and the desktop is told the CLI ended (Reopen resumes the native
//   conversation, with the chat's turns).
// One handover per conversation at a time: a second message waits for it instead of overtaking it.
function createTerminalHandover({ isOpen, status, pendingSync, close, endHistory, notifyClosed, busyError }) {
  const handovers = new Map();
  const busy = (sessionId) => ["running", "waiting_input"].includes(status(sessionId));

  function handOver(sessionId) {
    const pending = handovers.get(sessionId);
    if (pending) return pending.catch(() => {}).then(() => handOver(sessionId));
    if (!isOpen(sessionId)) return Promise.resolve({ ok: true });
    if (busy(sessionId)) return Promise.resolve({ ok: false, error: busyError() });
    const handover = (async () => {
      await pendingSync(sessionId)?.catch(() => {});
      if (!isOpen(sessionId)) return { ok: true };
      if (busy(sessionId)) return { ok: false, error: busyError() };
      close(sessionId);
      await endHistory(sessionId);
      notifyClosed(sessionId);
      return { ok: true };
    })();
    handovers.set(sessionId, handover);
    void handover.finally(() => {
      if (handovers.get(sessionId) === handover) handovers.delete(sessionId);
    }).catch(() => {});
    return handover;
  }

  return { handOver };
}

module.exports = { createTerminalHandover };
