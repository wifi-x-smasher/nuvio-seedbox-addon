"use strict";

// Guard against syntax errors in the admin page's embedded browser JS. The page
// is a big template literal, so `node --check` on the module can't catch a
// broken <script> (it's just a string). We render it and compile the script with
// `new Function`, which throws on a syntax error without executing it.

const test = require("node:test");
const assert = require("node:assert/strict");

const renderPage = require("../src/admin-page");

test("admin page embedded <script> is syntactically valid", () => {
  const html = renderPage();
  const m = html.match(/<script>([\s\S]*?)<\/script>/);
  assert.ok(m, "admin page should contain a <script> block");
  assert.doesNotThrow(() => new Function(m[1]));
});
