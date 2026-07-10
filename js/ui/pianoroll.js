"use strict";
// PianoRollView: 縦60行×横note数のcanvas編集（§4.2）
// 音価対応: ノートは複数列を占有し、ブロック右端のドラッグで長さを変更できる。
window.APP_VIEWS = window.APP_VIEWS || [];

const PianoRollView = (() => {
  const KEY_W = 40; // 左端の鍵盤ラベル列
  const COL_W = 22;
  const ROW_H = 12;
  const ROWS = 60; // note値0〜59（C0〜B4）
  const EDGE_W = 6; // 右端のリサイズ判定幅（px）
  const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
  const BLACK_KEYS = new Set([1, 3, 6, 8, 10]);

  let app = null;
  let canvas = null;
  let ctx = null;
  // ドラッグ状態: { mode: "move" | "resize", ... }
  let drag = null;
  // 直近に入力した音程。休符列でのEnter入力に使う
  let lastNote = 24;

  function noteName(value) {
    return `${NOTE_NAMES[value % 12]}${Math.floor(value / 12)}`;
  }

  function rowToNote(row) {
    return ROWS - 1 - row;
  }

  function pointAt(event) {
    const rect = canvas.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  function cellAt(event) {
    const { x, y } = pointAt(event);
    const col = Math.floor((x - KEY_W) / COL_W);
    const row = Math.floor(y / ROW_H);
    if (x < KEY_W || row < 0 || row >= ROWS) return null;
    return { col, note: rowToNote(row) };
  }

  // セル位置のノートスパンと、右端リサイズ領域かどうかを判定する
  function hitAt(event, pattern) {
    const cell = cellAt(event);
    if (!cell || cell.col < 0 || cell.col >= pattern.notes.length) return { cell: null };
    const span = Model.noteSpanAt(pattern, cell.col);
    if (!span || span.note !== cell.note) return { cell, span: null, onEdge: false };
    const edgeX = KEY_W + (span.start + span.len) * COL_W;
    const { x } = pointAt(event);
    return { cell, span, onEdge: x >= edgeX - EDGE_W };
  }

  function previewNote(pattern, col, note) {
    const tone = pattern.tones[col % pattern.tones.length];
    const volume = pattern.volumes[col % pattern.volumes.length];
    // 曲の移調を適用した実際の再生ピッチで鳴らす
    const song = app.currentSong();
    const pitch = Model.transposeNote(note, song ? song.transpose || 0 : 0);
    AudioEngine.play(AudioEngine.renderPreviewNote(pitch, tone, volume));
  }

  // パターン全体を差し替える形で更新する（Modelの音価ヘルパを使うため）
  function applyPattern(updated, patch = {}) {
    const state = app.getState();
    app.updateProject(
      (p) => Model.updatePattern(p, state.songId, state.patternId, updated),
      patch
    );
  }

  function place(col, value, len = null) {
    lastNote = value;
    applyPattern(Model.placeNote(app.currentPattern(), col, value, len), { selectedCol: col });
  }

  function remove(col) {
    applyPattern(Model.deleteNoteAt(app.currentPattern(), col), { selectedCol: col });
  }

  function move(fromCol, toCol, value) {
    lastNote = value;
    applyPattern(Model.moveNoteTo(app.currentPattern(), fromCol, toCol, value), {
      selectedCol: toCol,
    });
  }

  function resize(start, len) {
    applyPattern(Model.resizeNoteAt(app.currentPattern(), start, len));
  }

  function onMouseDown(event) {
    const pattern = app.currentPattern();
    if (!pattern) return;
    const { cell, span, onEdge } = hitAt(event, pattern);
    if (!cell) return;

    if (span && onEdge) {
      // 右端: 音価の変更モード
      drag = { mode: "resize", start: span.start, len: span.len };
      app.setState({ selectedCol: span.start });
      return;
    }
    if (span) {
      // ノート上: mouseupまで動かなければ削除、動けば移動
      drag = { mode: "move", col: span.start, note: span.note, moved: false, pendingDelete: true };
      app.setState({ selectedCol: span.start });
      return;
    }
    // 空きセル: 配置（覆っていたノートは切り詰め）。
    // そのままドラッグすると音価を伸ばせる（Logic/Cubaseの描画挙動）
    place(cell.col, cell.note);
    previewNote(pattern, cell.col, cell.note);
    drag = { mode: "resize", start: cell.col, len: 1 };
  }

  function onMouseMove(event) {
    const pattern = app.currentPattern();
    if (!pattern) return;

    if (!drag) {
      const { span, onEdge } = hitAt(event, pattern);
      canvas.style.cursor = span && onEdge ? "ew-resize" : "crosshair";
      return;
    }

    const cell = cellAt(event);
    if (!cell) return;
    const col = Math.min(pattern.notes.length - 1, Math.max(0, cell.col));

    if (drag.mode === "resize") {
      const len = Math.max(1, col - drag.start + 1);
      if (len !== drag.len) {
        resize(drag.start, len);
        drag = { ...drag, len };
      }
      return;
    }

    if (cell.col < 0 || cell.col >= pattern.notes.length) return;
    if (cell.col === drag.col && cell.note === drag.note) return;
    move(drag.col, cell.col, cell.note);
    previewNote(pattern, cell.col, cell.note);
    drag = { ...drag, col: cell.col, note: cell.note, moved: true, pendingDelete: false };
  }

  function onMouseUp() {
    if (drag && drag.mode === "move" && drag.pendingDelete && !drag.moved) {
      remove(drag.col);
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
      const span = Model.noteSpanAt(pattern, state.selectedCol);
      if (!span) return; // 休符列は対象外
      const delta = event.key === "ArrowUp" ? 1 : -1;
      const note = span.note + delta;
      if (note < 0 || note > Model.NOTE_MAX) return; // 音域端では止める
      place(span.start, note); // 音価は保たれる
      previewNote(pattern, span.start, note);
      return;
    }

    if (event.key === "Enter") {
      event.preventDefault();
      if (state.selectedCol === null) return;
      const span = Model.noteSpanAt(pattern, state.selectedCol);
      if (!span) {
        // 休符列: 直近に入力した音程で配置
        place(state.selectedCol, lastNote);
        previewNote(pattern, state.selectedCol, lastNote);
      } else {
        // 音符上: 休符に変更（音程は記憶し、再度Enterで復活できるようにする）
        lastNote = span.note;
        remove(state.selectedCol);
      }
    }
  }

  function rollColors() {
    const css = getComputedStyle(document.documentElement);
    const v = (name) => css.getPropertyValue(name).trim();
    return {
      bg: v("--roll-bg"),
      rowAlt: v("--roll-row-alt"),
      grid: v("--roll-grid"),
      gridStrong: v("--roll-grid-strong"),
      cLine: v("--roll-c-line"),
      selCol: v("--roll-selected-col"),
      note: v("--roll-note"),
      noteBorder: v("--roll-note-border"),
      keyWhite: v("--roll-key-white"),
      keyBlack: v("--roll-key-black"),
      keyBorder: v("--roll-key-border"),
      label: v("--roll-label"),
    };
  }

  function draw(state) {
    const pattern = app.currentPattern();
    const cols = pattern ? pattern.notes.length : 0;
    canvas.width = KEY_W + cols * COL_W;
    canvas.height = ROWS * ROW_H;

    const colors = rollColors();
    ctx.fillStyle = colors.bg;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    if (!pattern) return;

    // 行の縞（黒鍵行を暗く）
    ctx.fillStyle = colors.rowAlt;
    for (let row = 0; row < ROWS; row++) {
      if (BLACK_KEYS.has(rowToNote(row) % 12)) {
        ctx.fillRect(KEY_W, row * ROW_H, cols * COL_W, ROW_H);
      }
    }

    // 選択列のハイライト
    if (state.selectedCol !== null && state.selectedCol < cols) {
      ctx.fillStyle = colors.selCol;
      ctx.fillRect(KEY_W + state.selectedCol * COL_W, 0, COL_W, canvas.height);
    }

    // 縦グリッド（Domino風の緑系。4列=1拍ごとに強調）
    for (let col = 0; col <= cols; col++) {
      ctx.strokeStyle = col % 4 === 0 ? colors.gridStrong : colors.grid;
      ctx.beginPath();
      ctx.moveTo(KEY_W + col * COL_W + 0.5, 0);
      ctx.lineTo(KEY_W + col * COL_W + 0.5, canvas.height);
      ctx.stroke();
    }

    // Cの行の横区切り
    ctx.strokeStyle = colors.cLine;
    for (let row = 0; row < ROWS; row++) {
      if (rowToNote(row) % 12 === 0) {
        ctx.beginPath();
        ctx.moveTo(KEY_W, (row + 1) * ROW_H + 0.5);
        ctx.lineTo(canvas.width, (row + 1) * ROW_H + 0.5);
        ctx.stroke();
      }
    }

    // 左端の鍵盤（Domino風: 白鍵ベース＋黒鍵バー）
    ctx.fillStyle = colors.keyWhite;
    ctx.fillRect(0, 0, KEY_W, canvas.height);
    for (let row = 0; row < ROWS; row++) {
      const note = rowToNote(row);
      const pc = note % 12;
      if (BLACK_KEYS.has(pc)) {
        ctx.fillStyle = colors.keyBlack;
        ctx.fillRect(0, row * ROW_H, Math.floor(KEY_W * 0.55), ROW_H);
      }
      // 白鍵同士の境目（B/C・E/Fの間）に区切り線を引く
      if (pc === 0 || pc === 5) {
        ctx.strokeStyle = colors.keyBorder;
        ctx.beginPath();
        ctx.moveTo(0, (row + 1) * ROW_H + 0.5);
        ctx.lineTo(KEY_W, (row + 1) * ROW_H + 0.5);
        ctx.stroke();
      }
    }
    ctx.font = "9px sans-serif";
    ctx.fillStyle = colors.label;
    for (let row = 0; row < ROWS; row++) {
      const note = rowToNote(row);
      if (note % 12 === 0) {
        ctx.fillText(noteName(note), KEY_W - 15, (row + 1) * ROW_H - 3);
      }
    }
    ctx.strokeStyle = colors.keyBorder;
    ctx.beginPath();
    ctx.moveTo(KEY_W - 0.5, 0);
    ctx.lineTo(KEY_W - 0.5, canvas.height);
    ctx.stroke();

    // ノート（音価分の幅・縁取りつき。右端はリサイズハンドル）
    for (let col = 0; col < cols; col++) {
      const note = pattern.notes[col];
      if (note < 0) continue;
      const len = Math.min(pattern.lengths[col] || 1, cols - col);
      const row = ROWS - 1 - note;
      const x = KEY_W + col * COL_W + 1;
      const y = row * ROW_H + 1;
      const w = len * COL_W - 2;
      const h = ROW_H - 2;
      ctx.fillStyle = colors.note;
      ctx.fillRect(x, y, w, h);
      ctx.strokeStyle = colors.noteBorder;
      ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
      ctx.fillStyle = colors.noteBorder;
      ctx.fillRect(x + w - 3, y + 1, 2, h - 2);
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
