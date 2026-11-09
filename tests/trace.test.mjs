import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyTrace, codeLineCount } from "../shared/trace.js";

const TB = [
  "---------------------------------------------------------------------------",
  "KeyError                                  Traceback (most recent call last)",
  "<ipython-input-2> in <cell line: 2>()",
  '      1 doc = {"type": "Certificate of Quality"}',
  '----> 2 print(doc["expiry_date"])',
  "",
  "KeyError: 'expiry_date'",
];

test("classifyTrace marks the header, the path line, code, the arrow line and the last line", () => {
  const kinds = classifyTrace(TB).map((t) => t.kind);
  assert.deepEqual(kinds, ["dim", "head", "dim", "code", "arrow", "dim", "last"]);
});

test("classifyTrace keeps the text unchanged and finds the arrow's line number", () => {
  const out = classifyTrace(TB);
  assert.deepEqual(out.map((t) => t.text), TB);
  assert.equal(out.find((t) => t.kind === "arrow").lineNo, 2);
});

test("classifyTrace treats the last non-blank line as the last line, even with trailing blanks", () => {
  const kinds = classifyTrace(["KeyError: 'a'", ""]).map((t) => t.kind);
  assert.deepEqual(kinds, ["last", "dim"]);
});

test("codeLineCount ignores one trailing newline", () => {
  assert.equal(codeLineCount("a\nb"), 2);
  assert.equal(codeLineCount("a\nb\n"), 2);
  assert.equal(codeLineCount("a"), 1);
});
