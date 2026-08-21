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
    // 空白セルを含むグリッドを再生可能パターン列へ解決してレンダリング
    const buf = AudioEngine.renderSong(Model.resolveChannels(song));
    if (buf.length === 0) return;
    const loop = el("chk-loop").checked;
    AudioEngine.play(buf, { loop, onEnded: () => app.setState({ playing: null }) });
    app.setState({ playing: "song" });
  }

  function stop() {
    AudioEngine.stop();
    app.setState({ playing: null });
  }

  // マウスクリック後はボタンからフォーカスを外し、ピアノロールの矢印キー操作等を
  // 阻害しないようにする（event.detail>0はマウス、0はキーボード操作を示す）
  function blurIfPointerEvent(event) {
    if (event.detail > 0) event.currentTarget.blur();
  }

  // トグルボタン共通: 対象種別が再生中なら停止、それ以外なら
  // （他方が再生中でもAudioEngine.playが内部でstopするため）そのまま再生開始する
  function togglePattern(event) {
    blurIfPointerEvent(event);
    if (app.getState().playing === "pattern") {
      stop();
      return;
    }
    playPattern();
  }

  function toggleSong(event) {
    blurIfPointerEvent(event);
    if (app.getState().playing === "song") {
      stop();
      return;
    }
    playSong();
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
    el("btn-play-pattern").addEventListener("click", togglePattern);
    el("btn-play-song").addEventListener("click", toggleSong);
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

  // 再生トグルボタンの表示をstate.playingから一元的に導出する。
  // hasTarget=falseでも再生中(isPlaying)なら停止できるようdisabledにはしない
  // （対象を削除した直後でも既存の再生を止められるようにするため）
  function renderToggleButton(id, isPlaying, hasTarget, label, playTitle) {
    const btn = el(id);
    btn.classList.toggle("playing", isPlaying);
    btn.setAttribute("aria-pressed", String(isPlaying));
    btn.disabled = !hasTarget && !isPlaying;
    btn.textContent = isPlaying ? `■ ${label}` : `▶ ${label}`;
    btn.title = isPlaying ? `${label}の再生を停止` : playTitle;
  }

  function render(state) {
    renderToggleButton(
      "btn-play-pattern",
      state.playing === "pattern",
      Boolean(app.currentPattern()),
      "パターン",
      "選択中パターンを再生"
    );
    renderToggleButton(
      "btn-play-song",
      state.playing === "song",
      Boolean(app.currentSong()),
      "曲",
      "選択中の曲を再生"
    );
    el("btn-theme").textContent = currentTheme() === "dark" ? "☀️" : "🌙";
    const title = el("project-title");
    if (title.value !== state.project.meta.title && document.activeElement !== title) {
      title.value = state.project.meta.title;
    }
  }

  return { init, render };
})();

window.APP_VIEWS.push(TransportBar);
