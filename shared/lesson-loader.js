// Loads and validates a lesson JSON file. Pure enough to run in Node (tests)
// and in the browser (pass nothing: it reads location and uses fetch).

export class LessonError extends Error {
  constructor(message) {
    super(message);
    this.name = "LessonError";
  }
}

const ID_RE = /^[a-z0-9][a-z0-9-]*$/;
const YOUTUBE_RE = /^[A-Za-z0-9_-]{6,20}$/;
const TEMPLATES = ["concept", "read-code", "fix-error"];

const isStr = (v) => typeof v === "string";
const nonEmpty = (v) => isStr(v) && v.trim() !== "";
const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

// Collects every problem so an author sees them all at once.
function checker() {
  const problems = [];
  const bad = (path, why = "missing or empty") => problems.push(`${path} (${why})`);
  return {
    problems,
    bad,
    text(obj, key, path) {
      if (!isObj(obj) || !nonEmpty(obj[key])) bad(`${path}${key}`);
    },
    str(obj, key, path) {
      if (!isObj(obj) || !isStr(obj[key])) bad(`${path}${key}`, "must be text");
    },
    obj(parent, key, path) {
      const v = isObj(parent) ? parent[key] : undefined;
      if (!isObj(v)) {
        bad(`${path}${key}`, "missing section");
        return null;
      }
      return v;
    },
    list(parent, key, path, { min = 0 } = {}) {
      const v = isObj(parent) ? parent[key] : undefined;
      if (!Array.isArray(v) || v.length < min) {
        bad(`${path}${key}`, min ? `needs at least ${min}` : "must be a list");
        return [];
      }
      return v;
    },
  };
}

function validateLearn(l, c) {
  const learn = c.obj(l, "learn", "");
  if (!learn) return;
  // youtube_id, link urls and the video title may be empty: Task 16 fills them in.
  // Empty means "show a Video coming soon placeholder" / "hide the link".
  const video = c.obj(learn, "video", "learn.");
  if (video) {
    if (!isStr(video.youtube_id)) c.bad("learn.video.youtube_id", "must be text (empty is allowed)");
    else if (video.youtube_id !== "") {
      if (!YOUTUBE_RE.test(video.youtube_id)) {
        c.bad("learn.video.youtube_id", "must be a YouTube video id like dQw4w9WgXcQ");
      }
      c.text(video, "title", "learn.video.");
    } else c.str(video, "title", "learn.video.");
  }
  c.text(learn, "used_later", "learn.");
  c.list(learn, "links", "learn.").forEach((link, i) => {
    c.text(link, "label", `learn.links[${i}].`);
    if (!isObj(link) || !isStr(link.url)) c.bad(`learn.links[${i}].url`, "must be text (empty is allowed)");
    else if (link.url !== "" && !/^https:\/\//.test(link.url)) {
      c.bad(`learn.links[${i}].url`, "must start with https://");
    }
  });
}

function validateConcept(l, c) {
  const what = c.obj(l, "what", "");
  if (what) {
    c.text(what, "heading", "what.");
    c.text(what, "code", "what.");
    c.list(what, "paragraphs", "what.", { min: 1 }).forEach((p, i) => {
      if (!nonEmpty(p)) c.bad(`what.paragraphs[${i}]`);
    });
    c.list(what, "points", "what.").forEach((pt, i) => {
      c.text(pt, "title", `what.points[${i}].`);
      c.text(pt, "text", `what.points[${i}].`);
    });
  }

  const ex = c.obj(l, "example", "");
  if (ex) {
    c.text(ex, "heading", "example.");
    c.text(ex, "code", "example.");
    c.text(ex, "caption", "example.");
    if (ex.visual === undefined) c.bad("example.visual", "must be null or a boxes visual");
    else if (ex.visual !== null) {
      const v = ex.visual;
      if (!isObj(v) || v.type !== "boxes") c.bad("example.visual.type", 'must be "boxes"');
      else {
        c.text(v, "label", "example.visual.");
        const items = c.list(v, "items", "example.visual.", { min: 1 });
        items.forEach((it, i) => {
          if (!nonEmpty(it)) c.bad(`example.visual.items[${i}]`);
        });
        if (!Number.isInteger(v.highlight) || v.highlight < 0 || v.highlight >= items.length) {
          c.bad("example.visual.highlight", "must be the position of one of the items");
        }
      }
    }
  }

  c.list(l, "demos", "", { min: 1 }).forEach((d, i) => {
    c.text(d, "label", `demos[${i}].`);
    c.text(d, "code", `demos[${i}].`);
    c.text(d, "note", `demos[${i}].`);
  });

  const t = c.obj(l, "try", "");
  if (t) {
    c.text(t, "prompt", "try.");
    c.str(t, "starter", "try.");
    c.text(t, "solution", "try.");
    const checks = c.list(t, "checks", "try.");
    checks.forEach((chk, i) => {
      c.text(chk, "expr", `try.checks[${i}].`);
      c.text(chk, "hint", `try.checks[${i}].`);
      if (!isObj(chk) || !("expect" in chk)) c.bad(`try.checks[${i}].expect`);
    });
    const hasStdout = t.expect_stdout != null;
    if (t.expect_stdout === undefined) c.bad("try.expect_stdout", "must be text or null");
    else if (hasStdout) {
      if (!isStr(t.expect_stdout)) c.bad("try.expect_stdout", "must be text or null");
      c.text(t, "stdout_hint", "try.");
    }
    if (checks.length === 0 && !hasStdout) c.bad("try.checks", "needs at least one check or expect_stdout");
    c.list(t, "wrong", "try.", { min: 1 }).forEach((w, i) => {
      c.str(w, "code", `try.wrong[${i}].`);
      c.text(w, "hint_contains", `try.wrong[${i}].`);
    });
  }
}

