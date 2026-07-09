"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const Model = require("../js/model.js");

test("createProject: 初期状態が設計書§3.2のスキーマに従う", () => {
  const p = Model.createProject();
  assert.equal(p.formatVersion, 1);
  assert.deepEqual(p.patterns, []);
  assert.deepEqual(p.songs, []);
  assert.equal(p.export.musicSlots.length, 8);
  assert.ok(p.export.musicSlots.every((s) => s === null));
  assert.equal(typeof p.meta.title, "string");
});

test("createPattern: 既定値（speed=30, tone/volume/effectは循環配列）", () => {
  const pat = Model.createPattern("p1");
  assert.equal(pat.id, "p1");
  assert.equal(pat.speed, 30);
  assert.deepEqual(pat.notes, Array(16).fill(-1));
  assert.deepEqual(pat.tones, [0]);
  assert.deepEqual(pat.volumes, [7]);
  assert.deepEqual(pat.effects, [0]);
});

test("addPattern: 元のprojectを変更しない（イミュータブル）", () => {
  const p1 = Model.createProject();
  const p2 = Model.addPattern(p1);
  assert.equal(p1.patterns.length, 0);
  assert.equal(p2.patterns.length, 1);
  assert.notEqual(p1, p2);
});

test("nextId: 既存IDと衝突しない連番を生成する", () => {
  assert.equal(Model.nextId([], "p"), "p1");
  assert.equal(Model.nextId([{ id: "p1" }, { id: "p5" }], "p"), "p6");
});

test("setNoteAt: 範囲内の値を設定し、元パターンを変更しない", () => {
  const pat = Model.createPattern("p1");
  const updated = Model.setNoteAt(pat, 3, 24);
  assert.equal(updated.notes[3], 24);
  assert.equal(pat.notes[3], -1);
});

test("setNoteAt: note範囲(-1〜59)外は拒否する", () => {
  const pat = Model.createPattern("p1");
  assert.throws(() => Model.setNoteAt(pat, 0, 60));
  assert.throws(() => Model.setNoteAt(pat, 0, -2));
});

test("resizePattern: 伸長時は休符(-1)で埋める", () => {
  const pat = Model.setNoteAt(Model.createPattern("p1"), 0, 12);
  const longer = Model.resizePattern(pat, 20);
  assert.equal(longer.notes.length, 20);
  assert.equal(longer.notes[0], 12);
  assert.equal(longer.notes[19], -1);
  const shorter = Model.resizePattern(longer, 4);
  assert.equal(shorter.notes.length, 4);
});

test("validatePattern: volume/effect/speedの範囲検査（§6.3）", () => {
  const ok = Model.createPattern("p1");
  assert.deepEqual(Model.validatePattern(ok), []);
  const bad = { ...ok, volumes: [8], effects: [6], speed: 0 };
  const errs = Model.validatePattern(bad);
  assert.equal(errs.length, 3);
});

test("addChannel: 4チャンネルを超える追加は構造的に不可（§6.3）", () => {
  let song = Model.createSong("s1");
  song = Model.addChannel(song);
  song = Model.addChannel(song);
  song = Model.addChannel(song);
  assert.equal(song.channels.length, 4);
  assert.throws(() => Model.addChannel(song));
});

test("allocateExport: パターンIDの参照が重複排除され登場順にsoundsへ割り当たる（§3.3）", () => {
  let p = Model.createProject();
  const pa = { ...Model.createPattern("pa"), notes: [24] };
  const pb = { ...Model.createPattern("pb"), notes: [26] };
  p = { ...p, patterns: [pa, pb] };
  const s1 = { id: "s1", name: "", channels: [["pa", "pb", "pa"], ["pb"]] };
  p = { ...p, songs: [s1], export: { musicSlots: ["s1", null, null, null, null, null, null, null] } };

  const result = Model.allocateExport(p);
  assert.equal(result.ok, true);
  assert.equal(result.sounds.length, 64);
  assert.deepEqual(result.sounds[0].notes, [24]);
  assert.deepEqual(result.sounds[1].notes, [26]);
  assert.deepEqual(result.sounds[2].notes, []); // 未使用枠は空エントリ
  assert.equal(result.musics.length, 8);
  assert.deepEqual(result.musics[0].seqs, [[0, 1, 0], [1]]);
  assert.deepEqual(result.musics[1].seqs, []); // 空トラック
});

test("allocateExport: ユニークパターン64超過で拒否し超過数と曲別消費数を提示（§3.3）", () => {
  let p = Model.createProject();
  const patterns = [];
  const ids = [];
  for (let i = 0; i < 70; i++) {
    patterns.push(Model.createPattern(`p${i}`));
    ids.push(`p${i}`);
  }
  const song = { id: "s1", name: "曲A", channels: [ids] };
  p = {
    ...p,
    patterns,
    songs: [song],
    export: { musicSlots: ["s1", null, null, null, null, null, null, null] },
  };
  const result = Model.allocateExport(p);
  assert.equal(result.ok, false);
  assert.equal(result.excess, 6);
  assert.deepEqual(result.perSong, [{ songId: "s1", name: "曲A", count: 70 }]);
});
