import { test, after } from "node:test";
import assert from "node:assert/strict";
import { createNodeRunner } from "../shared/runner.js";

const runner = await createNodeRunner();
after(() => runner.close());

test("runs_print", async () => {
  const r = await runner.run("print(1+1)");
  assert.equal(r.ok, true);
  assert.equal(r.stdout, "2\n");
  assert.equal(r.error, null);
  assert.equal(r.timedOut, false);
});

test("captures_error_midway", async () => {
  const r = await runner.run('print("a")\n{}["x"]');
  assert.equal(r.ok, false);
  assert.equal(r.stdout, "a\n");
  assert.equal(r.error.type, "KeyError");
  assert.equal(r.error.line, 2);
});

test("syntax_error_reports_type_and_line", async () => {
  const r = await runner.run("x = 1\nprint(");
  assert.equal(r.ok, false);
  assert.equal(r.error.type, "SyntaxError");
  assert.equal(r.error.line, 2);
});

test("timeout", async () => {
  const r = await runner.run("while True: pass", { timeoutMs: 1000 });
  assert.equal(r.timedOut, true);
  assert.equal(r.ok, false);
  const r2 = await runner.run("print(3)");
  assert.equal(r2.stdout, "3\n");
  assert.equal(r2.timedOut, false);
});

test("no_stdout_leak_between_runs", async () => {
  await runner.run('print("first")');
  const r = await runner.run('print("second")');
  assert.equal(r.stdout, "second\n");
  const e = await runner.run('print("before")\n1/0');
  const r3 = await runner.run("pass");
  assert.equal(e.stdout, "before\n");
  assert.equal(r3.stdout, "");
});

test("fresh_namespace", async () => {
  await runner.run("x=1");
  const { values } = await runner.evalChecks("", ["'x' in dir()"]);
  assert.deepEqual(values, [false]);
});

test("empty_code_checks", async () => {
  const { run, values } = await runner.evalChecks("", ["doc_types"]);
  assert.equal(run.ok, true);
  assert.deepEqual(values, [{ __error__: "NameError" }]);
});

test("evalChecks_converts_python_values", async () => {
  const code = 'doc_types = ["a", "b"]\nd = {"k": [1, (2, 3)], "n": None}';
  const { values } = await runner.evalChecks(code, ["doc_types", "d", "len(doc_types)", "d['n']", "doc_types[5]"]);
  assert.deepEqual(values, [["a", "b"], { k: [1, [2, 3]], n: null }, 2, null, { __error__: "IndexError" }]);
});

test("evalChecks_after_error_still_returns_run_error", async () => {
  const { run, values } = await runner.evalChecks("x = 1\n{}['k']", ["x"]);
  assert.equal(run.error.type, "KeyError");
  assert.deepEqual(values, [1]);
});

test("evalChecks_timeout", async () => {
  const { run, values } = await runner.evalChecks("while True: pass", ["1"], { timeoutMs: 800 });
  assert.equal(run.timedOut, true);
  assert.deepEqual(values, []);
});

test("runs_pandas", async () => {
  const r = await runner.run('import pandas as pd\nprint(pd.DataFrame([{"a":1}]).shape)');
  assert.equal(r.error, null);
  assert.equal(r.stdout, "(1, 1)\n");
});

test("unconvertible_value_does_not_crash", async () => {
  const { values } = await runner.evalChecks("import pandas as pd\ndf = pd.DataFrame([{'a':1}])", ["df", "len"]);
  assert.equal(values.length, 2);
  assert.equal(typeof values[0], "string");
  assert.ok(values[0].includes("a"));
});

test("hostile_sys_exit_gives_error", async () => {
  const r = await runner.run("import sys; sys.exit()");
  assert.equal(r.ok, false);
  assert.equal(r.error.type, "SystemExit");
});

test("hostile_input_does_not_hang", async () => {
  const r = await runner.run("input('x')", { timeoutMs: 3000 });
  assert.equal(r.timedOut, false);
  assert.equal(r.ok, false);
});

test("set_values_sorted_and_stable_across_runners", async () => {
  const code = 's = {"zeta", "alpha", "mid", "beta", "omega", "kappa"}';
  const expected = ["alpha", "beta", "kappa", "mid", "omega", "zeta"];
  const a = await runner.evalChecks(code, ["s", "frozenset({3, 1, 2})"]);
  assert.deepEqual(a.values, [expected, [1, 2, 3]]);
  // Separate runners = separate processes' hash seeds in separate workers.
  for (let i = 0; i < 2; i++) {
    const other = await createNodeRunner();
    try {
      const b = await other.evalChecks(code, ["s"]);
      assert.deepEqual(b.values, [expected]);
    } finally {
      other.close();
    }
  }
});

