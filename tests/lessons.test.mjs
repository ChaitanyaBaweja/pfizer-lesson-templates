// Iterates over every lessons/*.json, so later tasks add lessons with no new test code.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { createNodeRunner } from "../shared/runner.js";
import { judge, revealAllowed, isLoadFailure } from "../shared/check.js";
import { validate, load, LessonError } from "../shared/lesson-loader.js";
import { failingLine } from "../shared/trace.js";

const dir = fileURLToPath(new URL("../lessons/", import.meta.url));
const files = readdirSync(dir).filter((f) => f.endsWith(".json")).sort();
const runner = await createNodeRunner();
after(() => runner.close());

async function judgeCode(tryBlock, code) {
  const exprs = (tryBlock.checks || []).map((c) => c.expr);
  const { run, values } = await runner.evalChecks(code, exprs);
  return judge(tryBlock, run, values);
}

test("there is at least one lesson", () => {
  assert.ok(files.length >= 1);
});

test("there is at least one lesson for each template", () => {
  const used = new Set(files.map((f) => JSON.parse(readFileSync(join(dir, f), "utf8")).template));
  for (const t of ["concept", "read-code", "fix-error"]) assert.ok(used.has(t), `no lesson uses the ${t} template`);
});

for (const file of files) {
  const lesson = JSON.parse(readFileSync(join(dir, file), "utf8"));
  const name = `${file}`;

  test(`${name}: id matches the file name and passes loader validation`, () => {
    assert.equal(lesson.id + ".json", file);
    assert.doesNotThrow(() => validate(lesson));
  });

  if (lesson.template === "concept") {
    test(`${name}: solution passes judge`, async () => {
      const r = await judgeCode(lesson.try, lesson.try.solution);
      assert.deepEqual(r, { ok: true, hint: "" });
    });

    test(`${name}: starter code does not pass (so Try it is a real task)`, async () => {
      const r = await judgeCode(lesson.try, lesson.try.starter);
      assert.equal(r.ok, false);
      assert.ok(r.hint.length > 0);
    });

    test(`${name}: empty code fails with the first hint, no crash`, async () => {
      const r = await judgeCode(lesson.try, "");
      assert.equal(r.ok, false);
      assert.ok(r.hint.length > 0);
    });

    for (const [i, w] of lesson.try.wrong.entries()) {
      test(`${name}: wrong[${i}] fails with a hint containing "${w.hint_contains}"`, async () => {
        const r = await judgeCode(lesson.try, w.code);
        assert.equal(r.ok, false);
        assert.ok(r.hint.includes(w.hint_contains), `hint was: ${r.hint}`);
      });
    }

    for (const [i, d] of lesson.demos.entries()) {
      test(`${name}: demo[${i}] (${d.label}) runs without error`, async () => {
        const r = await runner.run(d.code);
        assert.equal(r.error, null);
      });
    }
  } else if (lesson.template === "read-code") {
    test(`${name}: exactly one ok option; verify output matches`, async () => {
      assert.equal(lesson.predict.options.filter((o) => o.ok).length, 1);
      if (lesson.verify) {
        const r = await runner.run(lesson.verify.setup + "\n" + lesson.verify.code);
        assert.equal(r.error, null);
        assert.ok(r.stdout.startsWith(lesson.verify.stdout_startswith), `stdout was: ${r.stdout}`);
      }
    });
  } else if (lesson.template === "fix-error") {
    test(`${name}: code raises error_type; the ok fix runs clean`, async () => {
      const r = await runner.run(lesson.code);
      assert.equal(r.error && r.error.type, lesson.error_type);
      const okFix = lesson.fixes.filter((f) => f.ok);
      assert.equal(okFix.length, 1);
      const fixed = await runner.run(okFix[0].fixed_code);
      assert.equal(fixed.error, null);
    });

    test(`${name}: traceback ends with the error type and points at arrow_line (----> arrow, or File line + caret)`, () => {
      const last = [...lesson.traceback].reverse().find((l) => l.trim() !== "");
      assert.ok(last.startsWith(lesson.error_type + ":"), `last traceback line was: ${last}`);
      const codeLine = lesson.code.split("\n")[lesson.arrow_line - 1];
      const arrow = lesson.traceback.find((l) => /^\s*---->/.test(l));
      if (arrow) {
        const m = arrow.match(/^\s*---->\s+(\d+)\s(.*)$/);
        assert.equal(Number(m[1]), lesson.arrow_line);
        assert.equal(m[2].trim(), codeLine.trim());
      } else {
        // SyntaxError / IndentationError shape: File "...", line L / the source line / a ^ caret line
        const fi = lesson.traceback.findIndex((l) => /^\s*File "[^"]*", line \d+/.test(l));
        assert.ok(fi !== -1, 'traceback has neither a ----> line nor a File "...", line N header');
        assert.equal(Number(lesson.traceback[fi].match(/line (\d+)/)[1]), lesson.arrow_line);
        assert.equal((lesson.traceback[fi + 1] || "").trim(), codeLine.trim());
        assert.ok(/^\s*\^+\s*$/.test(lesson.traceback[fi + 2] || ""), "no ^ caret line under the source line");
        assert.equal(failingLine(lesson.traceback)?.shape, "caret");
      }
    });
  }
}

