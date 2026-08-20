"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const Selection = require("../js/selection.js");

test("normalizePatch: selectedColがnullになるパッチはselectionAnchorも畳む", () => {
  const patch = Selection.normalizePatch({ selectedCol: null }, "p1");
  assert.deepEqual(patch, { selectedCol: null, selectionAnchor: null });
});

test("normalizePatch: patternIdが変わるパッチはselectionAnchorを畳む", () => {
  const patch = Selection.normalizePatch({ patternId: "p2" }, "p1");
  assert.deepEqual(patch, { patternId: "p2", selectionAnchor: null });
});

test("normalizePatch: patternIdが同じ値ならselectionAnchorを畳まない", () => {
  const patch = Selection.normalizePatch({ patternId: "p1" }, "p1");
  assert.deepEqual(patch, { patternId: "p1" });
});

test("normalizePatch: selectionAnchorが明示されていればそのまま優先する", () => {
  const patch = Selection.normalizePatch({ selectedCol: null, selectionAnchor: 3 }, "p1");
  assert.deepEqual(patch, { selectedCol: null, selectionAnchor: 3 });
});

test("normalizePatch: どちらの条件にも当てはまらなければパッチをそのまま返す", () => {
  const patch = Selection.normalizePatch({ selectedCol: 5 }, "p1");
  assert.deepEqual(patch, { selectedCol: 5 });
});
