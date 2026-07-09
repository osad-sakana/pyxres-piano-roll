"use strict";
// ChannelLaneView: 曲構造（seqs）の編集ビュー（§4.3）
// パターンをブロックとして並べ、D&Dで順序変更・再利用配置を行う。
// ブロック幅は実再生時間（notes.length × speed / 120秒）に比例。
window.APP_VIEWS = window.APP_VIEWS || [];

const ChannelLaneView = (() => {
  const PX_PER_SECOND = 40;
  const MIN_BLOCK_W = 36;

  let app = null;

  function updateChannels(song, channels) {
    app.updateProject((p) => Model.updateSong(p, song.id, { channels }));
  }

  function withoutBlock(channels, ch, idx) {
    return channels.map((ids, i) => (i === ch ? ids.filter((_, j) => j !== idx) : ids));
  }

  function withInsert(channels, ch, idx, pid) {
    return channels.map((ids, i) =>
      i === ch ? [...ids.slice(0, idx), pid, ...ids.slice(idx)] : ids
    );
  }

  function handleDrop(song, targetCh, targetIdx, payload) {
    if (payload.type === "pattern") {
      const idx = targetIdx === null ? song.channels[targetCh].length : targetIdx;
      updateChannels(song, withInsert(song.channels, targetCh, idx, payload.id));
      return;
    }
    if (payload.type === "block") {
      const pid = song.channels[payload.ch][payload.idx];
      let channels = withoutBlock(song.channels, payload.ch, payload.idx);
      let idx = targetIdx === null ? channels[targetCh].length : targetIdx;
      // 同一チャンネル内で前方から後方へ移動する場合、除去分だけ挿入位置を詰める
      if (payload.ch === targetCh && targetIdx !== null && payload.idx < targetIdx) {
        idx -= 1;
      }
      updateChannels(song, withInsert(channels, targetCh, idx, pid));
    }
  }

  function parsePayload(event) {
    try {
      return JSON.parse(event.dataTransfer.getData("text/plain"));
    } catch (_) {
      return null;
    }
  }

  function makeDropTarget(element, song, ch, idx) {
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
      if (payload) handleDrop(song, ch, idx, payload);
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
    block.style.width = `${Math.max(MIN_BLOCK_W, seconds * PX_PER_SECOND)}px`;
    block.title = pattern ? `${pattern.name}（${seconds.toFixed(1)}秒）` : pid;

    const name = document.createElement("span");
    name.textContent = pattern ? pattern.name || pid : `?${pid}`;
    name.style.overflow = "hidden";
    name.style.textOverflow = "ellipsis";
    name.style.flex = "1";
    block.appendChild(name);

    const del = document.createElement("button");
    del.className = "block-del";
    del.textContent = "✕";
    del.title = "この配置を除去（パターン自体は残る）";
    del.addEventListener("click", (e) => {
      e.stopPropagation();
      updateChannels(song, withoutBlock(song.channels, ch, idx));
    });
    block.appendChild(del);

    block.addEventListener("click", () => app.setState({ patternId: pid, selectedCol: null }));
    block.draggable = true;
    block.addEventListener("dragstart", (e) => {
      e.dataTransfer.setData("text/plain", JSON.stringify({ type: "block", ch, idx }));
    });
    makeDropTarget(block, song, ch, idx); // ブロック上へのドロップ＝その位置へ挿入
    return block;
  }

  function render(state) {
    const song = app.currentSong();
    const title = document.getElementById("channel-lane-title");
    const rows = document.getElementById("lane-rows");
    const bpmInput = document.getElementById("song-bpm");
    rows.textContent = "";

    bpmInput.disabled = !song;
    if (!song) {
      title.textContent = "曲構造（曲未選択）";
      return;
    }
    title.textContent = `曲構造: ${song.name || song.id}`;
    if (document.activeElement !== bpmInput && String(bpmInput.value) !== String(song.bpm)) {
      bpmInput.value = song.bpm;
    }
    const patternById = new Map(song.patterns.map((p) => [p.id, p]));

    song.channels.forEach((ids, ch) => {
      const row = document.createElement("div");
      row.className = "lane-row";

      const label = document.createElement("span");
      label.className = "lane-label";
      label.textContent = `ch${ch}`;
      row.appendChild(label);

      const blocks = document.createElement("div");
      blocks.className = "lane-blocks";
      makeDropTarget(blocks, song, ch, null); // 空き領域へのドロップ＝末尾に追加
      ids.forEach((_, idx) => blocks.appendChild(buildBlock(state, song, ch, idx, patternById)));
      row.appendChild(blocks);

      const del = document.createElement("button");
      del.className = "ch-del";
      del.textContent = "✕";
      del.title = "チャンネルを削除";
      del.addEventListener("click", () => {
        if (ids.length === 0 || confirm(`ch${ch}を削除しますか？`)) {
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
  }

  return { init, render };
})();

window.APP_VIEWS.push(ChannelLaneView);
