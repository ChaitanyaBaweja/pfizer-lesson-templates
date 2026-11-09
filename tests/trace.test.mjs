import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyTrace, codeLineCount, failingLine, FAIL_KINDS } from "../shared/trace.js";

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

// SyntaxError / IndentationError: IPython 7 prints a File header and a caret, no arrow.
const SYNTAX_TB = [
  '  File "<ipython-input-2>", line 2',
  "    for doc_type in doc_types",
  "                             ^",
  "SyntaxError: expected ':'",
  "",
];
const INDENT_TB = [
  '  File "<ipython-input-2>", line 3',
  "    print(lot)",
  "    ^",
  "IndentationError: expected an indented block after 'for' statement on line 2",
  "",
];

test("classifyTrace marks the File header, source line and caret of a SyntaxError", () => {
  const out = classifyTrace(SYNTAX_TB);
  assert.deepEqual(out.map((t) => t.kind), ["file", "src", "caret", "last", "dim"]);
  assert.deepEqual(out.map((t) => t.text), SYNTAX_TB);
  assert.equal(out[0].lineNo, 2);
});

test("classifyTrace handles the IndentationError shape the same way", () => {
  const out = classifyTrace(INDENT_TB);
  assert.deepEqual(out.map((t) => t.kind), ["file", "src", "caret", "last", "dim"]);
  assert.equal(out[0].lineNo, 3);
});

test("failingLine finds the line for both shapes", () => {
  assert.deepEqual(failingLine(TB), { shape: "arrow", lineNo: 2, source: 'print(doc["expiry_date"])' });
  assert.deepEqual(failingLine(SYNTAX_TB), { shape: "caret", lineNo: 2, source: "    for doc_type in doc_types" });
  assert.deepEqual(failingLine(INDENT_TB), { shape: "caret", lineNo: 3, source: "    print(lot)" });
  assert.equal(failingLine(["KeyError: 'a'"]), null);
});

test("FAIL_KINDS covers the arrow line and the File header, source and caret lines", () => {
  for (const tb of [TB, SYNTAX_TB, INDENT_TB]) {
    const hl = classifyTrace(tb).filter((t) => FAIL_KINDS.includes(t.kind));
    assert.ok(hl.length >= 1);
    assert.ok(!hl.some((t) => t.kind === "last"));
  }
  assert.deepEqual(classifyTrace(TB).filter((t) => FAIL_KINDS.includes(t.kind)).map((t) => t.kind), ["arrow"]);
  assert.deepEqual(classifyTrace(SYNTAX_TB).filter((t) => FAIL_KINDS.includes(t.kind)).map((t) => t.kind), ["file", "src", "caret"]);
});
