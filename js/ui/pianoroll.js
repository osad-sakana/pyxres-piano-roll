"use strict";
// PianoRollView: 縦60行×横note数のcanvas編集（§4.2）
window.APP_VIEWS = window.APP_VIEWS || [];

const PianoRollView = (() => {
  const KEY_W = 40; // 左端の鍵盤ラベル列
  const COL_W = 22;
  const ROW_H = 12;
  const ROWS = 60; // note値0〜59（C0〜B4）
  const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
  const BLACK_KEYS = new Set([1, 3, 6, 8, 10]);

  let app = null;
  let canvas = null;
  let ctx = null;
  // ドラッグ状態（移調・移動 / クリック削除の判定）
  let drag = null;
  // 直近に入力した音程。休符列でのEnter入力に使う
  let lastNote = 24;

  function noteName(value) {
    return `${NOTE_NAMES[value % 12]}${Math.floor(value / 12)}`;
  }

  function rowToNote(row) {
    return ROWS - 1 - row;
  }

  function cellAt(event) {
    const rect = canvas.getBoundingClientRect();
    const x = event.clientX - rect.left - KEY_W;
    const y = event.clientY - rect.top;
    const col = Math.floor(x / COL_W);
    const row = Math.floor(y / ROW_H);
    if (x < 0 || row < 0 || row >= ROWS) return null;
    return { col, note: rowToNote(row) };
  }

  function previewNote(pattern, col, note) {
    const tone = pattern.tones[col % pattern.tones.length];
    const volume = pattern.volumes[col % pattern.volumes.length];
    AudioEngine.play(AudioEngine.renderPreviewNote(note, tone, volume));
  }

  function setNote(col, value) {
    if (value >= 0) lastNote = value;
    const state = app.getState();
    app.updateProject(
      (p) => Model.updatePattern(p, state.songId, state.patternId, {
        notes: app.currentPattern().notes.map((n, i) => (i === col ? value : n)),
      }),
      { selectedCol: col }
    );
  }

  function moveNote(fromCol, toCol, note) {
    if (note >= 0) lastNote = note;
    const state = app.getState();
    app.updateProject(
      (p) => Model.updatePattern(p, state.songId, state.patternId, {
        notes: app.currentPattern().notes.map((n, i) => {
          if (i === toCol) return note;
          if (i === fromCol && fromCol !== toCol) return -1;
          return n;
        }),
      }),
      { selectedCol: toCol }
    );
  }

  function onMouseDown(event) {
    const pattern = app.currentPattern();
    if (!pattern) return;
    const cell = cellAt(event);
    if (!cell || cell.col < 0 || cell.col >= pattern.notes.length) return;

    const existing = pattern.notes[cell.col];
    if (existing === cell.note) {
      // 既存ノート上: mouseupまで動かなければ削除、動けば移動
      drag = { col: cell.col, note: cell.note, moved: false, pendingDelete: true };
    } else {
      setNote(cell.col, cell.note); // 配置（同一列の旧ノートは上書き＝1列1音）
      previewNote(pattern, cell.col, cell.note);
      drag = { col: cell.col, note: cell.note, moved: false, pendingDelete: false };
    }
  }

  function onMouseMove(event) {
    if (!drag) return;
    const pattern = app.currentPattern();
    if (!pattern) return;
    const cell = cellAt(event);
    if (!cell || cell.col < 0 || cell.col >= pattern.notes.length) return;
    if (cell.col === drag.col && cell.note === drag.note) return;

    moveNote(drag.col, cell.col, cell.note);
    previewNote(pattern, cell.col, cell.note);
    drag = { col: cell.col, note: cell.note, moved: true, pendingDelete: false };
  }

  function onMouseUp() {
    if (drag && drag.pendingDelete && !drag.moved) {
      setNote(drag.col, -1);
    }
    drag = null;
  }

  // 選択列がスクロール外に出ないよう追従させる
  function scrollColIntoView(col) {
    const scroll = document.getElementById("piano-roll-scroll");
    const left = KEY_W + col * COL_W;
    if (left - KEY_W < scroll.scrollLeft) {
      scroll.scrollLeft = left - KEY_W;
    } else if (left + COL_W > scroll.scrollLeft + scroll.clientWidth) {
      scroll.scrollLeft = left + COL_W - scroll.clientWidth;
    }
  }

  function onKeyDown(event) {
    // 入力欄へのタイピングやダイアログ表示中は奪わない
    const tag = document.activeElement ? document.activeElement.tagName : "";
    if (["INPUT", "SELECT", "TEXTAREA"].includes(tag)) return;
    if (document.querySelector("dialog[open]")) return;

    const pattern = app.currentPattern();
    if (!pattern) return;
    const state = app.getState();
    const cols = pattern.notes.length;

    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      event.preventDefault();
      const delta = event.key === "ArrowLeft" ? -1 : 1;
      const current = state.selectedCol !== null ? state.selectedCol : delta > 0 ? -1 : cols;
      const col = Math.min(cols - 1, Math.max(0, current + delta));
      app.setState({ selectedCol: col });
      scrollColIntoView(col);
      return;
    }

    if (event.key === "ArrowUp" || event.key === "ArrowDown") {
      event.preventDefault();
      if (state.selectedCol === null) return;
      const current = pattern.notes[state.selectedCol];
      if (current < 0) return; // 休符列は対象外
      const delta = event.key === "ArrowUp" ? 1 : -1;
      const note = current + delta;
      if (note < 0 || note > Model.NOTE_MAX) return; // 音域端では止める
      setNote(state.selectedCol, note);
      previewNote(pattern, state.selectedCol, note);
      return;
    }

    if (event.key === "Enter") {
      event.preventDefault();
      if (state.selectedCol === null) return;
      const current = pattern.notes[state.selectedCol];
      if (current < 0) {
        // 休符列: 直近に入力した音程で配置
        setNote(state.selectedCol, lastNote);
        previewNote(pattern, state.selectedCol, lastNote);
      } else {
        // 音符列: 休符に変更（音程は記憶し、再度Enterで復活できるようにする）
        lastNote = current;
        setNote(state.selectedCol, -1);
      }
    }
  }

  function draw(state) {
    const pattern = app.currentPattern();
    const cols = pattern ? pattern.notes.length : 0;
    canvas.width = KEY_W + cols * COL_W;
    canvas.height = ROWS * ROW_H;

    const css = getComputedStyle(document.documentElement);
    const colors = {
      bg: css.getPropertyValue("--bg-panel").trim(),
      bgDark: "#22232b",
      grid: css.getPropertyValue("--border").trim(),
      text: css.getPropertyValue("--text-dim").trim(),
      note: css.getPropertyValue("--note").trim(),
      accent: css.getPropertyValue("--accent").trim(),
    };

    ctx.fillStyle = colors.bg;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    if (!pattern) return;

    // 行の縞（黒鍵行を暗く）とCの行の区切り
    for (let row = 0; row < ROWS; row++) {
      const note = rowToNote(row);
      if (BLACK_KEYS.has(note % 12)) {
        ctx.fillStyle = colors.bgDark;
        ctx.fillRect(KEY_W, row * ROW_H, cols * COL_W, ROW_H);
      }
      if (note % 12 === 0) {
        ctx.strokeStyle = colors.grid;
        ctx.beginPath();
        ctx.moveTo(0, (row + 1) * ROW_H + 0.5);
        ctx.lineTo(canvas.width, (row + 1) * ROW_H + 0.5);
        ctx.stroke();
      }
    }

    // 選択列のハイライト
    if (state.selectedCol !== null && state.selectedCol < cols) {
      ctx.fillStyle = "rgba(79, 193, 255, 0.10)";
      ctx.fillRect(KEY_W + state.selectedCol * COL_W, 0, COL_W, canvas.height);
    }

    // グリッド線（4列ごとに強調）
    for (let col = 0; col <= cols; col++) {
      ctx.strokeStyle = colors.grid;
      ctx.globalAlpha = col % 4 === 0 ? 1 : 0.35;
      ctx.beginPath();
      ctx.moveTo(KEY_W + col * COL_W + 0.5, 0);
      ctx.lineTo(KEY_W + col * COL_W + 0.5, canvas.height);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;

    // 鍵盤ラベル列
    ctx.fillStyle = colors.bgDark;
    ctx.fillRect(0, 0, KEY_W, canvas.height);
    ctx.font = "9px sans-serif";
    for (let row = 0; row < ROWS; row++) {
      const note = rowToNote(row);
      if (BLACK_KEYS.has(note % 12)) {
        ctx.fillStyle = "#111";
        ctx.fillRect(0, row * ROW_H + 1, KEY_W - 14, ROW_H - 2);
      }
      if (note % 12 === 0) {
        ctx.fillStyle = colors.text;
        ctx.fillText(noteName(note), KEY_W - 13, (row + 1) * ROW_H - 3);
      }
    }

    // ノート
    ctx.fillStyle = colors.note;
    for (let col = 0; col < cols; col++) {
      const note = pattern.notes[col];
      if (note < 0) continue;
      const row = ROWS - 1 - note;
      ctx.fillRect(KEY_W + col * COL_W + 1, row * ROW_H + 1, COL_W - 2, ROW_H - 2);
    }
  }

  function init(appRef) {
    app = appRef;
    canvas = document.getElementById("piano-roll");
    ctx = canvas.getContext("2d");
    canvas.addEventListener("mousedown", onMouseDown);
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    window.addEventListener("keydown", onKeyDown);
  }

  function render(state) {
    const pattern = app.currentPattern();
    const title = document.getElementById("piano-roll-title");
    title.textContent = pattern
      ? `ピアノロール: ${pattern.name || pattern.id}`
      : "ピアノロール（パターン未選択）";
    draw(state);
  }

  return { init, render };
})();

window.APP_VIEWS.push(PianoRollView);
