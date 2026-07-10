"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const Model = require("../js/model.js");

// s1にパターンを1つ持つ最小プロジェクト
function baseProject() {
  let p = Model.addSong(Model.createProject());
  p = Model.addPattern(p, "s1");
  return p;
}

test("createProject: v3スキーマ（songs直下・patternsは曲が内包）", () => {
  const p = Model.createProject();
  assert.equal(p.formatVersion, 3);
  assert.deepEqual(p.songs, []);
  assert.equal("patterns" in p, false);
  assert.equal(p.export.musicSlots.length, 8);
});

test("createSong: bpm既定120・空パターン・1チャンネル", () => {
  const s = Model.createSong("s1");
  assert.equal(s.bpm, 120);
  assert.deepEqual(s.patterns, []);
  assert.deepEqual(s.channels, [[]]);
});

test("createPattern: rateMode既定normal・speedは持たない・音価は全て1", () => {
  const pat = Model.createPattern("p1");
  assert.equal(pat.rateMode, "normal");
  assert.equal("speed" in pat, false);
  assert.deepEqual(pat.notes, Array(16).fill(-1));
  assert.deepEqual(pat.lengths, Array(16).fill(1));
});

test("addPattern: 曲にパターンが追加され、元projectは不変", () => {
  const p1 = Model.addSong(Model.createProject());
  const p2 = Model.addPattern(p1, "s1");
  assert.equal(p1.songs[0].patterns.length, 0);
  assert.equal(p2.songs[0].patterns.length, 1);
});

test("addPattern: 1曲64個の構造的上限（Pyxel 64音枠対応）", () => {
  let p = Model.addSong(Model.createProject());
  for (let i = 0; i < Model.MAX_PATTERNS_PER_SONG; i++) {
    p = Model.addPattern(p, "s1");
  }
  assert.throws(() => Model.addPattern(p, "s1"), /64/);
});

test("updatePattern/removePattern: 曲内のパターンを対象にする", () => {
  let p = baseProject();
  p = Model.updatePattern(p, "s1", "p1", { name: "ベース" });
  assert.equal(p.songs[0].patterns[0].name, "ベース");
  p = Model.updateSong(p, "s1", { channels: [["p1", "p1"]] });
  p = Model.removePattern(p, "s1", "p1");
  assert.deepEqual(p.songs[0].patterns, []);
  assert.deepEqual(p.songs[0].channels, [[]]); // 配置も除去
});

test("bpmToSpeed: speed = round(1800/bpm)（1列=16分音符）", () => {
  assert.equal(Model.bpmToSpeed(120), 15);
  assert.equal(Model.bpmToSpeed(90), 20);
  assert.equal(Model.bpmToSpeed(60), 30);
  assert.equal(Model.bpmToSpeed(900), 2);
});

test("patternSpeed: rateModeでspeedを1/2倍・2倍に変換", () => {
  const song = { ...Model.createSong("s1"), bpm: 120 }; // base speed 15
  assert.equal(Model.patternSpeed(song, { rateMode: "normal" }), 15);
  assert.equal(Model.patternSpeed(song, { rateMode: "double" }), 8); // 2倍再生=半分のtick
  assert.equal(Model.patternSpeed(song, { rateMode: "half" }), 30);
});

test("patternSpeed: doubleでもspeedは1を下回らない", () => {
  const song = { ...Model.createSong("s1"), bpm: 900 }; // base speed 2
  assert.equal(Model.patternSpeed(song, { rateMode: "double" }), 1);
});

test("resolvePattern: speedが確定した再生用パターンを返す", () => {
  const song = { ...Model.createSong("s1"), bpm: 90 };
  const resolved = Model.resolvePattern(song, Model.createPattern("p1"));
  assert.equal(resolved.speed, 20);
});

test("validatePattern: rateMode検査を含む（speedは検査しない）", () => {
  const ok = Model.createPattern("p1");
  assert.deepEqual(Model.validatePattern(ok), []);
  const bad = { ...ok, volumes: [8], rateMode: "triple" };
  assert.equal(Model.validatePattern(bad).length, 2);
});

test("validateSong: BPM範囲（20〜900）を検査", () => {
  assert.deepEqual(Model.validateSong(Model.createSong("s1")), []);
  assert.equal(Model.validateSong({ ...Model.createSong("s1"), bpm: 10 }).length, 1);
  assert.equal(Model.validateSong({ ...Model.createSong("s1"), bpm: 1000 }).length, 1);
});

