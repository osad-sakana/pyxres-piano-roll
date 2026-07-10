"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const Storage = require("../js/storage.js");
const Model = require("../js/model.js");

function fakeLocalStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
  };
}

test("serialize/parseProject: ラウンドトリップで一致", () => {
  const p = Model.addPattern(Model.addSong(Model.createProject()), "s1");
  const restored = Storage.parseProject(Storage.serializeProject(p));
  assert.deepEqual(restored, p);
});

test("parseProject: 不正JSONは拒否", () => {
  assert.throws(() => Storage.parseProject("{not json"));
});

test("parseProject: 未対応formatVersionは拒否", () => {
  const bad = JSON.stringify({ formatVersion: 99, songs: [] });
  assert.throws(() => Storage.parseProject(bad), /formatVersion/);
});

test("parseProject: v1のJSONは最新フォーマットへ自動マイグレーションされる", () => {
  const v1 = JSON.stringify({
    formatVersion: 1,
    meta: { title: "旧", created: "", modified: "" },
    patterns: [{ id: "p1", name: "A", notes: [24], tones: [1], volumes: [7], effects: [0], speed: 20 }],
    songs: [{ id: "s1", name: "曲A", channels: [["p1"]] }],
    export: { musicSlots: ["s1", null, null, null, null, null, null, null] },
  });
  const project = Storage.parseProject(v1);
  assert.equal(project.formatVersion, 3);
  assert.equal(project.songs[0].bpm, 90); // speed20 → bpm90
  assert.equal(project.songs[0].patterns[0].rateMode, "normal");
  assert.deepEqual(project.songs[0].patterns[0].lengths, [1]);
});

test("parseProject: 必須フィールド欠落は拒否", () => {
  const bad = JSON.stringify({ formatVersion: 2 });
  assert.throws(() => Storage.parseProject(bad));
});

test("saveToLocalStorage/loadFromLocalStorage: 保存と復元", () => {
  const ls = fakeLocalStorage();
  const p = Model.addSong(Model.createProject());
  Storage.saveToLocalStorage(p, ls);
  const restored = Storage.loadFromLocalStorage(ls);
  assert.deepEqual(restored, p);
});

test("loadFromLocalStorage: 未保存ならnull、壊れたデータもnull", () => {
  const ls = fakeLocalStorage();
  assert.equal(Storage.loadFromLocalStorage(ls), null);
  ls.setItem(Storage.STORAGE_KEY, "{broken");
  assert.equal(Storage.loadFromLocalStorage(ls), null);
});

test("createAutosaver: debounceされ最後の状態のみ保存される", async () => {
  const ls = fakeLocalStorage();
  const autosave = Storage.createAutosaver(ls, 30);
  const p1 = Model.addSong(Model.createProject());
  const p2 = Model.addPattern(p1, "s1");
  autosave(p1);
  autosave(p2);
  assert.equal(ls.getItem(Storage.STORAGE_KEY), null); // まだ保存されない
  await new Promise((r) => setTimeout(r, 80));
  assert.deepEqual(Storage.loadFromLocalStorage(ls), p2);
});
