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
      app.setState({ songId: songs[songs.length - 1].id });
    });
    document.getElementById("btn-add-pattern").addEventListener("click", () => {
      app.updateProject((p) => Model.addPattern(p), {});
      const patterns = app.getState().project.patterns;
      app.setState({ patternId: patterns[patterns.length - 1].id, selectedCol: null });
    });
  }

  function render(state) {
    renderList(document.getElementById("song-list"), state.project.songs, state.songId, {
      onSelect: (song) => app.setState({ songId: song.id }),
      onRename: (song, name) => app.updateProject((p) => Model.updateSong(p, song.id, { name })),
      onDelete: (song) => {
        if (!confirm(`曲「${song.name}」を削除しますか？`)) return;
        app.updateProject((p) => Model.removeSong(p, song.id), {
          songId: state.songId === song.id ? null : state.songId,
        });
      },
    });

    renderList(
      document.getElementById("pattern-list"),
      state.project.patterns,
      state.patternId,
      {
        draggable: true,
        onSelect: (pat) => app.setState({ patternId: pat.id, selectedCol: null }),
        onRename: (pat, name) => app.updateProject((p) => Model.updatePattern(p, pat.id, { name })),
        onDelete: (pat) => {
          if (!confirm(`パターン「${pat.name}」を削除しますか？曲内の配置も除去されます。`)) return;
          app.updateProject((p) => Model.removePattern(p, pat.id), {
            patternId: state.patternId === pat.id ? null : state.patternId,
            selectedCol: null,
          });
        },
      }
    );
  }

  return { init, render };
})();

window.APP_VIEWS.push(ListsView);
