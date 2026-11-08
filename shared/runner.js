// Main-thread runner. Runs student code in a worker so the page never freezes.
// A timeout terminates the worker; the next call starts a fresh one.
//
// Browser:  import { run, evalChecks } from "./runner.js"
// Node:     const r = await createNodeRunner(); r.run(...); r.close()

const DEFAULT_TIMEOUT_MS = 5000;
// Loading Pyodide and packages like pandas can be slow; that time is not
// charged to the student's 5 seconds (the timer starts when the worker says
// "started"). This only guards against a stuck load.
const LOAD_TIMEOUT_MS = 90000;

function failed(type, message) {
  return { ok: false, stdout: "", error: { type, message, line: null }, timedOut: false };
}

const TIMED_OUT = { ok: false, stdout: "", error: null, timedOut: true };

// workerFactory() -> {post(msg), onMessage(cb), onFail(cb), terminate()}
export function createRunner(workerFactory) {
  let w = null;
  let chain = Promise.resolve();
  let nextId = 1;

  function kill() {
    if (w) {
      const old = w;
      w = null;
      try {
        old.terminate();
      } catch {
        /* already gone */
      }
    }
  }

  // One handler pair per worker (no listener build-up); `current` is the run in flight.
  let current = null;

  function startWorker() {
    const worker = workerFactory();
    worker.onMessage((msg) => {
      if (w === worker && current) current.onMessage(msg);
    });
    worker.onFail((err) => {
      if (w === worker && current) current.onFail(err);
    });
    return worker;
  }

  function exec(code, exprs, timeoutMs) {
    return new Promise((resolve) => {
      const id = nextId++;
      let timer = null;
      let settled = false;
      // Creating a worker can throw synchronously (blocked by the embed, no
      // Worker support). That is a load failure, not a rejected promise.
      try {
        if (!w) w = startWorker();
      } catch (err) {
        w = null;
        resolve({
          run: failed("LoadError", `Python couldn't start: ${String((err && err.message) || err)}`),
          values: [],
        });
        return;
      }
      const worker = w;

      const finish = (result) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (current === handlers) current = null;
        resolve(result);
      };
      const arm = (ms, onExpire) => {
        clearTimeout(timer);
        timer = setTimeout(onExpire, ms);
      };

      const handlers = {
        onMessage(msg) {
          if (msg.type === "load-error") {
            kill();
            finish({ run: failed("LoadError", msg.message), values: [] });
          } else if (msg.id !== id) {
            // stale message from an earlier run; ignore
          } else if (msg.type === "started") {
            arm(timeoutMs, () => {
              kill();
              finish({ run: { ...TIMED_OUT }, values: [] });
            });
          } else if (msg.type === "done") {
            // Self-heal: an internal failure means the worker's state is suspect.
            if (msg.run && msg.run.error && msg.run.error.type === "InternalError") kill();
            finish({ run: msg.run, values: msg.values });
          }
        },
        onFail(err) {
          kill();
          finish({ run: failed("InternalError", String((err && err.message) || err)), values: [] });
        },
      };
      current = handlers;

      arm(LOAD_TIMEOUT_MS, () => {
        kill();
        finish({ run: failed("LoadError", "Python took too long to load."), values: [] });
      });
      try {
        worker.post({ id, code, exprs });
      } catch (err) {
        kill();
        finish({ run: failed("LoadError", `Python couldn't start: ${String((err && err.message) || err)}`), values: [] });
      }
    });
  }

  function enqueue(code, exprs, timeoutMs) {
    const p = chain.then(() => exec(code, exprs, timeoutMs));
    chain = p.catch(() => {});
    return p;
  }

  return {
    async run(code, { timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
      return (await enqueue(code, [], timeoutMs)).run;
    },
    async evalChecks(code, exprs, { timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
      return enqueue(code, exprs, timeoutMs);
    },
    close() {
      kill();
    },
  };
}

function browserWorker() {
  const raw = new Worker(new URL("./py-worker.js", import.meta.url), { type: "module" });
  return {
    post: (m) => raw.postMessage(m),
    onMessage: (cb) => {
      raw.onmessage = (e) => cb(e.data);
    },
    onFail: (cb) => {
      raw.onerror = (e) => cb(e);
      raw.onmessageerror = (e) => cb(e);
    },
    terminate: () => raw.terminate(),
  };
}

let browserRunner = null;
function shared() {
  return (browserRunner ??= createRunner(browserWorker));
}

// Browser entry points (lazy: no worker is created until first use).
export const run = (code, opts) => shared().run(code, opts);
export const evalChecks = (code, exprs, opts) => shared().evalChecks(code, exprs, opts);

// Node entry point for tests: same runner, worker_threads instead of a Web Worker.
export async function createNodeRunner() {
  const { Worker } = await import("node:worker_threads");
  const { fileURLToPath } = await import("node:url");
  const file = fileURLToPath(new URL("./node-worker.js", import.meta.url));
  return createRunner(() => {
    const raw = new Worker(file);
    return {
      post: (m) => raw.postMessage(m),
      onMessage: (cb) => {
        raw.on("message", cb);
      },
      onFail: (cb) => {
        raw.on("error", cb);
        raw.on("exit", (code) => {
          if (code !== 0) cb(new Error(`worker exited with code ${code}`));
        });
      },
      terminate: () => raw.terminate(),
    };
  });
}
