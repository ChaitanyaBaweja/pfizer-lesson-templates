// Pure helpers for Template C (no DOM): sort a traceback's lines into kinds so
// the page can colour and highlight them.

export function codeLineCount(code) {
  return String(code).replace(/\n$/, "").split("\n").length;
}

// kind: "head" (Traceback (most recent call last)), "arrow" (the ----> line),
// "code" (numbered context line), "last" (final line: ErrorType: message),
// "dim" (separator, path line, blank). `lineNo` is set on the arrow line.
export function classifyTrace(traceback) {
  let lastIdx = -1;
  traceback.forEach((t, i) => {
    if (t.trim() !== "") lastIdx = i;
  });
  return traceback.map((text, i) => {
    if (i === lastIdx) return { text, kind: "last" };
    const arrow = text.match(/^\s*---->\s+(\d+)/);
    if (arrow) return { text, kind: "arrow", lineNo: Number(arrow[1]) };
    if (/Traceback \(most recent call last\)/.test(text)) return { text, kind: "head" };
    if (/^\s+\d+\s/.test(text)) return { text, kind: "code" };
    return { text, kind: "dim" };
  });
}
