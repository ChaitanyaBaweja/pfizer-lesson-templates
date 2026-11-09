// The three template pages share one shell: same element ids, same shell module.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const root = fileURLToPath(new URL("..", import.meta.url));
const pages = { "concept.html": "concept.js", "read-code.html": "read-code.js", "fix-error.html": "fix-error.js" };

for (const [page, script] of Object.entries(pages)) {
  test(`${page} has the shared shell skeleton and loads shared/${script}`, () => {
    assert.ok(existsSync(join(root, page)), `${page} is missing`);
    const html = readFileSync(join(root, page), "utf8");
    for (const id of ["lesson", "eyebrow", "title", "step-count", "tabs", "panels", "back", "next"]) {
      assert.ok(html.includes(`id="${id}"`), `${page} lacks #${id}`);
    }
    assert.ok(html.includes(`./shared/${script}`), `${page} does not load ./shared/${script}`);
    assert.ok(existsSync(join(root, "shared", script)), `shared/${script} is missing`);
  });
}

test("the page scripts do not duplicate the shell's tab logic", () => {
  for (const script of Object.values(pages)) {
    const src = readFileSync(join(root, "shared", script), "utf8");
    assert.ok(!src.includes("ArrowRight"), `${script} has its own tab keyboard handling`);
    assert.ok(!src.includes("function revealInPanel"), `${script} redefines revealInPanel`);
  }
});