test("builtins_mutation_does_not_poison_later_runs", async () => {
  const bad = await runner.run("import builtins; builtins.isinstance = 5; builtins.len = lambda x: 4");
  assert.equal(bad.error, null);
  const good = await runner.evalChecks("print('ok')", ["len([1,2,3])"]);
  assert.equal(good.run.stdout, "ok\n");
  assert.deepEqual(good.values, [3]);
  const err = await runner.run('{}["x"]');
  assert.equal(err.error.type, "KeyError");
  assert.equal(err.error.message, "'x'");
});

test("builtins_mutation_midrun_still_reports_real_error", async () => {
  const r = await runner.evalChecks(
    "import builtins; builtins.isinstance = 5; builtins.str = 5; builtins.type = 5\n{}['k']",
    ["len([1,2,3])", "[1, 2]"]
  );
  assert.equal(r.run.error.type, "KeyError");
  assert.deepEqual(r.values, [3, [1, 2]]);
});

test("internal_error_kills_worker_and_recovers", async () => {
  // Fake worker that reports InternalError once, then behaves.
  const { createRunner } = await import("../shared/runner.js");
  let made = 0;
  let killed = 0;
  const r = createRunner(() => {
    made++;
    let cb;
    const n = made;
    return {
      post: ({ id }) =>
        setImmediate(() => {
          cb({ id, type: "started" });
          cb({
            id,
            type: "done",
            run: n === 1
              ? { ok: false, stdout: "", error: { type: "InternalError", message: "boom", line: null }, timedOut: false }
              : { ok: true, stdout: "fine\n", error: null, timedOut: false },
            values: [],
          });
        }),
      onMessage: (f) => (cb = f),
      onFail: () => {},
      terminate: () => killed++,
    };
  });
  assert.equal((await r.run("x")).error.type, "InternalError");
  assert.equal(killed, 1);
  assert.equal((await r.run("x")).stdout, "fine\n");
  assert.equal(made, 2);
  r.close();
});

test("builtins_mutation_of_tuple_set_frozenset_does_not_break_values", async () => {
  const code =
    's = {"b", "a"}\nt = (1, 2)\nfs = frozenset({3, 1})\n' +
    "import builtins\nbuiltins.tuple = 5\nbuiltins.set = 5\nbuiltins.frozenset = 5";
  const { run, values } = await runner.evalChecks(code, ["s", "t", "fs"]);
  assert.equal(run.error, null);
  assert.deepEqual(values, [["a", "b"], [1, 2], [1, 3]]);
});

test("set_order_matches_js_sorting_for_non_ascii_and_nested", async () => {
  const { values } = await runner.evalChecks(
    's = {"é", "z", "a"}\nn = {("é", 1), ("z", 1), ("a", [1, 2][0])}',
    ["s", "n"]
  );
  // JS JSON.stringify sorting: code-point order, compact separators.
  assert.deepEqual(values, [["a", "z", "é"], [["a", 1], ["z", 1], ["é", 1]]]);
});

test("worker_start_failure_resolves_to_load_error", async () => {
  const { createRunner } = await import("../shared/runner.js");
  let made = 0;
  const r = createRunner(() => {
    made++;
    if (made <= 2) throw new Error("Worker blocked");
    let cb;
    return {
      post: ({ id }) =>
        setImmediate(() => {
          cb({ id, type: "started" });
          cb({ id, type: "done", run: { ok: true, stdout: "fine\n", error: null, timedOut: false }, values: [7] });
        }),
      onMessage: (f) => (cb = f),
      onFail: () => {},
      terminate: () => {},
    };
  });
  const a = await r.run("print(1)");
  assert.equal(a.ok, false);
  assert.equal(a.error.type, "LoadError");
  assert.match(a.error.message, /Worker blocked/);
  const b = await r.evalChecks("x=1", ["x"]);
  assert.equal(b.run.error.type, "LoadError");
  assert.deepEqual(b.values, []);
  // The failure is not sticky: a later call starts a fresh worker.
  const c = await r.evalChecks("x=1", ["x"]);
  assert.equal(c.run.stdout, "fine\n");
  assert.deepEqual(c.values, [7]);
  r.close();
});
