// Shared Pyodide logic. Every function takes an already-loaded `pyodide`
// instance, so the browser worker (py-worker.js) and the Node test worker
// (node-worker.js) use exactly the same code.

const MAX_STDOUT = 50000;

// Lives in its own namespace, so student code can never see or break it.
const HELPER = `
import sys, io, importlib, json, builtins
from pyodide.code import find_imports

# The helper runs in the same worker as student code, and builtins are shared.
# So: (1) bind every builtin the helper needs to a private alias that student
# code cannot reach, and (2) snapshot builtins now and restore them after each
# run, so "builtins.len = 5" in one run cannot poison the next.
_isinstance, _repr, _str, _type = isinstance, repr, str, type
_compile, _exec, _eval = compile, exec, eval
_list, _dict, _sorted, _len = list, dict, sorted, len
_BaseException, _SyntaxError = BaseException, SyntaxError
_bool, _int, _float = bool, int, float
_tuple, _set, _frozenset = tuple, set, frozenset
_StringIO, _dumps = io.StringIO, json.dumps
_import_module, _find_imports = importlib.import_module, find_imports
_bdict = builtins.__dict__
_snap = _bdict.copy()
_bclear, _bupdate = _bdict.clear, _bdict.update

def _restore_builtins():
    _bclear()
    _bupdate(_snap)

def preimport(code):
    # Import what the code imports BEFORE the timer starts: the first
    # "import pandas" takes seconds, and is not the student's fault.
    try:
        names = _find_imports(code)
    except _BaseException:
        return
    for name in names:
        try:
            _import_module(name)
        except _BaseException:
            pass    # the student's own import will raise the real error

def _setkey(y):
    # Compact separators and raw (non-escaped) characters, so the order matches
    # JS JSON.stringify sorting for non-ASCII text and nested values.
    return _dumps(y, sort_keys=True, default=_str, ensure_ascii=False, separators=(",", ":"))

def plain(v, depth=0):
    # Keep only JSON-like data; anything else (DataFrame, function, ...) becomes
    # its repr text, so the value can always cross to JS.
    if v is None or _isinstance(v, (_bool, _int, _float, _str)):
        return v
    if depth > 20:
        return _repr(v)
    if _isinstance(v, (_list, _tuple)):
        return [plain(x, depth + 1) for x in v]
    if _isinstance(v, (_set, _frozenset)):
        # Sets have no stable order (string hashing is randomized per process),
        # so sort by JSON text. Same rule as the JS side.
        return _sorted([plain(x, depth + 1) for x in v], key=_setkey)
    if _isinstance(v, _dict):
        return {(k if _isinstance(k, _str) else _str(k)): plain(x, depth + 1) for k, x in v.items()}
    try:
        return _repr(v)
    except _BaseException:
        return "<unprintable>"

def run_student(code, exprs, max_stdout, on_started=None):
    ns = {"__name__": "__main__"}          # fresh namespace for every run
    buf = _StringIO()
    old_out, old_err = sys.stdout, sys.stderr
    sys.stdout = buf
    sys.stderr = _StringIO()
    error = None
    out = ""
    values = []
    try:
        try:
            compiled = _compile(code, "<student>", "exec")
            if on_started is not None:
                on_started()
            _exec(compiled, ns)
        except _BaseException as e:        # includes SystemExit
            line = None
            if _isinstance(e, _SyntaxError):
                line = e.lineno
            else:
                tb = e.__traceback__
                while tb is not None:
                    if tb.tb_frame.f_code.co_filename == "<student>":
                        line = tb.tb_lineno
                    tb = tb.tb_next
            msg = e.msg if _isinstance(e, _SyntaxError) else _str(e)
            error = {"type": _type(e).__name__, "message": msg, "line": line}
        out = buf.getvalue()
        # json.dumps (used to order sets) reads builtins like tuple/list at call
        # time, so undo any builtins tampering BEFORE converting check values.
        _restore_builtins()
        for expr in exprs:
            try:
                values.append(plain(_eval(_compile(expr, "<check>", "eval"), ns)))
            except _BaseException as e:
                values.append({"__error__": _type(e).__name__})
    finally:
        sys.stdout, sys.stderr = old_out, old_err
        _restore_builtins()
    if _len(out) > max_stdout:
        out = out[:max_stdout] + "\\n...(output cut off)"
    return {"stdout": out, "error": error, "values": values}
`;

const helpers = new WeakMap();

function getHelper(pyodide) {
  let fn = helpers.get(pyodide);
  if (!fn) {
    const ns = pyodide.toPy({ __name__: "__lesson_runner__" });
    pyodide.runPython(HELPER, { globals: ns });
    fn = { run: ns.get("run_student"), preimport: ns.get("preimport") };
    helpers.set(pyodide, fn);
    // EOF for input() instead of a browser prompt or a hang.
    pyodide.setStdin({ stdin: () => null });
  }
  return fn;
}

function sortKey(v) {
  return JSON.stringify(v, (_, w) => (typeof w === "bigint" ? String(w) : w));
}

// Make a value safe for postMessage: dicts -> plain objects (done by toJs),
// sets -> sorted arrays (backstop: Python already sorts them), anything else non-cloneable (functions, DataFrames) -> its text.
function sanitize(v) {
  if (v === null || v === undefined) return null;
  const t = typeof v;
  if (t === "number" || t === "string" || t === "boolean" || t === "bigint") return v;
  if (Array.isArray(v)) return v.map(sanitize);
  if (v instanceof Set) {
    return [...v].map(sanitize).sort((a, b) => {
      const x = sortKey(a);
      const y = sortKey(b);
      return x < y ? -1 : x > y ? 1 : 0;
    });
  }
  if (v instanceof Map) return Object.fromEntries([...v].map(([k, w]) => [String(k), sanitize(w)]));
  if (t === "object" && Object.getPrototypeOf(v) === Object.prototype) {
    return Object.fromEntries(Object.entries(v).map(([k, w]) => [k, sanitize(w)]));
  }
  try {
    return String(v);
  } catch {
    return "<unprintable>";
  }
}

// Runs `code` in a fresh namespace, then evaluates each expression in `exprs`
// in that same namespace. `onStarted` fires right before the student code
// executes (after package loading), so the caller can start its timeout there.
// Returns {run: RunResult, values: any[]} using plain JS values.
export async function runIn(pyodide, code, exprs = [], onStarted = () => {}) {
  const helper = getHelper(pyodide);

  // Auto-load packages the code imports (pandas etc.). A failure here is not
  // fatal: the import itself will then raise ModuleNotFoundError for the student.
  try {
    await pyodide.loadPackagesFromImports(code);
  } catch {
    /* ignored */
  }
  helper.preimport(code);

  const out = helper.run(code, exprs, MAX_STDOUT, onStarted);
  let plain;
  try {
    plain = out.toJs({ dict_converter: Object.fromEntries, create_pyproxies: false });
  } finally {
    out.destroy();
  }
  const error = plain.error ?? null;
  if (error && typeof error.line === "bigint") error.line = Number(error.line);
  return {
    run: { ok: error === null, stdout: plain.stdout, error, timedOut: false },
    values: plain.values.map(sanitize),
  };
}