// ---- fix-error "Next error" convention ----

test("fix-error lessons: used_later names the next error (N+1 of 8 · ErrorType)", () => {
  const all = files.map((f) => JSON.parse(readFileSync(join(dir, f), "utf8"))).filter((l) => l.template === "fix-error");
  for (const l of all) {
    if (l.number >= 8) continue;
    const prefix = `${l.number + 1} of 8 · `;
    assert.ok(l.learn.used_later.startsWith(prefix), `${l.id}: used_later must start with "${prefix}", was "${l.learn.used_later}"`);
    const next = all.find((n) => n.number === l.number + 1);
    if (next) assert.equal(l.learn.used_later.slice(prefix.length), next.error_type, `${l.id}: next error name`);
  }
});

// ---- loader ----

const goodLesson = () => JSON.parse(readFileSync(join(dir, "lists.json"), "utf8"));

test("validate rejects a lesson with a missing required field, naming it", () => {
  const l = goodLesson();
  delete l.try.solution;
  assert.throws(() => validate(l), (e) => e instanceof LessonError && /try\.solution/.test(e.message));
});

test("validate rejects an unknown template", () => {
  const l = goodLesson();
  l.template = "nope";
  assert.throws(() => validate(l), (e) => e instanceof LessonError && /template/.test(e.message));
});

test("validate lists every problem, not just the first", () => {
  const l = goodLesson();
  delete l.what.heading;
  delete l.example.caption;
  assert.throws(
    () => validate(l),
    (e) => /what\.heading/.test(e.message) && /example\.caption/.test(e.message)
  );
});

test("validate allows empty youtube_id and empty link urls", () => {
  const l = goodLesson();
  l.learn.video.youtube_id = "";
  l.learn.links = [{ label: "x", url: "" }];
  assert.doesNotThrow(() => validate(l));
});

test("validate rejects a malformed youtube_id and non-https links", () => {
  const a = goodLesson();
  a.learn.video.youtube_id = "not a valid id!";
  assert.throws(() => validate(a), /learn\.video\.youtube_id/);
  const b = goodLesson();
  b.learn.links = [{ label: "x", url: "javascript:alert(1)" }];
  assert.throws(() => validate(b), /learn\.links\[0\]\.url/);
});

test("validate rejects the old (pre-binding) field names", () => {
  const l = goodLesson();
  l.eyebrow = l.kicker;
  delete l.kicker;
  assert.throws(() => validate(l), /kicker/);
  const m = goodLesson();
  m.what.body = "x";
  delete m.what.paragraphs;
  assert.throws(() => validate(m), /what\.paragraphs/);
});

test("validate accepts example.visual null and rejects a bad highlight", () => {
  const l = goodLesson();
  l.example.visual = null;
  assert.doesNotThrow(() => validate(l));
  const m = goodLesson();
  m.example.visual.highlight = 9;
  assert.throws(() => validate(m), /example\.visual\.highlight/);
});

const goodReadCode = () => ({
  id: "rc-demo",
  template: "read-code",
  title: "Read: demo",
  kicker: "Python for SDFs · Read the code",
  lines: [{ code: "x = 1", title: "Assign", text: "Stores 1 in x." }],
  predict: {
    question: "What does it print?",
    options: [
      { label: "1", ok: true, feedback: "Yes." },
      { label: "2", ok: false, feedback: "No." },
    ],
  },
  verify: { setup: "", code: "print(1)", stdout_startswith: "1" },
  learn: { video: { youtube_id: "", title: "" }, links: [], used_later: "Later." },
});

