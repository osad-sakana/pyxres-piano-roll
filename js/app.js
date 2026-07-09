"use strict";
// アプリ本体: 状態管理とビューの束ね（UI層 §4）
// 各ビューは window.APP_VIEWS に自己登録し、init(App)/render(state) を実装する。
const App = (() => {
  const autosave = Storage.createAutosaver();
  let state = null;

  function bootstrapProject() {
    const saved = Storage.loadFromLocalStorage();
    if (saved) return saved;
    let project = Model.addSong(Model.addPattern(Model.createProject()));
    const pid = project.patterns[0].id;
    const sid = project.songs[0].id;
    project = Model.updateSong(project, sid, { channels: [[pid]] });
    const musicSlots = [sid, ...Array(Model.MAX_MUSICS - 1).fill(null)];
    return { ...project, export: { musicSlots } };
  }

  function init() {
    const project = bootstrapProject();
    state = {
      project,
      songId: project.songs[0] ? project.songs[0].id : null,
      patternId: project.patterns[0] ? project.patterns[0].id : null,
      selectedCol: null,
      propertyMode: "bulk", // "bulk" = 全体一括 / "note" = ノート個別（§4.2）
      playing: null, // null | "pattern" | "song"
    };
    for (const view of window.APP_VIEWS) view.init(App);
    render();
  }

  function getState() {
    return state;
  }

  // UI状態のみの更新（projectを触らない）
  function setState(patch) {
    state = { ...state, ...patch };
    render();
  }

  // projectの更新。modified更新と自動保存を伴う
  function updateProject(fn, patch = {}) {
    const project = fn(state.project);
    const stamped = {
      ...project,
      meta: { ...project.meta, modified: new Date().toISOString() },
    };
    state = { ...state, ...patch, project: stamped };
    autosave(stamped);
    render();
  }

  // 読み込み等でプロジェクトを丸ごと差し替える
  function replaceProject(project) {
    state = {
      project,
      songId: project.songs[0] ? project.songs[0].id : null,
      patternId: project.patterns[0] ? project.patterns[0].id : null,
      selectedCol: null,
      propertyMode: "bulk",
      playing: null,
    };
    autosave(project);
    render();
  }

  function currentPattern() {
    return state.project.patterns.find((p) => p.id === state.patternId) || null;
  }

  function currentSong() {
    return state.project.songs.find((s) => s.id === state.songId) || null;
  }

  function render() {
    for (const view of window.APP_VIEWS) view.render(state);
  }

  return { init, getState, setState, updateProject, replaceProject, currentPattern, currentSong };
})();

window.addEventListener("DOMContentLoaded", App.init);
