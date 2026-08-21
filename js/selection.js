"use strict";
// 選択状態（selectedCol/selectionAnchor）に関する純粋ロジック。
// js/app.jsの状態パッチ適用や、js/ui/pianoroll.jsのルーラー選択から呼ばれる。
// DOM・Model非依存でNode単体テスト可能にする。
const Selection = (() => {
  // 範囲選択の起点は、キャレットが外れる・パターンが切り替わる操作で自動的に畳む
  // （呼び出し側でのselectionAnchorのリセット漏れを防ぐ）
  function normalizePatch(patch, currentPatternId) {
    if ("selectionAnchor" in patch) return patch;
    const patternChanged = "patternId" in patch && patch.patternId !== currentPatternId;
    if (patch.selectedCol === null || patternChanged) {
      return { ...patch, selectionAnchor: null };
    }
    return patch;
  }

  // 小節番号ルーラーのクリック／ドラッグから、小節境界に揃えた選択範囲を求める。
  // anchorCol/currentColは列インデックス（範囲外・逆順を許容し内部でクランプする）。
  // キャレット（selectedCol）は既存のCtrl+A等と同様、範囲の「ドラッグが進んでいる側」に置く。
  // cols >= 1 を前提とする（呼び出し側でパターンの列数が0でないことを保証すること）。
  function barDragSelection(cols, columnsPerBar, anchorCol, currentCol) {
    const clampCol = (col) => Math.min(cols - 1, Math.max(0, col));
    const barOf = (col) => Math.floor(clampCol(col) / columnsPerBar);
    const barStart = (bar) => bar * columnsPerBar;
    const barEnd = (bar) => Math.min(cols - 1, (bar + 1) * columnsPerBar - 1);

    const anchorBar = barOf(anchorCol);
    const currentBar = barOf(currentCol);

    if (currentBar >= anchorBar) {
      return { selectedCol: barEnd(currentBar), selectionAnchor: barStart(anchorBar) };
    }
    return { selectedCol: barStart(currentBar), selectionAnchor: barEnd(anchorBar) };
  }

  return { normalizePatch, barDragSelection };
})();

if (typeof module !== "undefined") module.exports = Selection;
