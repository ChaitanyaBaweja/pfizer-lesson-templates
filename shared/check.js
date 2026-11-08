// Pure checker: no DOM, no Pyodide. Safe to import from the browser and from Node tests.

export const TIMEOUT_HINT =
  "Your code took too long to run (over 5 seconds). Check for a loop that never ends.";

// Error types that have a matching "Fix the error" (Template C) lesson.
export const ERROR_LESSONS = {
  SyntaxError: "Fix the error: SyntaxError",
  IndentationError: "Fix the error: IndentationError",
  NameError: "Fix the error: NameError",
  TypeError: "Fix the error: TypeError",
  KeyError: "Fix the error: KeyError",
  IndexError: "Fix the error: IndexError",
  FileNotFoundError: "Fix the error: FileNotFoundError",
  ModuleNotFoundError: "Fix the error: ModuleNotFoundError",
};

// Deep equality over values converted from Python by the runner:
//   list -> array, tuple -> array, dict -> plain object, None -> null,
//   set -> array (sorted by JSON text), int/float -> number (bigint if huge).
// So `expect` values in lesson JSON are written as ordinary JSON: a Python
// tuple (1, 2) is expected as [1, 2], and a dict as an object.
export function deepEqual(a, b) {
  if (Object.is(a, b)) return true;
  if (typeof a !== typeof b || a === null || b === null) return false;
  if (typeof a !== "object") return false;
  const aIsArr = Array.isArray(a);
  if (aIsArr !== Array.isArray(b)) return false;
  if (aIsArr) {
    return a.length === b.length && a.every((v, i) => deepEqual(v, b[i]));
  }
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  return ka.every((k) => Object.prototype.hasOwnProperty.call(b, k) && deepEqual(a[k], b[k]));
}

function errorHint(error) {
  let hint = error.message
    ? `Your code stopped with a ${error.type}: ${error.message}.`
    : `Your code stopped with a ${error.type}.`;
  const title = Object.prototype.hasOwnProperty.call(ERROR_LESSONS, error.type)
    ? ERROR_LESSONS[error.type]
    : null;
  if (title) hint += ` See "${title}".`;
  return hint;
}

// judge(tryBlock, run, values) -> {ok, hint}
//   tryBlock: {checks: [{expr, expect, hint}], expect_stdout: null|string, stdout_hint}
//   run:      RunResult from the runner
//   values:   one converted value per check, in order (from runner.evalChecks)
export function judge(tryBlock, run, values) {
  if (run.timedOut) return { ok: false, hint: TIMEOUT_HINT };
  if (run.error) return { ok: false, hint: errorHint(run.error) };

  const checks = tryBlock.checks || [];
  for (let i = 0; i < checks.length; i++) {
    if (!deepEqual(values[i], checks[i].expect)) {
      return { ok: false, hint: checks[i].hint };
    }
  }

  if (tryBlock.expect_stdout != null) {
    // Python's rstrip() strips all trailing whitespace; so does trimEnd().
    if (String(run.stdout).trimEnd() !== String(tryBlock.expect_stdout).trimEnd()) {
      return { ok: false, hint: tryBlock.stdout_hint };
    }
  }
  return { ok: true, hint: "" };
}

// "Show answer" unlocks after two wrong attempts.
export function revealAllowed(wrongCount) {
  return wrongCount >= 2;
}

// True when the run failed because Python itself could not load or the worker
// broke (not because of the student's code). The browser worker failing to load
// can surface as either "LoadError" or "InternalError"; the UI shows the same
// "Python couldn't load here" message for both.
export function isLoadFailure(run) {
  return Boolean(run && run.error && (run.error.type === "LoadError" || run.error.type === "InternalError"));
}