test("allocateExport: 曲内共有は同一sound、曲が違えば別sound", () => {
  let p = Model.createProject();
  p = Model.addSong(p); // s1
  p = Model.addSong(p); // s2
  p = Model.addPattern(p, "s1"); // s1/p1
  p = Model.addPattern(p, "s2"); // s2/p1（IDは曲ごとに独立）
  p = Model.updatePattern(p, "s1", "p1", { notes: [24] });
  p = Model.updatePattern(p, "s2", "p1", { notes: [36] });
  p = Model.updateSong(p, "s1", { channels: [["p1", "p1"]], bpm: 120 });
  p = Model.updateSong(p, "s2", { channels: [["p1"]], bpm: 60 });
  p = { ...p, export: { musicSlots: ["s1", "s2", null, null, null, null, null, null] } };

  const result = Model.allocateExport(p);
  assert.equal(result.ok, true);
  assert.deepEqual(result.sounds[0].notes, [24]);
  assert.equal(result.sounds[0].speed, 15); // s1: bpm120
  assert.deepEqual(result.sounds[1].notes, [36]);
  assert.equal(result.sounds[1].speed, 30); // s2: bpm60
  assert.deepEqual(result.musics[0].seqs, [[0, 0]]); // 曲内共有はindex共有
  assert.deepEqual(result.musics[1].seqs, [[1]]);
});

test("allocateExport: rateModeが書き出しspeedへ反映される", () => {
  let p = baseProject();
  p = Model.updatePattern(p, "s1", "p1", { rateMode: "double" });
  p = Model.updateSong(p, "s1", { channels: [["p1"]] });
  p = { ...p, export: { musicSlots: ["s1", null, null, null, null, null, null, null] } };
  const result = Model.allocateExport(p);
  assert.equal(result.sounds[0].speed, 8); // bpm120: 15 → double → 8
});

test("allocateExport: 合計64超過で拒否し超過数と曲別消費数を提示", () => {
  let p = Model.createProject();
  p = Model.addSong(p); // s1
  p = Model.addSong(p); // s2
  for (let i = 0; i < 40; i++) p = Model.addPattern(p, "s1");
  for (let i = 0; i < 30; i++) p = Model.addPattern(p, "s2");
  p = Model.updateSong(p, "s1", { channels: [p.songs[0].patterns.map((x) => x.id)] });
  p = Model.updateSong(p, "s2", { channels: [p.songs[1].patterns.map((x) => x.id)] });
  p = { ...p, export: { musicSlots: ["s1", "s2", null, null, null, null, null, null] } };

  const result = Model.allocateExport(p);
  assert.equal(result.ok, false);
  assert.equal(result.excess, 6);
  assert.deepEqual(
    result.perSong.map((s) => s.count),
    [40, 30]
  );
});

test("migrateProject: v1のグローバルパターンを参照曲へ取り込みbpmへ変換", () => {
  const v1 = {
    formatVersion: 1,
    meta: { title: "旧", created: "", modified: "" },
    patterns: [
      { id: "p1", name: "A", notes: [24], tones: [1], volumes: [7], effects: [0], speed: 20 },
      { id: "p2", name: "B", notes: [36], tones: [0], volumes: [7], effects: [0], speed: 20 },
      { id: "p9", name: "孤児", notes: [1], tones: [0], volumes: [7], effects: [0], speed: 30 },
    ],
    songs: [
      { id: "s1", name: "曲A", channels: [["p1", "p2", "p1"]] },
      { id: "s2", name: "曲B", channels: [["p1"]] }, // p1を曲間共有していた
    ],
    export: { musicSlots: ["s1", "s2", null, null, null, null, null, null] },
  };
  const migrated = Model.migrateProject(v1);
  assert.equal(migrated.formatVersion, 3);
  // 各曲が自分のパターンを持つ（曲間共有は複製に変わる）
  assert.deepEqual(migrated.songs[0].patterns.map((p) => p.id), ["p1", "p2", "p9"]); // 孤児は先頭曲へ
  assert.deepEqual(migrated.songs[1].patterns.map((p) => p.id), ["p1"]);
  assert.equal(migrated.songs[1].patterns[0].name, "A");
  // speed20 → bpm90
  assert.equal(migrated.songs[0].bpm, 90);
  assert.equal(migrated.songs[0].patterns[0].rateMode, "normal");
  assert.deepEqual(migrated.songs[0].patterns[0].lengths, [1]); // v3で音価が付与される
  assert.deepEqual(migrated.export.musicSlots.slice(0, 2), ["s1", "s2"]);
});

test("migrateProject: v2へは音価が付与される・v3はそのまま・未知バージョンは拒否", () => {
  const p = baseProject();
  assert.equal(Model.migrateProject(p), p);
  assert.throws(() => Model.migrateProject({ formatVersion: 99 }), /formatVersion/);

  const v2 = {
    formatVersion: 2,
    meta: { title: "", created: "", modified: "" },
    songs: [
      {
        id: "s1", name: "曲1", bpm: 120,
        patterns: [{ id: "p1", name: "A", notes: [24, -1], tones: [0], volumes: [7], effects: [0], rateMode: "normal" }],
        channels: [["p1"]],
      },
    ],
    export: { musicSlots: ["s1", null, null, null, null, null, null, null] },
  };
  const v3 = Model.migrateProject(v2);
  assert.equal(v3.formatVersion, 3);
  assert.deepEqual(v3.songs[0].patterns[0].lengths, [1, 1]);
});

// ---- 音価（v3） ----

