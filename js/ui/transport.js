"use strict";
// TransportBar: 再生・停止・書き出し・JSON入出力（§4.1）
window.APP_VIEWS = window.APP_VIEWS || [];

const TransportBar = (() => {
  const THEME_KEY = "pyxel-music-editor-theme";
  let app = null;

  function el(id) {
    return document.getElementById(id);
  }

  function currentTheme() {
    return document.documentElement.dataset.theme === "dark" ? "dark" : "light";
  }

  function toggleTheme() {
    const next = currentTheme() === "dark" ? "light" : "dark";
    if (next === "dark") {
      document.documentElement.dataset.theme = "dark";
    } else {
      delete document.documentElement.dataset.theme;
    }
    localStorage.setItem(THEME_KEY, next);
    app.setState({}); // canvasがCSS変数を読み直すよう再描画する
  }

  function playPattern() {
    const song = app.currentSong();
    const pattern = app.currentPattern();
    if (!song || !pattern) return;
    const loop = el("chk-loop").checked;
    // bpmとrateModeからspeedを確定させてレンダリング
    AudioEngine.play(AudioEngine.renderPattern(Model.resolvePattern(song, pattern)), {
      loop,
      onEnded: () => app.setState({ playing: null }),
    });
    app.setState({ playing: "pattern" });
  }

  function playSong() {
    const song = app.currentSong();
    if (!song) return;
    const resolved = song.patterns.map((p) => Model.resolvePattern(song, p));
    const buf = AudioEngine.renderSong(song, resolved);
    if (buf.length === 0) return;
    const loop = el("chk-loop").checked;
    AudioEngine.play(buf, { loop, onEnded: () => app.setState({ playing: null }) });
    app.setState({ playing: "song" });
  }

  function stop() {
    AudioEngine.stop();
    app.setState({ playing: null });
  }

  async function loadJsonFile(file) {
    try {
      const project = await Storage.readProjectFile(file);
      app.replaceProject(project);
    } catch (error) {
      alert(`読み込みに失敗しました: ${error.message}`);
    }
  }

  function init(appRef) {
    app = appRef;
    el("btn-play-pattern").addEventListener("click", playPattern);
    el("btn-play-song").addEventListener("click", playSong);
    el("btn-stop").addEventListener("click", stop);
    el("btn-save-json").addEventListener("click", () =>
      Storage.downloadProjectJson(app.getState().project)
    );
    el("btn-load-json").addEventListener("click", () => el("file-load-json").click());
    el("file-load-json").addEventListener("change", (e) => {
      if (e.target.files[0]) loadJsonFile(e.target.files[0]);
      e.target.value = "";
    });
    el("project-title").addEventListener("input", (e) => {
      app.updateProject((p) => ({ ...p, meta: { ...p.meta, title: e.target.value } }));
    });
    el("btn-theme").addEventListener("click", toggleTheme);
  }

  function render(state) {
    el("btn-play-pattern").classList.toggle("playing", state.playing === "pattern");
    el("btn-play-song").classList.toggle("playing", state.playing === "song");
    el("btn-theme").textContent = currentTheme() === "dark" ? "☀️" : "🌙";
    const title = el("project-title");
    if (title.value !== state.project.meta.title && document.activeElement !== title) {
      title.value = state.project.meta.title;
    }
  }

  return { init, render };
})();

window.APP_VIEWS.push(TransportBar);
