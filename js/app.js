"use strict";
// アプリ本体: 状態管理とビューの束ね（UI層 §4）
// 各ビューは window.APP_VIEWS に自己登録し、init(App)/render(state) を実装する。
const App = (() => {
  const autosave = Storage.createAutosaver();
  let state = null;

  function bootstrapProject() {
    const saved = Storage.loadFromLocalStorage();
    if (saved) return saved;
    let project = Model.addSong(Model.createProject());
    const sid = project.songs[0].id;
    project = Model.addPattern(project, sid);
    const pid = project.songs[0].patterns[0].id;
    project = Model.updateSong(project, sid, { channels: [[pid]] });
    const musicSlots = [sid, ...Array(Model.MAX_MUSICS - 1).fill(null)];
    return { ...project, export: { musicSlots } };
  }

  function firstPatternId(project, songId) {
    const song = project.songs.find((s) => s.id === songId);
    return song && song.patterns[0] ? song.patterns[0].id : null;
  }

  function init() {
    const project = bootstrapProject();
    const songId = project.songs[0] ? project.songs[0].id : null;
    state = {
      project,
      songId,
      patternId: firstPatternId(project, songId),
      selectedCol: null,
      selectionAnchor: null, // 範囲選択の起点列。nullなら単一列選択
      propertyMode: "bulk", // "bulk" = 全体一括 / "note" = ノート個別（§4.2）
      playing: null, // null | "pattern" | "song"
    };
    for (const view of window.APP_VIEWS) view.init(App);
    render();
  }

  function getState() {
    return state;
  }

  // 範囲選択の起点は、キャレットが外れる・パターンが切り替わる操作で自動的に畳む
  // （呼び出し側でのselectionAnchorのリセット漏れを防ぐ）
  function normalizePatch(patch) {
    if ("selectionAnchor" in patch) return patch;
    const patternChanged = "patternId" in patch && patch.patternId !== state.patternId;
    if (patch.selectedCol === null || patternChanged) {
      return { ...patch, selectionAnchor: null };
    }
    return patch;
  }

  // UI状態のみの更新（projectを触らない）
  function setState(patch) {
    state = { ...state, ...normalizePatch(patch) };
    render();
  }

  // projectの更新。modified更新と自動保存を伴う
  function updateProject(fn, patch = {}) {
    const project = fn(state.project);
    const stamped = {
      ...project,
      meta: { ...project.meta, modified: new Date().toISOString() },
    };
    state = { ...state, ...normalizePatch(patch), project: stamped };
    autosave(stamped);
    render();
  }

  // 読み込み等でプロジェクトを丸ごと差し替える
  function replaceProject(project) {
    const songId = project.songs[0] ? project.songs[0].id : null;
    state = {
      project,
      songId,
      patternId: firstPatternId(project, songId),
      selectedCol: null,
      selectionAnchor: null,
      propertyMode: "bulk",
      playing: null,
    };
    autosave(project);
    render();
  }

  function currentPattern() {
    const song = currentSong();
    if (!song) return null;
    return song.patterns.find((p) => p.id === state.patternId) || null;
  }

  function currentSong() {
    return state.project.songs.find((s) => s.id === state.songId) || null;
  }

  function render() {
    for (const view of window.APP_VIEWS) view.render(state);
  }

  return {
    init,
    getState,
    setState,
    updateProject,
    replaceProject,
    currentPattern,
    currentSong,
    firstPatternId,
  };
})();

window.addEventListener("DOMContentLoaded", App.init);
