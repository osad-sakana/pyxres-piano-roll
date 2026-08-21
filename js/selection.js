"use strict";
// 選択状態（selectedCol/selectionAnchor）に関する純粋ロジック。
// js/app.jsの状態パッチ適用や、js/ui/pianoroll.jsのルーラードラッグ選択から呼ばれる。
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

  // 小節番号ルーラーのドラッグから、列単位（最小ノート単位）の選択範囲を求める。
  // currentColは範囲外・アンカーより手前を許容し、内部で[0, cols-1]へクランプする。
  // アンカー列は固定したままキャレット（selectedCol）だけを追従させる。
  function colDragSelection(cols, anchorCol, currentCol) {
    const col = Math.min(cols - 1, Math.max(0, currentCol));
    return { selectedCol: col, selectionAnchor: anchorCol };
  }

  return { normalizePatch, colDragSelection };
})();

if (typeof module !== "undefined") module.exports = Selection;
