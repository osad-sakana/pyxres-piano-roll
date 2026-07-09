"use strict";
// PropertyPanel: tone/volume/effect/speedの編集（§4.1・§4.2）
// tones等は循環配列のため「全体一括」と「ノート個別」の2モードを持つ。
window.APP_VIEWS = window.APP_VIEWS || [];

const PropertyPanel = (() => {
  const TONE_LABELS = ["三角波", "矩形波", "パルス波", "ノイズ"];
  const EFFECT_LABELS = ["なし", "スライド", "ビブラート", "フェードアウト", "ハーフ", "クォーター"];
  const RATE_LABELS = { normal: "通常", double: "2倍", half: "1/2倍" };

  let app = null;
  let els = null;

  function buildSelect(id, labels) {
    const options = labels
      .map((label, i) => `<option value="${i}">${i}: ${label}</option>`)
      .join("");
    return `<select id="${id}">${options}</select>`;
  }

  function buildPanel(panel) {
    panel.innerHTML = `
      <label>パターン名 <input type="text" id="prop-name" size="12"></label>
      <label>長さ <input type="number" id="prop-length" min="1" max="999"></label>
      <label>再生 <select id="prop-rate">${Model.RATE_MODES.map(
        (m) => `<option value="${m}">${RATE_LABELS[m]}</option>`
      ).join("")}</select></label>
      <span class="mode-toggle">
        <label><input type="radio" name="prop-mode" value="bulk" checked> 全体一括</label>
        <label><input type="radio" name="prop-mode" value="note"> ノート個別</label>
      </span>
      <label>tone ${buildSelect("prop-tone", TONE_LABELS)}</label>
      <label>volume <input type="number" id="prop-volume" min="0" max="${Model.VOLUME_MAX}"></label>
      <label>effect ${buildSelect("prop-effect", EFFECT_LABELS)}</label>
      <span id="prop-col-info"></span>
    `;
    els = {
      name: panel.querySelector("#prop-name"),
      length: panel.querySelector("#prop-length"),
      rate: panel.querySelector("#prop-rate"),
      tone: panel.querySelector("#prop-tone"),
      volume: panel.querySelector("#prop-volume"),
      effect: panel.querySelector("#prop-effect"),
      colInfo: panel.querySelector("#prop-col-info"),
      modeRadios: [...panel.querySelectorAll('input[name="prop-mode"]')],
    };
  }

  // 一括: 配列を[value]へ / 個別: notesと同長に展開して選択列のみ変更（§4.2）
  function applyProperty(field, value) {
    const state = app.getState();
    const pattern = app.currentPattern();
    if (!pattern) return;
    if (state.propertyMode === "bulk") {
      app.updateProject((p) => Model.updatePattern(p, state.songId, pattern.id, { [field]: [value] }));
      return;
    }
    if (state.selectedCol === null) return;
    const expanded = Model.expandProperty(pattern, field);
    const values = expanded[field].map((v, i) => (i === state.selectedCol ? value : v));
    app.updateProject((p) => Model.updatePattern(p, state.songId, pattern.id, { [field]: values }));
  }

  function clampInt(input, min, max, fallback) {
    const value = Number.parseInt(input.value, 10);
    if (Number.isNaN(value)) return fallback;
    return Math.min(max, Math.max(min, value));
  }

  function init(appRef) {
    app = appRef;
    buildPanel(document.getElementById("property-panel"));

    els.name.addEventListener("input", () => {
      const { songId } = app.getState();
      const pattern = app.currentPattern();
      if (pattern) {
        app.updateProject((p) => Model.updatePattern(p, songId, pattern.id, { name: els.name.value }));
      }
    });
    els.length.addEventListener("change", () => {
      const { songId } = app.getState();
      const pattern = app.currentPattern();
      if (!pattern) return;
      const length = clampInt(els.length, 1, 999, pattern.notes.length);
      app.updateProject(
        (p) => Model.updatePattern(p, songId, pattern.id, Model.resizePattern(pattern, length)),
        { selectedCol: null }
      );
    });
    els.rate.addEventListener("change", () => {
      const { songId } = app.getState();
      const pattern = app.currentPattern();
      if (!pattern) return;
      app.updateProject((p) => Model.updatePattern(p, songId, pattern.id, { rateMode: els.rate.value }));
    });
    els.tone.addEventListener("change", () => applyProperty("tones", Number(els.tone.value)));
    els.volume.addEventListener("change", () =>
      applyProperty("volumes", clampInt(els.volume, 0, Model.VOLUME_MAX, 7))
    );
    els.effect.addEventListener("change", () => applyProperty("effects", Number(els.effect.value)));
    for (const radio of els.modeRadios) {
      radio.addEventListener("change", () => app.setState({ propertyMode: radio.value }));
    }
  }

  function syncInput(input, value) {
    if (document.activeElement !== input && String(input.value) !== String(value)) {
      input.value = value;
    }
  }

  function render(state) {
    const pattern = app.currentPattern();
    const disabled = !pattern;
    for (const key of ["name", "length", "rate", "tone", "volume", "effect"]) {
      els[key].disabled = disabled;
    }
    if (!pattern) {
      els.colInfo.textContent = "パターン未選択";
      return;
    }

    syncInput(els.name, pattern.name);
    syncInput(els.length, pattern.notes.length);
    syncInput(els.rate, pattern.rateMode);

    const noteMode = state.propertyMode === "note";
    const col = state.selectedCol;
    const idx = noteMode && col !== null ? col : 0;
    syncInput(els.tone, pattern.tones[idx % pattern.tones.length]);
    syncInput(els.volume, pattern.volumes[idx % pattern.volumes.length]);
    syncInput(els.effect, pattern.effects[idx % pattern.effects.length]);

    const needCol = noteMode && col === null;
    els.tone.disabled = els.volume.disabled = els.effect.disabled = needCol;
    const song = app.currentSong();
    const speedInfo = song ? `書き出しspeed ≈ ${Model.patternSpeed(song, pattern)}` : "";
    els.colInfo.textContent = noteMode
      ? col !== null
        ? `編集対象: ${col + 1}列目`
        : "列を選択してください"
      : speedInfo;
  }

  return { init, render };
})();

window.APP_VIEWS.push(PropertyPanel);
