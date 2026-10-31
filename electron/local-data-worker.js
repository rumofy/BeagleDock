const { parentPort, workerData } = require("worker_threads");
const { readLocalMetrics } = require("./telemetry");
const { createHistory } = require("./history");
try {
  const { action, args } = workerData;
  const reader = createHistory();
  const result =
    action === "metrics"
      ? readLocalMetrics()
      : action === "history"
        ? reader.history()
        : reader.conversation(...args);
  parentPort.postMessage({ result });
} catch (error) {
  parentPort.postMessage({ error: error.message });
}
