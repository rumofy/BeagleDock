// This hook delegates unchanged outside BeagleDock; it never changes command arguments.
const net = require("net");
const socket = process.env.BEAGLEDOCK_APPROVAL_SOCKET,
  token = process.env.BEAGLEDOCK_APPROVAL_TOKEN;
if (!socket || !token) {
  console.log(JSON.stringify({ decision: "allow" }));
  process.exit(0);
}
let input = "",
  finished = false;
const finish = (result) => {
  if (finished) return;
  finished = true;
  console.log(JSON.stringify(result));
  process.exit(0);
};
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  input += chunk;
  if (input.length > 1024 * 1024)
    finish({ decision: "deny", reason: "The request exceeded the size limit." });
});
process.stdin.on("end", () => {
  let request;
  try {
    request = JSON.parse(input);
  } catch {
    return finish({ decision: "deny", reason: "Invalid request." });
  }
  const client = net.createConnection(socket);
  let buffer = "";
  client.on("connect", () =>
    client.write(JSON.stringify({ token, request }) + "\n"),
  );
  client.on("data", (chunk) => {
    buffer += chunk;
    if (buffer.length > 65536) return finish({ decision: "deny" });
    const line = buffer.split("\n")[0];
    try {
      finish(JSON.parse(line));
    } catch {}
  });
  client.on("error", () =>
    finish({
      decision: "deny",
      reason: "The approval interface isn't available.",
    }),
  );
  client.on("close", () =>
    finish({ decision: "deny", reason: "The approval was closed." }),
  );
});
setTimeout(
  () => finish({ decision: "deny", reason: "The approval timed out." }),
  125000,
).unref();
