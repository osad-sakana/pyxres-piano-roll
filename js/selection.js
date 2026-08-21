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

  // 列単位（最小ノート単位）のドラッグ選択。ルーラー・本体キャンバス双方のドラッグ選択
  // （Shift+ドラッグ含む）から共通で呼ばれる。anchorCol/currentColは範囲外・逆順を許容し、
  // 内部で両方とも[0, cols-1]へクランプする。cols >= 1 を前提とする（呼び出し側の
  // js/ui/pianoroll.jsは、いずれの経路もpattern.notes.length === 0の時点で選択操作を
  // 開始しないためcols === 0では呼ばれない）。
  function colDragSelection(cols, anchorCol, currentCol) {
    const clamp = (col) => Math.min(cols - 1, Math.max(0, col));
    return { selectedCol: clamp(currentCol), selectionAnchor: clamp(anchorCol) };
  }

  return { normalizePatch, colDragSelection };
})();

if (typeof module !== "undefined") module.exports = Selection;
