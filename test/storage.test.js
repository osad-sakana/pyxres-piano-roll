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
  const p = Model.addPattern(Model.createProject());
  const restored = Storage.parseProject(Storage.serializeProject(p));
  assert.deepEqual(restored, p);
});

test("parseProject: 不正JSONは拒否", () => {
  assert.throws(() => Storage.parseProject("{not json"));
});

test("parseProject: formatVersion不一致は拒否", () => {
  const bad = JSON.stringify({ formatVersion: 99, patterns: [], songs: [] });
  assert.throws(() => Storage.parseProject(bad), /formatVersion/);
});

test("parseProject: 必須フィールド欠落は拒否", () => {
  const bad = JSON.stringify({ formatVersion: 1 });
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
  const p1 = Model.createProject();
  const p2 = Model.addPattern(p1);
  autosave(p1);
  autosave(p2);
  assert.equal(ls.getItem(Storage.STORAGE_KEY), null); // まだ保存されない
  await new Promise((r) => setTimeout(r, 80));
  assert.deepEqual(Storage.loadFromLocalStorage(ls), p2);
});
