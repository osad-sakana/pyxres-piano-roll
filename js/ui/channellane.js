"use strict";
// ChannelLaneView: 曲構造（seqs）の編集ビュー（§4.3 / v5グリッド）
// チャンネルはセルのグリッド。空白セル（null=1小節の休符）を挟んで
// トラックの途中からでもパターンを配置できる。
// ブロック幅は実再生時間（notes.length × speed / 120秒）に比例。
window.APP_VIEWS = window.APP_VIEWS || [];

const ChannelLaneView = (() => {
  const PX_PER_SECOND = 40;
  const MIN_BLOCK_W = 36;

  let app = null;

  function commitChannels(song, channels) {
    app.updateProject((p) => Model.updateSong(p, song.id, { channels }));
  }

  function secondsToWidth(seconds) {
    return `${Math.max(MIN_BLOCK_W, seconds * PX_PER_SECOND)}px`;
  }

  function restWidth(song) {
    return secondsToWidth((Model.REST_CELL_COLUMNS * Model.bpmToSpeed(song.bpm)) / 120);
  }

  // ドロップ処理。kind: "block"（挿入） / "cell"（空白セル・プレースホルダへ配置）
  function handleDrop(song, ch, idx, kind, payload) {
    if (payload.type === "pattern") {
      const updated =
        kind === "block"
          ? Model.insertChannelCell(song, ch, idx, payload.id)
          : Model.setChannelCell(song, ch, idx, payload.id);
      commitChannels(song, updated.channels);
      return;
    }
    if (payload.type === "block") {
      const pid = song.channels[payload.ch][payload.idx];
      if (pid == null || (payload.ch === ch && payload.idx === idx)) return;
      // 移動元は空白セルにしてグリッド位置を保つ
      let updated = Model.setChannelCell(song, payload.ch, payload.idx, null);
      updated =
        kind === "block"
          ? Model.insertChannelCell(updated, ch, idx, pid)
          : Model.setChannelCell(updated, ch, idx, pid);
      commitChannels(song, updated.channels);
    }
  }

  function parsePayload(event) {
    try {
      return JSON.parse(event.dataTransfer.getData("text/plain"));
    } catch (_) {
      return null;
    }
  }

  function makeDropTarget(element, song, ch, idx, kind) {
    element.addEventListener("dragover", (e) => {
      e.preventDefault();
      e.stopPropagation();
      element.classList.add("drag-over");
    });
    element.addEventListener("dragleave", () => element.classList.remove("drag-over"));
    element.addEventListener("drop", (e) => {
      e.preventDefault();
      e.stopPropagation();
      element.classList.remove("drag-over");
      const payload = parsePayload(e);
      if (payload) handleDrop(song, ch, idx, kind, payload);
    });
  }

  function buildBlock(state, song, ch, idx, patternById) {
    const pid = song.channels[ch][idx];
    const pattern = patternById.get(pid);
    const block = document.createElement("span");
    block.className = "lane-block";
    block.classList.toggle("selected-pattern", pid === state.patternId);

    const seconds = pattern
      ? (pattern.notes.length * Model.patternSpeed(song, pattern)) / 120
      : 0.5;
    block.style.width = secondsToWidth(seconds);
    block.title = pattern ? `${pattern.name}（${seconds.toFixed(1)}秒）` : pid;

    const name = document.createElement("span");
    name.textContent = pattern ? pattern.name || pid : `?${pid}`;
    name.style.overflow = "hidden";
    name.style.textOverflow = "ellipsis";
    name.style.flex = "1";
    block.appendChild(name);

    const dup = document.createElement("button");
    dup.className = "block-dup";
    dup.textContent = "⧉";
    dup.title = "右に複製";
    dup.addEventListener("click", (e) => {
      e.stopPropagation();
      app.updateProject((p) => Model.duplicatePatternInChannel(p, song.id, ch, idx));
    });
    block.appendChild(dup);

    const del = document.createElement("button");
    del.className = "block-del";
    del.textContent = "✕";
    del.title = "空白にする（後続のタイミングは保たれる）";
    del.addEventListener("click", (e) => {
      e.stopPropagation();
      commitChannels(song, Model.setChannelCell(song, ch, idx, null).channels);
    });
    block.appendChild(del);

    block.addEventListener("click", () => app.setState({ patternId: pid, selectedCol: null }));
    block.draggable = true;
    block.addEventListener("dragstart", (e) => {
      e.dataTransfer.setData("text/plain", JSON.stringify({ type: "block", ch, idx }));
    });
    makeDropTarget(block, song, ch, idx, "block"); // ブロック上へのドロップ＝その位置へ挿入
    return block;
  }

  // 空白セル（null）とプレースホルダ（グリッドの未使用部分）
  function buildEmptyCell(state, song, ch, idx, isPlaceholder) {
    const cell = document.createElement("span");
    cell.className = `lane-cell ${isPlaceholder ? "placeholder" : "empty"}`;
    cell.style.width = restWidth(song);
    cell.title = isPlaceholder
      ? "ドロップまたはクリックでここへ配置"
      : "空白（1小節の休符）。ドロップ/クリックで配置";

    if (!isPlaceholder) {
      const del = document.createElement("button");
      del.className = "block-del";
      del.textContent = "✕";
      del.title = "この空白を詰める";
      del.addEventListener("click", (e) => {
        e.stopPropagation();
        commitChannels(song, Model.removeChannelCell(song, ch, idx).channels);
      });
      cell.appendChild(del);
    }

    // クリックで選択中パターンを配置
    cell.addEventListener("click", () => {
      const pid = app.getState().patternId;
      if (pid) commitChannels(song, Model.setChannelCell(song, ch, idx, pid).channels);
    });
    makeDropTarget(cell, song, ch, idx, "cell");
    return cell;
  }

  function render(state) {
    const song = app.currentSong();
    const title = document.getElementById("channel-lane-title");
    const rows = document.getElementById("lane-rows");
    const bpmInput = document.getElementById("song-bpm");
    const transposeInput = document.getElementById("song-transpose");
    rows.textContent = "";

    bpmInput.disabled = !song;
    transposeInput.disabled = !song;
    if (!song) {
      title.textContent = "曲構造（曲未選択）";
      return;
    }
    title.textContent = `曲構造: ${song.name || song.id}`;
    if (document.activeElement !== bpmInput && String(bpmInput.value) !== String(song.bpm)) {
      bpmInput.value = song.bpm;
    }
    if (
      document.activeElement !== transposeInput &&
      String(transposeInput.value) !== String(song.transpose)
    ) {
      transposeInput.value = song.transpose;
    }
    const patternById = new Map(song.patterns.map((p) => [p.id, p]));

    // 全チャンネルで同じグリッド幅を見せる（最長+2、最低4セル）
    const maxLen = song.channels.reduce((m, c) => Math.max(m, c.length), 0);
    const gridBound = Math.max(maxLen + 2, 4);

    song.channels.forEach((cells, ch) => {
      const row = document.createElement("div");
      row.className = "lane-row";

      const label = document.createElement("span");
      label.className = "lane-label";
      label.textContent = `ch${ch}`;
      row.appendChild(label);

      const blocks = document.createElement("div");
      blocks.className = "lane-blocks";
      cells.forEach((cell, idx) => {
        blocks.appendChild(
          cell !== null
            ? buildBlock(state, song, ch, idx, patternById)
            : buildEmptyCell(state, song, ch, idx, false)
        );
      });
      for (let idx = cells.length; idx < gridBound; idx++) {
        blocks.appendChild(buildEmptyCell(state, song, ch, idx, true));
      }
      row.appendChild(blocks);

      const del = document.createElement("button");
      del.className = "ch-del";
      del.textContent = "✕";
      del.title = "チャンネルを削除";
      del.addEventListener("click", () => {
        if (cells.length === 0 || confirm(`ch${ch}を削除しますか？`)) {
          app.updateProject((p) => Model.updateSong(p, song.id, Model.removeChannel(song, ch)));
        }
      });
      row.appendChild(del);
      rows.appendChild(row);
    });

    if (song.channels.length < Model.MAX_CHANNELS) {
      const add = document.createElement("button");
      add.className = "add-btn";
      add.textContent = "＋ チャンネル追加";
      add.addEventListener("click", () => {
        app.updateProject((p) => Model.updateSong(p, song.id, Model.addChannel(song)));
      });
      rows.appendChild(add);
    }
  }

  function init(appRef) {
    app = appRef;
    document.getElementById("song-bpm").addEventListener("change", (e) => {
      const song = app.currentSong();
      if (!song) return;
      const raw = Number.parseInt(e.target.value, 10);
      const bpm = Number.isNaN(raw)
        ? song.bpm
        : Math.min(Model.BPM_MAX, Math.max(Model.BPM_MIN, raw));
      app.updateProject((p) => Model.updateSong(p, song.id, { bpm }));
    });
    document.getElementById("song-transpose").addEventListener("change", (e) => {
      const song = app.currentSong();
      if (!song) return;
      const raw = Number.parseInt(e.target.value, 10);
      const transpose = Number.isNaN(raw)
        ? song.transpose
        : Math.min(Model.TRANSPOSE_MAX, Math.max(Model.TRANSPOSE_MIN, raw));
      app.updateProject((p) => Model.updateSong(p, song.id, { transpose }));
    });
  }

  return { init, render };
})();

window.APP_VIEWS.push(ChannelLaneView);
