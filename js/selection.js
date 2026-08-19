"use strict";
// 選択状態（selectedCol/selectionAnchor）に関する純粋ロジック。
// js/app.jsの状態パッチ適用から呼ばれる。DOM・Model非依存でNode単体テスト可能にする。
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

  return { normalizePatch };
})();

if (typeof module !== "undefined") module.exports = Selection;
