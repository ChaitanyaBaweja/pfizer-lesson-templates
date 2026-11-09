import { test } from "node:test";
import assert from "node:assert/strict";
import { judge, revealAllowed } from "../shared/check.js";

const okRun = { ok: true, stdout: "", error: null, timedOut: false };
const tryBlock = {
  checks: [
    { expr: 'doc_types[-1]', expect: "Material Description", hint: "Check the last item." },
    { expr: "len(doc_types)", expect: 3, hint: "You need 3 items." },
  ],
  expect_stdout: "['a', 'b']",
  stdout_hint: "Print the list.",
};

test("judge_timeout_first", () => {
  const run = { ok: false, stdout: "", error: { type: "KeyError", message: "x", line: 1 }, timedOut: true };
  const r = judge(tryBlock, run, []);
  assert.equal(r.ok, false);
  assert.equal(
    r.hint,
    "Your code took too long to run (over 5 seconds). Check for a loop that never ends."
  );
});

test("judge_error_names_lesson", () => {
  const run = { ok: false, stdout: "", error: { type: "KeyError", message: "'x'", line: 2 }, timedOut: false };
  const r = judge(tryBlock, run, []);
  assert.equal(r.ok, false);
  assert.ok(r.hint.includes("KeyError"));
  assert.equal(
    r.hint,
    `Your code stopped with a KeyError: 'x'. See "Fix the error: KeyError".`
  );
});

test("judge_error_all_eight_lessons", () => {
  for (const t of ["SyntaxError", "IndentationError", "NameError", "TypeError", "KeyError", "IndexError", "FileNotFoundError", "ModuleNotFoundError"]) {
    const run = { ok: false, stdout: "", error: { type: t, message: "m", line: null }, timedOut: false };
    const a = t === "IndentationError" || t === "IndexError" ? "an" : "a";
    assert.equal(judge(tryBlock, run, []).hint, `Your code stopped with ${a} ${t}: m. See "Fix the error: ${t}".`);
  }
});

test("judge_error_other_type_has_no_lesson", () => {
  const run = { ok: false, stdout: "", error: { type: "ZeroDivisionError", message: "division by zero", line: 1 }, timedOut: false };
  assert.equal(judge(tryBlock, run, []).hint, "Your code stopped with a ZeroDivisionError: division by zero.");
});

test("judge_first_failing_check_hint", () => {
  const r = judge(tryBlock, okRun, ["Material Description", 2]);
  assert.deepEqual(r, { ok: false, hint: "You need 3 items." });
  const r2 = judge(tryBlock, okRun, ["Nope", 2]);
  assert.equal(r2.hint, "Check the last item.");
});

test("judge_check_error_value_fails", () => {
  const r = judge(tryBlock, okRun, [{ __error__: "NameError" }, 3]);
  assert.equal(r.ok, false);
  assert.equal(r.hint, "Check the last item.");
});

test("judge_deep_equality", () => {
  const tb = { checks: [{ expr: "x", expect: { a: [1, { b: null }] }, hint: "h" }], expect_stdout: null };
  assert.equal(judge(tb, okRun, [{ a: [1, { b: null }] }]).ok, true);
  assert.equal(judge(tb, okRun, [{ a: [1, { b: 0 }] }]).ok, false);
  assert.equal(judge(tb, okRun, [{ a: [1, { b: null }], c: 1 }]).ok, false);
  assert.equal(judge(tb, okRun, [[1]]).ok, false);
});

test("judge_stdout_mismatch", () => {
  const run = { ...okRun, stdout: "['a']\n" };
  const r = judge(tryBlock, run, ["Material Description", 3]);
  assert.deepEqual(r, { ok: false, hint: "Print the list." });
});

test("judge_pass", () => {
  const run = { ...okRun, stdout: "['a', 'b']\n\n  " };
  assert.deepEqual(judge(tryBlock, run, ["Material Description", 3]), { ok: true, hint: "" });
});

test("judge_null_expect_stdout_skips_stdout", () => {
  const tb = { checks: [], expect_stdout: null, stdout_hint: "x" };
  assert.deepEqual(judge(tb, { ...okRun, stdout: "anything" }, []), { ok: true, hint: "" });
});

test("judge_error_hint_uses_an_before_vowels", () => {
  const hint = (type) => judge(tryBlock, { ok: false, stdout: "", error: { type, message: "m", line: 1 }, timedOut: false }, []).hint;
  assert.ok(hint("AttributeError").startsWith("Your code stopped with an AttributeError: m."));
  assert.ok(hint("ImportError").startsWith("Your code stopped with an ImportError: m."));
  assert.ok(hint("OSError").startsWith("Your code stopped with an OSError: m."));
  assert.ok(hint("IndentationError").startsWith("Your code stopped with an IndentationError: m."));
  assert.ok(hint("ValueError").startsWith("Your code stopped with a ValueError: m."));
  assert.ok(hint("UnboundLocalError").startsWith("Your code stopped with an UnboundLocalError: m."));
  assert.ok(hint("UnicodeDecodeError").startsWith("Your code stopped with a UnicodeDecodeError: m."));
});

test("judge_error_empty_message", () => {
  const run = { ok: false, stdout: "", error: { type: "SystemExit", message: "", line: 1 }, timedOut: false };
  assert.equal(judge(tryBlock, run, []).hint, "Your code stopped with a SystemExit.");
  const run2 = { ok: false, stdout: "", error: { type: "KeyError", message: "", line: 1 }, timedOut: false };
  assert.equal(judge(tryBlock, run2, []).hint, 'Your code stopped with a KeyError. See "Fix the error: KeyError".');
});

test("reveal_after_two", () => {
  assert.equal(revealAllowed(0), false);
  assert.equal(revealAllowed(1), false);
  assert.equal(revealAllowed(2), true);
  assert.equal(revealAllowed(5), true);
});
