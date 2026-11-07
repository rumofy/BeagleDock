const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const ts = require("typescript");

const ctx = {
  exports: {},
  require: () => ({ t: (key) => key }),
};
vm.runInNewContext(ts.transpileModule(fs.readFileSync("src/hooks/useHistoryActions.ts", "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS },
}).outputText, ctx);
const { useHistoryActions } = ctx.exports;

function actions(provider, terminal) {
  const pastes = [], drafts = [], modals = [], tabs = [];
  const session = { id: `${provider}-session`, providerId: provider };
  return {
    pastes, drafts, modals, tabs,
    handlers: useHistoryActions({
      sessions: { currentSession: session },
      cliTerminals: {
        hasStarted: () => terminal,
        isTerminal: (id) => terminal && id === session.id,
        pasteToTerminal: async (...args) => pastes.push(args),
      },
      setInputMessage: (text) => drafts.push(text),
      setActiveTab: (tab) => tabs.push(tab),
      setShowSkillsModal: (show) => modals.push(show),
      setShowHistoryModal: (show) => modals.push(show),
    }),
  };
}

for (const provider of ["claude", "codex", "antigravity"]) {
  test(`${provider}: skill and history selections paste into the current terminal without submitting`, () => {
    const state = actions(provider, true);
    state.handlers.handleSelectSkill({ name: "example-skill" });
    let stopped = false;
    state.handlers.handleSelectHistoryPrompt({ prompt: "previous request" }, {
      stopPropagation: () => { stopped = true; },
    });
    assert.equal(stopped, true);
    assert.deepEqual(state.pastes.map((args) => Array.from(args)), [
      [`${provider}-session`, "use skill example-skill"],
      [`${provider}-session`, "previous request"],
    ]);
    assert.deepEqual(state.drafts, []);
    assert.deepEqual(state.modals, [false, false]);
    assert.deepEqual(state.tabs, ["chat", "chat"]);
  });

  test(`${provider}: experimental chat keeps skill and history selections in its draft`, () => {
    const state = actions(provider, false);
    state.handlers.handleSelectSkill({ name: "example-skill" });
    state.handlers.handleSelectHistoryPrompt({ prompt: "previous request" });
    assert.deepEqual(state.drafts, ["use skill example-skill", "previous request"]);
    assert.deepEqual(state.pastes, []);
  });
}