const goodFixError = () => ({
  id: "fe-demo",
  template: "fix-error",
  title: "Fix: KeyError",
  kicker: "Python for SDFs · Fix the error",
  number: 5,
  error_type: "KeyError",
  code: "d = {}\nd['a']",
  traceback: ["KeyError: 'a'"],
  notes: [{ label: "Last line", text: "The key is missing." }],
  arrow_line: 2,
  fixes: [
    { label: "A", ok: true, title: "Use get", feedback: "Right.", fixed_code: "d = {}\nd.get('a')" },
    { label: "B", ok: false, title: "Nope", feedback: "No.", fixed_code: "" },
  ],
  learn: { video: { youtube_id: "", title: "" }, links: [], used_later: "Later." },
});

test("validate accepts well-formed read-code and fix-error lessons (and verify: null)", () => {
  assert.doesNotThrow(() => validate(goodReadCode()));
  const rc = goodReadCode();
  rc.verify = null;
  assert.doesNotThrow(() => validate(rc));
  assert.doesNotThrow(() => validate(goodFixError()));
});

test("read-code needs exactly one ok option and the exact field names", () => {
  const a = goodReadCode();
  a.predict.options[1].ok = true;
  assert.throws(() => validate(a), /predict\.options/);
  const b = goodReadCode();
  delete b.lines;
  assert.throws(() => validate(b), /lines/);
  const c = goodReadCode();
  delete c.predict.options[0].feedback;
  assert.throws(() => validate(c), /predict\.options\[0\]\.feedback/);
  const d = goodReadCode();
  delete d.verify.setup;
  assert.throws(() => validate(d), /verify\.setup/);
});

test("fix-error needs number 1-8, exactly one ok fix, and the exact field names", () => {
  const a = goodFixError();
  a.number = 9;
  assert.throws(() => validate(a), /number/);
  const b = goodFixError();
  b.fixes[1].ok = true;
  assert.throws(() => validate(b), /fixes/);
  const c = goodFixError();
  c.arrow_line = 0;
  assert.throws(() => validate(c), /arrow_line/);
  const d = goodFixError();
  delete d.traceback;
  assert.throws(() => validate(d), /traceback/);
  const e = goodFixError();
  delete e.notes[0].label;
  assert.throws(() => validate(e), /notes\[0\]\.label/);
});

test("validate requires a check hint and a wrong fixture", () => {
  const a = goodLesson();
  a.try.checks[0].hint = "";
  assert.throws(() => validate(a), /try\.checks\[0\]\.hint/);
  const b = goodLesson();
  b.try.wrong = [];
  assert.throws(() => validate(b), /try\.wrong/);
});

function fakeFetch(map) {
  return async (url) => {
    const key = String(url);
    if (key in map) return { ok: true, status: 200, json: async () => map[key] };
    return { ok: false, status: 404, json: async () => ({}) };
  };
}

test("load reads ?lesson= and fetches lessons/<id>.json", async () => {
  const base = "https://example.org/lesson-templates/concept.html";
  const lesson = await load({
    search: "?lesson=lists",
    base,
    fetchFn: fakeFetch({ "https://example.org/lesson-templates/lessons/lists.json": goodLesson() }),
  });
  assert.equal(lesson.id, "lists");
});

test("load gives readable errors for missing param, bad id, 404, and wrong template", async () => {
  const base = "https://example.org/x/concept.html";
  await assert.rejects(load({ search: "", base, fetchFn: fakeFetch({}) }), /lesson/i);
  await assert.rejects(load({ search: "?lesson=../secret", base, fetchFn: fakeFetch({}) }), /lesson/i);
  await assert.rejects(load({ search: "?lesson=nope", base, fetchFn: fakeFetch({}) }), /couldn't find|not found/i);
  await assert.rejects(
    load({
      search: "?lesson=lists",
      base,
      expectTemplate: "read-code",
      fetchFn: fakeFetch({ "https://example.org/x/lessons/lists.json": goodLesson() }),
    }),
    /read-code/
  );
});

test("revealAllowed unlocks after two wrong tries", () => {
  assert.equal(revealAllowed(1), false);
  assert.equal(revealAllowed(2), true);
});

test("isLoadFailure treats LoadError and InternalError as 'Python could not load'", () => {
  const f = (type) => ({ ok: false, stdout: "", error: { type, message: "x", line: null }, timedOut: false });
  assert.equal(isLoadFailure(f("LoadError")), true);
  assert.equal(isLoadFailure(f("InternalError")), true);
  assert.equal(isLoadFailure(f("KeyError")), false);
  assert.equal(isLoadFailure({ ok: true, stdout: "", error: null, timedOut: false }), false);
  assert.equal(isLoadFailure({ ok: false, stdout: "", error: null, timedOut: true }), false);
});
