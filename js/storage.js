"use strict";
// Storage層: localStorage自動保存 / JSON入出力（設計書§7）
// pyxresは書き出し専用。往復編集の正本は常に内部JSON。
const Storage = (() => {
  const STORAGE_KEY = "pyxel-music-editor-project";
  const AUTOSAVE_DEBOUNCE_MS = 1000;

  function serializeProject(project) {
    return JSON.stringify(project, null, 2);
  }

  function parseProject(json) {
    let data;
    try {
      data = JSON.parse(json);
    } catch (error) {
      throw new Error(`JSONの解析に失敗しました: ${error.message}`);
    }
    if (data.formatVersion !== 1) {
      throw new Error(`未対応のformatVersionです: ${data.formatVersion}`);
    }
    if (!Array.isArray(data.patterns) || !Array.isArray(data.songs)) {
      throw new Error("patterns/songsが見つかりません。プロジェクトJSONではない可能性があります");
    }
    if (!data.export || !Array.isArray(data.export.musicSlots)) {
      throw new Error("export.musicSlotsが見つかりません");
    }
    return data;
  }

  function saveToLocalStorage(project, ls = globalThis.localStorage) {
    ls.setItem(STORAGE_KEY, serializeProject(project));
  }

  function loadFromLocalStorage(ls = globalThis.localStorage) {
    const json = ls.getItem(STORAGE_KEY);
    if (json === null) return null;
    try {
      return parseProject(json);
    } catch (error) {
      // 壊れた自動保存データは復元せず新規開始（№7: 最低限の防御）
      return null;
    }
  }

  // 編集操作のたびに呼ぶ。debounce後に保存（既定1秒）
  function createAutosaver(ls = globalThis.localStorage, debounceMs = AUTOSAVE_DEBOUNCE_MS) {
    let timer = null;
    return (project) => {
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        try {
          saveToLocalStorage(project, ls);
        } catch (error) {
          // 容量超過等でも編集自体は継続できるようにする
        }
      }, debounceMs);
    };
  }

  // ---- ブラウザ専用: ファイルダウンロード / 読み込み ----
  function downloadBlob(data, filename, mimeType) {
    const blob = new Blob([data], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  function downloadProjectJson(project) {
    const title = project.meta.title || "project";
    downloadBlob(serializeProject(project), `${title}.json`, "application/json");
  }

  function downloadPyxres(bytes, title) {
    downloadBlob(bytes, `${title || "music"}.pyxres`, "application/zip");
  }

  function readProjectFile(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        try {
          resolve(parseProject(reader.result));
        } catch (error) {
          reject(error);
        }
      };
      reader.onerror = () => reject(new Error("ファイルの読み込みに失敗しました"));
      reader.readAsText(file);
    });
  }

  return {
    STORAGE_KEY,
    serializeProject,
    parseProject,
    saveToLocalStorage,
    loadFromLocalStorage,
    createAutosaver,
    downloadProjectJson,
    downloadPyxres,
    readProjectFile,
  };
})();

if (typeof module !== "undefined") module.exports = Storage;