function exactlyOneOk(items, path, c) {
  const n = items.filter((o) => isObj(o) && o.ok === true).length;
  if (n !== 1) c.bad(path, `needs exactly one ok: true (found ${n})`);
}

function validateReadCode(l, c) {
  c.list(l, "lines", "", { min: 1 }).forEach((ln, i) => {
    c.text(ln, "code", `lines[${i}].`);
    c.text(ln, "title", `lines[${i}].`);
    c.text(ln, "text", `lines[${i}].`);
  });
  const p = c.obj(l, "predict", "");
  if (p) {
    c.text(p, "question", "predict.");
    const opts = c.list(p, "options", "predict.", { min: 2 });
    opts.forEach((o, i) => {
      c.text(o, "label", `predict.options[${i}].`);
      c.text(o, "feedback", `predict.options[${i}].`);
      if (!isObj(o) || typeof o.ok !== "boolean") c.bad(`predict.options[${i}].ok`, "must be true or false");
    });
    exactlyOneOk(opts, "predict.options", c);
  }
  if (l.verify === undefined) c.bad("verify", "must be null or {setup, code, stdout_startswith}");
  else if (l.verify !== null) {
    c.str(l.verify, "setup", "verify.");
    c.text(l.verify, "code", "verify.");
    c.text(l.verify, "stdout_startswith", "verify.");
  }
}

function validateFixError(l, c) {
  if (!Number.isInteger(l.number) || l.number < 1 || l.number > 8) c.bad("number", "must be a whole number from 1 to 8");
  c.text(l, "error_type", "");
  c.text(l, "code", "");
  c.list(l, "traceback", "", { min: 1 }).forEach((line, i) => {
    if (!isStr(line)) c.bad(`traceback[${i}]`, "must be text");
  });
  c.list(l, "notes", "").forEach((n, i) => {
    c.text(n, "label", `notes[${i}].`);
    c.text(n, "text", `notes[${i}].`);
  });
  if (!Number.isInteger(l.arrow_line) || l.arrow_line < 1) c.bad("arrow_line", "must be a 1-based line number");
  const fixes = c.list(l, "fixes", "", { min: 2 });
  fixes.forEach((f, i) => {
    c.text(f, "label", `fixes[${i}].`);
    c.text(f, "title", `fixes[${i}].`);
    c.text(f, "feedback", `fixes[${i}].`);
    c.str(f, "fixed_code", `fixes[${i}].`);
    if (!isObj(f) || typeof f.ok !== "boolean") c.bad(`fixes[${i}].ok`, "must be true or false");
    else if (f.ok) c.text(f, "fixed_code", `fixes[${i}].`);
  });
  exactlyOneOk(fixes, "fixes", c);
}

// Throws LessonError listing every missing/invalid field; returns the lesson if fine.
export function validate(lesson) {
  const c = checker();
  if (!isObj(lesson)) throw new LessonError("This lesson file is not a JSON object.");
  if (!TEMPLATES.includes(lesson.template)) {
    throw new LessonError(`This lesson has an unknown template: ${JSON.stringify(lesson.template)} (template).`);
  }
  if (!isStr(lesson.id) || !ID_RE.test(lesson.id)) c.bad("id", "lowercase letters, digits and dashes");
  c.text(lesson, "title", "");
  c.text(lesson, "kicker", "");
  validateLearn(lesson, c);
  if (lesson.template === "concept") validateConcept(lesson, c);
  else if (lesson.template === "read-code") validateReadCode(lesson, c);
  else validateFixError(lesson, c);

  if (c.problems.length) {
    throw new LessonError(
      `This lesson file has problems in: ${c.problems.join("; ")}. Fix these in lessons/${lesson.id || "<id>"}.json.`
    );
  }
  return lesson;
}

// load({search, base, fetchFn, expectTemplate}) -> Promise<Lesson>
// In the browser all options default to the page's own location and fetch.
export async function load({
  search = globalThis.location?.search ?? "",
  base = globalThis.document?.baseURI ?? globalThis.location?.href,
  fetchFn = globalThis.fetch?.bind(globalThis),
  expectTemplate = null,
} = {}) {
  const id = new URLSearchParams(search).get("lesson");
  if (!id) throw new LessonError("No lesson chosen. Add ?lesson=<name> to the page address, for example ?lesson=lists.");
  if (!ID_RE.test(id)) throw new LessonError(`"${id}" is not a valid lesson name. Use lowercase letters, digits and dashes.`);

  const url = new URL(`lessons/${id}.json`, base);
  let res;
  try {
    res = await fetchFn(url.href);
  } catch {
    throw new LessonError("The lesson file couldn't be loaded. Check your internet connection and reload the page.");
  }
  if (!res.ok) {
    throw new LessonError(
      res.status === 404
        ? `We couldn't find a lesson called "${id}".`
        : `The lesson file couldn't be loaded (error ${res.status}). Reload the page to try again.`
    );
  }
  let lesson;
  try {
    lesson = await res.json();
  } catch {
    throw new LessonError(`The lesson file "${id}" is not valid JSON.`);
  }
  validate(lesson);
  if (expectTemplate && lesson.template !== expectTemplate) {
    throw new LessonError(
      `Lesson "${id}" uses the ${lesson.template} template, not ${expectTemplate}. Open it with ${lesson.template}.html instead.`
    );
  }
  return lesson;
}
