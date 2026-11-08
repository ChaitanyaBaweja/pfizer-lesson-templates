// Node twin of py-worker.js, for tests. Same protocol, same py-core.js.
import { parentPort } from "node:worker_threads";
import { loadPyodide } from "pyodide";
import { runIn } from "./py-core.js";

const ready = loadPyodide();
ready.catch((e) => parentPort.postMessage({ type: "load-error", message: String((e && e.message) || e) }));

parentPort.on("message", async ({ id, code, exprs }) => {
  try {
    const pyodide = await ready;
    const res = await runIn(pyodide, code, exprs, () => parentPort.postMessage({ id, type: "started" }));
    parentPort.postMessage({ id, type: "done", ...res });
  } catch (e) {
    parentPort.postMessage({
      id,
      type: "done",
      run: {
        ok: false,
        stdout: "",
        error: { type: "InternalError", message: String((e && e.message) || e), line: null },
        timedOut: false,
      },
      values: [],
    });
  }
});
