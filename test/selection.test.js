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

test("colDragSelection: 範囲内の列はそのままキャレットに反映しアンカーを維持する", () => {
  const result = Selection.colDragSelection(64, 5, 8);
  assert.deepEqual(result, { selectedCol: 8, selectionAnchor: 5 });
});

test("colDragSelection: 負の列は0にクランプする", () => {
  const result = Selection.colDragSelection(64, 5, -3);
  assert.deepEqual(result, { selectedCol: 0, selectionAnchor: 5 });
});

test("colDragSelection: 末尾を超える列はcols-1にクランプする", () => {
  const result = Selection.colDragSelection(64, 5, 200);
  assert.deepEqual(result, { selectedCol: 63, selectionAnchor: 5 });
});

test("colDragSelection: アンカーより手前へドラッグしてもアンカー列は動かない", () => {
  const result = Selection.colDragSelection(64, 20, 17);
  assert.deepEqual(result, { selectedCol: 17, selectionAnchor: 20 });
});

test("colDragSelection: 範囲外のアンカー列もクランプする", () => {
  const result = Selection.colDragSelection(64, -5, 10);
  assert.deepEqual(result, { selectedCol: 10, selectionAnchor: 0 });
});
