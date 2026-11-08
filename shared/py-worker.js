// Browser Web Worker (module worker). Start it with
//   new Worker(new URL("./py-worker.js", import.meta.url), {type: "module"})
// Protocol: main -> {id, code, exprs}; worker -> {id, type: "started"} then {id, type: "done", run, values}.
import { loadPyodide } from "https://cdn.jsdelivr.net/pyodide/v0.26.4/full/pyodide.mjs";
import { runIn } from "./py-core.js";

const ready = loadPyodide({ indexURL: "https://cdn.jsdelivr.net/pyodide/v0.26.4/full/" });
// Surface a load failure to the page instead of failing silently.
ready.catch((e) => self.postMessage({ type: "load-error", message: String((e && e.message) || e) }));

self.onmessage = async (ev) => {
  const { id, code, exprs } = ev.data;
  try {
    const pyodide = await ready;
    const res = await runIn(pyodide, code, exprs, () => self.postMessage({ id, type: "started" }));
    self.postMessage({ id, type: "done", ...res });
  } catch (e) {
    self.postMessage({ id, type: "done", run: internalError(e), values: [] });
  }
};

function internalError(e) {
  return {
    ok: false,
    stdout: "",
    error: { type: "InternalError", message: String((e && e.message) || e), line: null },
    timedOut: false,
  };
}
