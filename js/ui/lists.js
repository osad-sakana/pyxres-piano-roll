"use strict";
// SongList / PatternList: 曲・パターンの一覧と選択（§4.1）
window.APP_VIEWS = window.APP_VIEWS || [];

const ListsView = (() => {
  let app = null;

  function renderList(ul, items, selectedId, handlers) {
    ul.textContent = "";
    for (const item of items) {
      const li = document.createElement("li");
      li.classList.toggle("selected", item.id === selectedId);

      const name = document.createElement("span");
      name.className = "item-name";
      name.textContent = item.name || item.id;
      name.title = "ダブルクリックで名前変更";
      li.appendChild(name);

      if (handlers.onDuplicate) {
        const dup = document.createElement("button");
        dup.className = "del-btn";
        dup.textContent = "⧉";
        dup.title = "複製";
        dup.addEventListener("click", (e) => {
          e.stopPropagation();
          handlers.onDuplicate(item);
        });
        li.appendChild(dup);
      }

      const del = document.createElement("button");
      del.className = "del-btn";
      del.textContent = "✕";
      del.addEventListener("click", (e) => {
        e.stopPropagation();
        handlers.onDelete(item);
      });
      li.appendChild(del);

      li.addEventListener("click", () => handlers.onSelect(item));
      name.addEventListener("dblclick", () => {
        const next = prompt("名前を入力", item.name);
        if (next !== null) handlers.onRename(item, next);
      });
      if (handlers.draggable) {
        li.draggable = true;
        li.addEventListener("dragstart", (e) => {
          e.dataTransfer.setData(
            "text/plain",
            JSON.stringify({ type: "pattern", id: item.id })
          );
        });
      }
      ul.appendChild(li);
    }
  }

  function init(appRef) {
    app = appRef;
    document.getElementById("btn-add-song").addEventListener("click", () => {
      app.updateProject((p) => Model.addSong(p), {});
      const songs = app.getState().project.songs;
      app.setState({ songId: songs[songs.length - 1].id, patternId: null, selectedCol: null });
    });
    document.getElementById("btn-add-pattern").addEventListener("click", () => {
      const { songId } = app.getState();
      if (!songId) return;
      try {
        app.updateProject((p) => Model.addPattern(p, songId), {});
      } catch (error) {
        alert(error.message);
        return;
      }
      const song = app.currentSong();
      app.setState({ patternId: song.patterns[song.patterns.length - 1].id, selectedCol: null });
    });
  }

  function render(state) {
    renderList(document.getElementById("song-list"), state.project.songs, state.songId, {
      onSelect: (song) =>
        app.setState({
          songId: song.id,
          patternId: app.firstPatternId(state.project, song.id),
          selectedCol: null,
        }),
      onRename: (song, name) => app.updateProject((p) => Model.updateSong(p, song.id, { name })),
      onDelete: (song) => {
        if (!confirm(`曲「${song.name}」を削除しますか？曲内のパターンも失われます。`)) return;
        app.updateProject((p) => Model.removeSong(p, song.id), {
          songId: state.songId === song.id ? null : state.songId,
          patternId: state.songId === song.id ? null : state.patternId,
        });
      },
    });

    // パターンは選択中の曲のものだけを表示する（曲 has many パターン）
    const song = app.currentSong();
    renderList(document.getElementById("pattern-list"), song ? song.patterns : [], state.patternId, {
      draggable: true,
      onSelect: (pat) => app.setState({ patternId: pat.id, selectedCol: null }),
      onDuplicate: (pat) => {
        const newId = Model.nextId(song.patterns, "p");
        try {
          app.updateProject((p) => Model.duplicatePattern(p, state.songId, pat.id), {
            patternId: newId,
            selectedCol: null,
          });
        } catch (error) {
          alert(error.message);
        }
      },
      onRename: (pat, name) =>
        app.updateProject((p) => Model.updatePattern(p, state.songId, pat.id, { name })),
      onDelete: (pat) => {
        if (!confirm(`パターン「${pat.name}」を削除しますか？曲内の配置も除去されます。`)) return;
        app.updateProject((p) => Model.removePattern(p, state.songId, pat.id), {
          patternId: state.patternId === pat.id ? null : state.patternId,
          selectedCol: null,
        });
      },
    });
    document.getElementById("btn-add-pattern").disabled = !song;
  }

  return { init, render };
})();

window.APP_VIEWS.push(ListsView);
