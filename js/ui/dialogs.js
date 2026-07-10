"use strict";
// ExportDialog: スロット割り当てと書き出し前バリデーション（§3.3・§6.3）
// HelpDialog: 初回起動時の制約明示（§8）
window.APP_VIEWS = window.APP_VIEWS || [];

const DialogsView = (() => {
  const HELP_SEEN_KEY = "pyxel-music-editor-help-seen";
  let app = null;

  function el(id) {
    return document.getElementById(id);
  }

  function renderSlots(state) {
    const container = el("export-slots");
    container.textContent = "";
    state.project.export.musicSlots.forEach((songId, slot) => {
      const row = document.createElement("div");
      row.className = "export-slot";

      const label = document.createElement("span");
      label.textContent = `スロット${slot}`;
      row.appendChild(label);

      const select = document.createElement("select");
      const none = document.createElement("option");
      none.value = "";
      none.textContent = "（空トラック）";
      select.appendChild(none);
      for (const song of state.project.songs) {
        const opt = document.createElement("option");
        opt.value = song.id;
        opt.textContent = song.name || song.id;
        opt.selected = song.id === songId;
        select.appendChild(opt);
      }
      select.addEventListener("change", () => {
        app.updateProject((p) => ({
          ...p,
          export: {
            ...p.export,
            musicSlots: p.export.musicSlots.map((id, i) =>
              i === slot ? select.value || null : id
            ),
          },
        }));
      });
      row.appendChild(select);
      container.appendChild(row);
    });
  }

  function validationMessages(state) {
    const messages = [];
    const result = Model.allocateExport(state.project);
    if (!result.ok) {
      const detail = result.perSong.map((s) => `${s.name}: ${s.count}個`).join(" / ");
      messages.push({
        level: "error",
        text: `ユニークパターンが64枠を${result.excess}個超過しています（${detail}）`,
      });
      return { result, messages };
    }
    const usedSongIds = state.project.export.musicSlots.filter((id) => id !== null);
    const songById = new Map(state.project.songs.map((s) => [s.id, s]));
    for (const id of usedSongIds) {
      const song = songById.get(id);
      if (!song) continue;
      if (song.channels.every((ch) => ch.length === 0)) {
        messages.push({ level: "warn", text: `「${song.name}」は空の曲です（保存は可能）` });
      }
      const clamped = Model.transposeClampCount(song);
      if (clamped > 0) {
        messages.push({
          level: "warn",
          text: `「${song.name}」: 移調${song.transpose > 0 ? "+" : ""}${song.transpose}で${clamped}個のノートが音域外となり端へクランプされます`,
        });
      }
      for (const err of Model.validateSong(song)) {
        messages.push({ level: "error", text: `${song.name}: ${err}` });
      }
      for (const pattern of song.patterns) {
        for (const err of Model.validatePattern(pattern)) {
          messages.push({ level: "error", text: `${song.name} / ${pattern.name}: ${err}` });
        }
      }
    }
    return { result, messages };
  }

  function renderValidation(state) {
    const box = el("export-validation");
    box.textContent = "";
    const { messages } = validationMessages(state);
    for (const m of messages) {
      const div = document.createElement("div");
      div.className = m.level;
      div.textContent = m.text;
      box.appendChild(div);
    }
    el("btn-do-export").disabled = messages.some((m) => m.level === "error");
  }

  function doExport() {
    const state = app.getState();
    const result = Model.allocateExport(state.project);
    if (!result.ok) return;
    const bytes = Exporter.buildPyxres({ sounds: result.sounds, musics: result.musics });
    Storage.downloadPyxres(bytes, state.project.meta.title);
    el("export-dialog").close();
  }

  function init(appRef) {
    app = appRef;
    el("btn-export").addEventListener("click", () => {
      renderSlots(app.getState());
      renderValidation(app.getState());
      el("export-dialog").showModal();
    });
    el("btn-close-export").addEventListener("click", () => el("export-dialog").close());
    el("btn-do-export").addEventListener("click", doExport);
    el("btn-help").addEventListener("click", () => el("help-dialog").showModal());
    el("btn-close-help").addEventListener("click", () => el("help-dialog").close());

    if (!localStorage.getItem(HELP_SEEN_KEY)) {
      localStorage.setItem(HELP_SEEN_KEY, "1");
      el("help-dialog").showModal();
    }
  }

  function render(state) {
    if (el("export-dialog").open) {
      renderSlots(state);
      renderValidation(state);
    }
  }

  return { init, render };
})();

window.APP_VIEWS.push(DialogsView);
