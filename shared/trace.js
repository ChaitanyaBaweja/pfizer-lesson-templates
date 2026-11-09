// Pure helpers for Template C (no DOM): sort a traceback's lines into kinds so
// the page can colour and highlight them.

export function codeLineCount(code) {
  return String(code).replace(/\n$/, "").split("\n").length;
}

const FILE_RE = /^\s*File "[^"]*", line (\d+)/;
const CARET_RE = /^\s*\^+\s*$/;

// Two shapes, both as IPython 7 (Colab) prints them:
// - runtime errors: a "Traceback (most recent call last)" header and a ----> arrow line
// - SyntaxError / IndentationError: a `File "<ipython-input-N>", line L` header,
//   the source line, then a caret (^) line. No arrow.
//
// kind: "head" (Traceback (most recent call last)), "arrow" (the ----> line),
// "code" (numbered context line), "last" (final line: ErrorType: message),
// "file" (the File "...", line L header), "src" (the source line under it),
// "caret" (the ^ line), "dim" (separator, path line, blank).
// `lineNo` is set on the arrow line and on the file line.
export function classifyTrace(traceback) {
  let lastIdx = -1;
  traceback.forEach((t, i) => {
    if (t.trim() !== "") lastIdx = i;
  });
  const out = traceback.map((text, i) => {
    if (i === lastIdx) return { text, kind: "last" };
    const arrow = text.match(/^\s*---->\s+(\d+)/);
    if (arrow) return { text, kind: "arrow", lineNo: Number(arrow[1]) };
    const file = text.match(FILE_RE);
    if (file) return { text, kind: "file", lineNo: Number(file[1]) };
    if (CARET_RE.test(text)) return { text, kind: "caret" };
    if (/Traceback \(most recent call last\)/.test(text)) return { text, kind: "head" };
    if (/^\s+\d+\s/.test(text)) return { text, kind: "code" };
    return { text, kind: "dim" };
  });
  // The line between a File header and its caret is the quoted source line.
  out.forEach((t, i) => {
    if (t.kind === "file" && out[i + 2]?.kind === "caret" && out[i + 1].kind !== "last") out[i + 1].kind = "src";
  });
  return out;
}

// The kinds to highlight as "the line that failed", for either shape.
export const FAIL_KINDS = ["arrow", "file", "src", "caret"];

// Where the traceback says the cell failed:
// {shape: "arrow", lineNo, source} for a ----> line, or
// {shape: "caret", lineNo, source} for a File header + caret, or null.
// `source` is the code text the traceback shows for that line.
export function failingLine(traceback) {
  const rows = classifyTrace(traceback);
  const arrow = rows.find((t) => t.kind === "arrow");
  if (arrow) {
    return { shape: "arrow", lineNo: arrow.lineNo, source: arrow.text.replace(/^\s*---->\s+\d+\s?/, "") };
  }
  const i = rows.findIndex((t) => t.kind === "file");
  if (i !== -1 && rows[i + 1]?.kind === "src") {
    return { shape: "caret", lineNo: rows[i].lineNo, source: rows[i + 1].text };
  }
  return null;
}
