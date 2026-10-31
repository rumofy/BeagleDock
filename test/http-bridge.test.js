const { test } = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const { createHttpBridge } = require("../electron/http-bridge");
test("local bridge authenticates, rejects cross-origin/malformed/oversized calls and streams events", async (t) => {
  const server = http.createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  let invocations = 0;
  let emit;
  const bridge = {
    subscribe: (fn) => {
      emit = fn;
      return () => {};
    },
    invoke: async (method, args) => {
      invocations++;
      return { method, args };
    },
  };
  const handler = createHttpBridge({
    bridge,
    token: "test-secret",
    origin,
    maxBody: 200,
  });
  server.on("request", handler.handle);
  t.after(() => {
    handler.close();
    server.closeAllConnections();
    server.close();
  });
  const headers = {
    "Content-Type": "application/json",
    Authorization: "Bearer test-secret",
    Origin: origin,
  };
  const call = (body, extra = {}, method = "POST") =>
    fetch(origin + "/__capy/invoke", {
      method,
      headers: { ...headers, ...extra },
      body: method === "GET" ? undefined : body,
    });
  assert.equal((await call("{}", { Authorization: "" })).status, 401);
  assert.equal(
    (await call("{}", { Origin: "https://untrusted.example" })).status,
    403,
  );
  assert.equal(
    (await call("{}", { "Sec-Fetch-Site": "cross-site" })).status,
    403,
  );
  assert.equal(
    (await call("{}", { "Content-Type": "text/plain" })).status,
    415,
  );
  assert.equal((await call("", {}, "GET")).status, 405);
  assert.equal((await call("{")).status, 400);
  assert.equal(
    (await call(JSON.stringify({ method: "constructor", args: [] }))).status,
    400,
  );
  assert.equal(
    (await call(JSON.stringify({ method: "ptyWrite", args: "not-an-array" })))
      .status,
    400,
  );
  assert.equal((await call("x".repeat(201))).status, 413);
  assert.equal(invocations, 0);
  const res = await call(JSON.stringify({ method: "getSavedState", args: [] }));
  assert.equal(res.status, 200);
  assert.equal((await res.json()).result.method, "getSavedState");
  assert.equal(invocations, 1);
  assert.equal((await fetch(origin + "/__capy/events")).status, 401);
  const controller = new AbortController();
  const stream = await fetch(origin + "/__capy/events?token=test-secret", {
    headers: { Origin: origin },
    signal: controller.signal,
  });
  assert.equal(stream.status, 200);
  const reader = stream.body.getReader();
  await reader.read();
  emit("tools-update", { ok: true });
  const chunk = await reader.read();
  assert.match(Buffer.from(chunk.value).toString(), /tools-update/);
  controller.abort();
});