// notes [24(len3), -, -, 28] のパターンを作る
function lengthsFixture() {
  let pat = Model.createPattern("p1");
  pat = Model.placeNote(pat, 0, 24, 3);
  pat = Model.placeNote(pat, 3, 28);
  return pat;
}

test("placeNote: 音価つきで配置され、覆われた列は休符のまま", () => {
  const pat = lengthsFixture();
  assert.equal(pat.notes[0], 24);
  assert.equal(pat.lengths[0], 3);
  assert.equal(pat.notes[1], -1);
  assert.equal(pat.notes[3], 28);
});

test("placeNote: 覆っている既存ノートは切り詰められる", () => {
  let pat = lengthsFixture();
  pat = Model.placeNote(pat, 2, 36); // 24(len3)の3列目に配置
  assert.equal(pat.lengths[0], 2); // 24はlen2へ短縮
  assert.equal(pat.notes[2], 36);
});

test("placeNote: 同じ列への配置は音価を保って音程だけ差し替え（移調用）", () => {
  let pat = lengthsFixture();
  pat = Model.placeNote(pat, 0, 26);
  assert.equal(pat.notes[0], 26);
  assert.equal(pat.lengths[0], 3);
});

test("noteSpanAt: 覆われた列からも開始列と音価が引ける", () => {
  const pat = lengthsFixture();
  assert.deepEqual(Model.noteSpanAt(pat, 1), { start: 0, len: 3, note: 24 });
  assert.deepEqual(Model.noteSpanAt(pat, 3), { start: 3, len: 1, note: 28 });
  assert.equal(Model.noteSpanAt(pat, 5), null);
});

test("resizeNoteAt: 次のノートとパターン末尾でクランプされる", () => {
  let pat = lengthsFixture();
  pat = Model.resizeNoteAt(pat, 0, 10); // col3に28がいるので最大3
  assert.equal(pat.lengths[0], 3);
  pat = Model.resizeNoteAt(pat, 3, 99); // 末尾16列まで
  assert.equal(pat.lengths[3], 13);
  pat = Model.resizeNoteAt(pat, 0, 0); // 最小1
  assert.equal(pat.lengths[0], 1);
});

test("deleteNoteAt: 覆われた列を指してもノート全体が消える", () => {
  let pat = lengthsFixture();
  pat = Model.deleteNoteAt(pat, 2);
  assert.equal(pat.notes[0], -1);
  assert.equal(pat.lengths[0], 1);
});

test("moveNoteTo: 音価を保って移動し、収まらない分は切り詰め", () => {
  let pat = lengthsFixture();
  pat = Model.moveNoteTo(pat, 1, 5, 24); // 24(len3)をcol5へ
  assert.equal(pat.notes[0], -1);
  assert.equal(pat.notes[5], 24);
  assert.equal(pat.lengths[5], 3);
  pat = Model.moveNoteTo(pat, 5, 2, 24); // col3の28の手前へ → len1に切り詰め
  assert.equal(pat.lengths[2], 1);
});

test("expandPattern: 音価が同音程の連続ノートへ分割される", () => {
  const pat = lengthsFixture();
  const expanded = Model.expandPattern(pat);
  assert.deepEqual(expanded.notes.slice(0, 4), [24, 24, 24, 28]);
  assert.deepEqual(pat.notes.slice(0, 4), [24, -1, -1, 28]); // 元は不変
});

test("expandPattern: ノート個別編集済みの属性は開始列の値を引き継ぐ", () => {
  let pat = lengthsFixture();
  pat = { ...pat, volumes: pat.notes.map((_, i) => (i === 0 ? 5 : 7)) };
  const expanded = Model.expandPattern(pat);
  assert.deepEqual(expanded.volumes.slice(0, 4), [5, 5, 5, 7]);
});

test("resolvePattern/allocateExport: 書き出しにも分割が反映される", () => {
  let p = Model.addSong(Model.createProject());
  p = Model.addPattern(p, "s1");
  p = Model.updatePattern(p, "s1", "p1", lengthsFixture());
  p = Model.updateSong(p, "s1", { channels: [["p1"]] });
  p = { ...p, export: { musicSlots: ["s1", null, null, null, null, null, null, null] } };
  const result = Model.allocateExport(p);
  assert.deepEqual(result.sounds[0].notes.slice(0, 4), [24, 24, 24, 28]);
});

test("resizePattern: 新しい末尾からはみ出す音価は切り詰められる", () => {
  const pat = lengthsFixture(); // 24(len3)
  const shorter = Model.resizePattern(pat, 2);
  assert.equal(shorter.lengths[0], 2);
  assert.equal(shorter.lengths.length, 2);
});

test("setNoteAt/resizePattern: 従来通り（パターン単体操作）", () => {
  const pat = Model.createPattern("p1");
  const updated = Model.setNoteAt(pat, 3, 24);
  assert.equal(updated.notes[3], 24);
  assert.throws(() => Model.setNoteAt(pat, 0, 60));
  const longer = Model.resizePattern(updated, 20);
  assert.equal(longer.notes.length, 20);
  assert.equal(longer.notes[19], -1);
});
