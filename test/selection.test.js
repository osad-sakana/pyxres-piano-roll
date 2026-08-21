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

test("barDragSelection: 同一小節内のクリックはその小節の全列を選択する", () => {
  const result = Selection.barDragSelection(64, 16, 20, 20);
  assert.deepEqual(result, { selectedCol: 31, selectionAnchor: 16 });
});

test("barDragSelection: 右方向へドラッグすると終端小節の末尾へキャレットが伸びる", () => {
  const result = Selection.barDragSelection(64, 16, 16, 48);
  assert.deepEqual(result, { selectedCol: 63, selectionAnchor: 16 });
});

test("barDragSelection: 左方向へドラッグするとアンカーが起点小節の末尾へ反転する", () => {
  const result = Selection.barDragSelection(64, 16, 48, 16);
  assert.deepEqual(result, { selectedCol: 16, selectionAnchor: 63 });
});

test("barDragSelection: 末尾が半端な小節はcols-1でクランプされる", () => {
  const result = Selection.barDragSelection(20, 16, 0, 18);
  assert.deepEqual(result, { selectedCol: 19, selectionAnchor: 0 });
});

test("barDragSelection: 範囲外の列は両端にクランプしてから小節を求める", () => {
  const withinBounds = Selection.barDragSelection(64, 16, -5, 200);
  assert.deepEqual(withinBounds, { selectedCol: 63, selectionAnchor: 0 });
});

test("barDragSelection: 3/4拍子(1小節12列)でも小節境界どおりに選択する", () => {
  const result = Selection.barDragSelection(48, 12, 12, 12);
  assert.deepEqual(result, { selectedCol: 23, selectionAnchor: 12 });
});
