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

test("createProject: v6スキーマ（songs直下・patternsは曲が内包）", () => {
  const p = Model.createProject();
  assert.equal(p.formatVersion, 6);
  assert.deepEqual(p.songs, []);
  assert.equal("patterns" in p, false);
  assert.equal(p.export.musicSlots.length, 8);
});

test("createSong: bpm既定120・transpose 0・拍子既定4/4・空パターン・1チャンネル", () => {
  const s = Model.createSong("s1");
  assert.equal(s.bpm, 120);
  assert.equal(s.transpose, 0);
  assert.equal(s.timeSignature, "4/4");
  assert.deepEqual(s.patterns, []);
  assert.deepEqual(s.channels, [[]]);
});

// ---- 拍子（v6） ----

test("columnsPerBar: 4/4は16列・3/4は12列・未定義は16列（4/4扱い）", () => {
  assert.equal(Model.columnsPerBar({ timeSignature: "4/4" }), 16);
  assert.equal(Model.columnsPerBar({ timeSignature: "3/4" }), 12);
  assert.equal(Model.columnsPerBar({}), 16);
});

test("columnsPerBar: song自体がnull、または不正なtimeSignature値でも安全に既定拍子へフォールバックする", () => {
  assert.equal(Model.columnsPerBar(null), 16);
  assert.equal(Model.columnsPerBar({ timeSignature: "6/8" }), 16);
  // Object直索引によるプロトタイプ汚染（"constructor"等）でも関数などが漏れ出さない
  assert.equal(Model.columnsPerBar({ timeSignature: "constructor" }), 16);
  assert.equal(Model.columnsPerBar({ timeSignature: "toString" }), 16);
});

test("addPattern: 新規パターンの長さは曲の拍子（1小節の列数）に追従する", () => {
  let p = Model.addSong(Model.createProject());
  p = Model.updateSong(p, "s1", { timeSignature: "3/4" });
  p = Model.addPattern(p, "s1");
  assert.equal(p.songs[0].patterns[0].notes.length, 12);
});

test("restCell: 空白セルの長さが曲の拍子に追従する", () => {
  const song44 = { ...Model.createSong("s1"), bpm: 120, timeSignature: "4/4" };
  assert.equal(Model.restCell(song44).notes.length, 16);
  const song34 = { ...Model.createSong("s1"), bpm: 120, timeSignature: "3/4" };
  assert.equal(Model.restCell(song34).notes.length, 12);
});

test("validateSong: 拍子は4/4・3/4のみ許可", () => {
  assert.deepEqual(Model.validateSong(Model.createSong("s1")), []);
  assert.equal(Model.validateSong({ ...Model.createSong("s1"), timeSignature: "6/8" }).length, 1);
  assert.equal(Model.validateSong({ ...Model.createSong("s1"), timeSignature: null }).length, 1);
});

test("migrateProject: v5→v6で各曲へtimeSignature「4/4」を付与", () => {
  const v5 = {
    formatVersion: 5,
    meta: { title: "", created: "", modified: "" },
    songs: [
      {
        id: "s1", name: "曲1", bpm: 120, transpose: 0,
        patterns: [Model.createPattern("p1")],
        channels: [["p1"]],
      },
    ],
    export: { musicSlots: Array(8).fill(null) },
  };
  const migrated = Model.migrateProject(v5);
  assert.equal(migrated.formatVersion, 6);
  assert.equal(migrated.songs[0].timeSignature, "4/4");
  assert.equal(migrated.songs[0].bpm, 120); // 他フィールドは保持
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

test("duplicatePattern: 内容を深いコピーで複製し元の直後へ挿入する", () => {
  let p = baseProject();
  p = Model.addPattern(p, "s1"); // p2（末尾）
  p = Model.updatePattern(p, "s1", "p1", {
    name: "ベース",
    notes: [24, ...Array(15).fill(-1)],
    rateMode: "double",
  });
  p = Model.duplicatePattern(p, "s1", "p1");

  const patterns = p.songs[0].patterns;
  assert.deepEqual(patterns.map((x) => x.id), ["p1", "p3", "p2"]); // 直後に挿入・ID衝突なし
  const copy = patterns[1];
  assert.equal(copy.name, "ベースのコピー");
  assert.equal(copy.rateMode, "double");
  assert.deepEqual(copy.notes, patterns[0].notes);
  assert.notEqual(copy.notes, patterns[0].notes); // 配列は共有しない
});

test("duplicatePattern: 64個上限と存在しないIDを拒否する", () => {
  let p = baseProject();
  assert.throws(() => Model.duplicatePattern(p, "s1", "p999"), /見つかりません/);
  for (let i = 0; i < Model.MAX_PATTERNS_PER_SONG - 1; i++) {
    p = Model.addPattern(p, "s1");
  }
  assert.throws(() => Model.duplicatePattern(p, "s1", "p1"), /64/);
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

// ---- チャンネルグリッド（v5） ----

test("setChannelCell: 途中位置へ配置でき、手前はnullで埋まる", () => {
  let song = Model.createSong("s1");
  song = Model.setChannelCell(song, 0, 2, "p1");
  assert.deepEqual(song.channels[0], [null, null, "p1"]);
});

test("setChannelCell: 末尾のnullは切り詰められる", () => {
  let song = Model.createSong("s1");
  song = Model.setChannelCell(song, 0, 2, "p1");
  song = Model.setChannelCell(song, 0, 2, null); // 空白化 → 全て空 → []
  assert.deepEqual(song.channels[0], []);
});

test("insertChannelCell/removeChannelCell: 挿入はずらし、削除は詰める", () => {
  let song = Model.createSong("s1");
  song = Model.setChannelCell(song, 0, 1, "p1");
  song = Model.insertChannelCell(song, 0, 0, "p2");
  assert.deepEqual(song.channels[0], ["p2", null, "p1"]);
  song = Model.removeChannelCell(song, 0, 1);
  assert.deepEqual(song.channels[0], ["p2", "p1"]);
});

test("removePattern: 配置は空白セルになり後続のタイミングが保たれる", () => {
  let p = baseProject();
  p = Model.addPattern(p, "s1"); // p2
  p = Model.updateSong(p, "s1", { channels: [["p1", "p2"]] });
  p = Model.removePattern(p, "s1", "p1");
  assert.deepEqual(p.songs[0].channels[0], [null, "p2"]);
});

test("resolveChannels: 空白セルは1小節（16列）の休符になる", () => {
  let song = { ...Model.createSong("s1"), bpm: 120 };
  song = { ...song, patterns: [Model.createPattern("p1")] };
  song = Model.setChannelCell(song, 0, 1, "p1"); // [null, "p1"]
  const channels = Model.resolveChannels(song);
  assert.equal(channels[0].length, 2);
  assert.equal(channels[0][0].notes.length, 16);
  assert.ok(channels[0][0].notes.every((n) => n === -1));
  assert.equal(channels[0][0].speed, 15); // bpm120基準
  assert.equal(channels[0][1].id, "p1");
});

test("resolveChannels: 3/4曲では空白セルが12列の休符になる（再生経路も拍子に追従）", () => {
  let song = { ...Model.createSong("s1"), bpm: 120, timeSignature: "3/4" };
  song = { ...song, patterns: [Model.createPattern("p1")] };
  song = Model.setChannelCell(song, 0, 1, "p1"); // [null, "p1"]
  const channels = Model.resolveChannels(song);
  assert.equal(channels[0][0].notes.length, 12);
  assert.ok(channels[0][0].notes.every((n) => n === -1));
});

test("allocateExport: 空白セルは曲ごとの休符サウンド1つに割り当てられる", () => {
  let p = baseProject();
  p = Model.updatePattern(p, "s1", "p1", { notes: [24] });
  let song = p.songs[0];
  song = Model.setChannelCell(song, 0, 1, "p1"); // [null, "p1"]
  song = { ...song, channels: [song.channels[0], [null, null, "p1"]] };
  p = Model.updateSong(p, "s1", { channels: song.channels });
  p = { ...p, export: { musicSlots: ["s1", null, null, null, null, null, null, null] } };

  const result = Model.allocateExport(p);
  assert.equal(result.ok, true);
  // 登場順: 休符(ch0の先頭) → p1
  assert.ok(result.sounds[0].notes.every((n) => n === -1));
  assert.equal(result.sounds[0].notes.length, 16);
  assert.deepEqual(result.sounds[1].notes, [24]);
  // 複数の空白セルが同じ休符index(0)を共有する
  assert.deepEqual(result.musics[0].seqs, [[0, 1], [0, 0, 1]]);
  // 休符は64枠を1つだけ消費する（休符+p1で計2枠）
  assert.equal(result.indexByKey.size, 2);
});

test("allocateExport: 3/4曲では空白セルの休符サウンドが12列になる", () => {
  let p = baseProject();
  p = Model.updatePattern(p, "s1", "p1", { notes: [24] });
  let song = p.songs[0];
  song = Model.setChannelCell(song, 0, 1, "p1"); // [null, "p1"]
  p = Model.updateSong(p, "s1", { channels: song.channels, timeSignature: "3/4" });
  p = { ...p, export: { musicSlots: ["s1", null, null, null, null, null, null, null] } };

  const result = Model.allocateExport(p);
  assert.equal(result.ok, true);
  assert.equal(result.sounds[0].notes.length, 12);
  assert.ok(result.sounds[0].notes.every((n) => n === -1));
  assert.deepEqual(result.sounds[1].notes, [24]);
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
  assert.equal(migrated.formatVersion, 6);
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

test("migrateProject: v2→音価付与・v3→transpose付与・最新はそのまま・未知は拒否", () => {
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
  const migrated2 = Model.migrateProject(v2);
  assert.equal(migrated2.formatVersion, 6);
  assert.deepEqual(migrated2.songs[0].patterns[0].lengths, [1, 1]);
  assert.equal(migrated2.songs[0].transpose, 0); // v4でtransposeが付与される
  assert.equal(migrated2.songs[0].timeSignature, "4/4"); // v6で拍子が付与される
});

// ---- トランスポーズ（v4） ----

test("transposeNote: 半音シフトし休符はそのまま・音域端でクランプ", () => {
  assert.equal(Model.transposeNote(24, 12), 36);
  assert.equal(Model.transposeNote(-1, 12), -1);
  assert.equal(Model.transposeNote(55, 12), 59); // 上端クランプ
  assert.equal(Model.transposeNote(3, -12), 0); // 下端クランプ
});

test("resolvePattern: 曲のtransposeが再生用ノートへ適用される", () => {
  const song = { ...Model.createSong("s1"), transpose: 7 };
  let pat = Model.createPattern("p1");
  pat = Model.placeNote(pat, 0, 24);
  const resolved = Model.resolvePattern(song, pat);
  assert.equal(resolved.notes[0], 31);
});

test("allocateExport: transposeが書き出しへ反映される（元データは非破壊）", () => {
  let p = baseProject();
  p = Model.updatePattern(p, "s1", "p1", Model.placeNote(p.songs[0].patterns[0], 0, 24));
  p = Model.updateSong(p, "s1", { transpose: -12, channels: [["p1"]] });
  p = { ...p, export: { musicSlots: ["s1", null, null, null, null, null, null, null] } };
  const result = Model.allocateExport(p);
  assert.equal(result.sounds[0].notes[0], 12);
  assert.equal(p.songs[0].patterns[0].notes[0], 24); // 内部データは変わらない
});

test("validateSong: 移調範囲（±59）を検査", () => {
  assert.deepEqual(Model.validateSong({ ...Model.createSong("s1"), transpose: 12 }), []);
  assert.equal(Model.validateSong({ ...Model.createSong("s1"), transpose: 60 }).length, 1);
  assert.equal(Model.validateSong({ ...Model.createSong("s1"), transpose: 1.5 }).length, 1);
});

test("transposeClampCount: 音域外へ出るノート数を数える", () => {
  let pat = Model.createPattern("p1");
  pat = Model.placeNote(pat, 0, 55);
  pat = Model.placeNote(pat, 1, 10);
  const song = { ...Model.createSong("s1"), transpose: 10, patterns: [pat] };
  assert.equal(Model.transposeClampCount(song), 1); // 55+10=65のみ範囲外
  assert.equal(Model.transposeClampCount({ ...song, transpose: 0 }), 0);
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

// ---- 範囲コピー/ペースト（Issue #4） ----

test("copyRange: 範囲内で開始するノートだけを拾い、音価は範囲幅で切り詰める", () => {
  const pat = lengthsFixture(); // [24(len3), -, -, 28]
  const clip = Model.copyRange(pat, 0, 3);
  assert.deepEqual(clip.notes, [24, -1, -1, 28]);
  assert.equal(clip.lengths[0], 3); // 範囲内に収まるのでそのまま
});

test("copyRange: 範囲へ左から食い込むノートは、範囲内に残る部分を先頭列のノートとして拾う", () => {
  // clearRangeが同じ境界で切り詰める挙動と対称にし、コピー→カット→貼り直しをロスレスにするため
  const pat = lengthsFixture(); // 24(len3)がcol0〜2を占有
  const clip = Model.copyRange(pat, 1, 3);
  assert.deepEqual(clip.notes, [24, -1, 28]);
  assert.equal(clip.lengths[0], 2); // col1〜2の2列分が範囲内に残る
});

test("copyRange: 範囲末尾でノートの音価が切り詰められる", () => {
  const pat = lengthsFixture(); // 24(len3)がcol0〜2
  const clip = Model.copyRange(pat, 0, 1); // col0〜1のみ選択
  assert.equal(clip.notes[0], 24);
  assert.equal(clip.lengths[0], 2); // 3 → 2へ切り詰め
});

test("copyRange: 全休符範囲は全て-1のclipになる", () => {
  const pat = Model.createPattern("p1");
  const clip = Model.copyRange(pat, 5, 8);
  assert.deepEqual(clip.notes, [-1, -1, -1, -1]);
});

test("clearRange: 範囲内で開始するノートを削除する", () => {
  const pat = lengthsFixture();
  const cleared = Model.clearRange(pat, 0, 3);
  assert.deepEqual(cleared.notes.slice(0, 4), [-1, -1, -1, -1]);
});

test("clearRange: 範囲へ左から食い込むノートは削除せず範囲直前まで短縮する", () => {
  const pat = lengthsFixture(); // 24(len3)がcol0〜2
  const cleared = Model.clearRange(pat, 1, 3);
  assert.equal(cleared.notes[0], 24);
  assert.equal(cleared.lengths[0], 1); // col1手前までに短縮
  assert.equal(cleared.notes[3], -1); // 28は削除される
});

test("copyRange+clearRange+pasteRange: 保持音の途中をカット→同位置へ貼り直すと音価の合計が保たれる（HIGH再発防止）", () => {
  // undoが無いため、ノートの開始列を含まない範囲でもCtrl+X→Ctrl+Vで消えてはいけない
  let pat = Model.createPattern("p1");
  pat = Model.placeNote(pat, 0, 24, 16); // 1曲まるごと1ノート
  const clip = Model.copyRange(pat, 8, 15); // ノートの開始列(col0)を含まない範囲
  const cut = Model.clearRange(pat, 8, 15);
  const pasted = Model.pasteRange(cut, 8, clip);
  const totalCovered = pasted.notes.reduce(
    (sum, n, i) => sum + (n >= 0 ? pasted.lengths[i] : 0),
    0
  );
  assert.equal(totalCovered, 16); // 分割されても音価の合計は元と同じ
  assert.equal(pasted.notes[0], 24);
  assert.equal(pasted.notes[8], 24);
});

test("clearRange: 範囲の両端をまたぐノートは、範囲外に残る部分（前後とも）を保つ", () => {
  // 選択されていないcol5〜7を破壊しない（undoが無いための安全性要件）
  let pat = Model.createPattern("p1");
  pat = Model.placeNote(pat, 0, 24, 8); // col0〜7を占有
  const cleared = Model.clearRange(pat, 2, 4);
  assert.equal(cleared.notes[0], 24);
  assert.equal(cleared.lengths[0], 2); // col2手前までに短縮
  assert.equal(cleared.notes[5], 24); // col5から新しいノートとして残る
  assert.equal(cleared.lengths[5], 3); // col5〜7の3列分
});

test("clearRange: 範囲内で開始し範囲外まで伸びるノートは、はみ出した尾を保つ", () => {
  let pat = Model.createPattern("p1");
  pat = Model.placeNote(pat, 6, 24, 10); // col6〜15を占有
  const cleared = Model.clearRange(pat, 6, 9);
  assert.equal(cleared.notes[6], -1); // 範囲内の開始部分は削除される
  assert.equal(cleared.notes[10], 24); // 範囲外の尾はcol10から残る
  assert.equal(cleared.lengths[10], 6); // col10〜15の6列分
});

test("clearRange: パターン末尾ぴったりで終わる範囲では尾を作らない", () => {
  const pat = lengthsFixture(); // 24(len3)がcol0〜2、パターン長16
  const cleared = Model.clearRange(pat, 0, 15); // 末尾まで選択
  assert.deepEqual(cleared.notes, Array(16).fill(-1));
});

test("copyRange+clearRange+pasteRange: 範囲の両端をまたぐノートをカット→同位置へ貼り直すと音価の合計が保たれる（HIGH再発防止）", () => {
  let pat = Model.createPattern("p1");
  pat = Model.placeNote(pat, 0, 24, 16); // 1曲まるごと1ノート
  const clip = Model.copyRange(pat, 4, 7); // ノートの開始列(col0)も末尾も含まない範囲
  const cut = Model.clearRange(pat, 4, 7);
  const pasted = Model.pasteRange(cut, 4, clip);
  const totalCovered = pasted.notes.reduce(
    (sum, n, i) => sum + (n >= 0 ? pasted.lengths[i] : 0),
    0
  );
  assert.equal(totalCovered, 16); // 分割されても音価の合計は元と同じ
});

test("clearRange+pasteRange: 保持音が分割されても、ノート個別編集したtoneが引き継がれる（HIGH再発防止）", () => {
  // expandPatternはノートの開始列の値をスパン全体へ広げるため、分割で新しい開始列が
  // できたときに元の音色を引き継がないと、cut→同位置貼り直しで鳴る音が変わってしまう
  let pat = Model.createPattern("p1");
  pat = Model.placeNote(pat, 0, 24, 8); // col0〜7を占有
  pat = Model.expandProperty(pat, "tones");
  pat = { ...pat, tones: pat.tones.map((v, i) => (i === 0 ? 3 : v)) };
  const clip = Model.copyRange(pat, 2, 4);
  const cut = Model.clearRange(pat, 2, 4);
  const pasted = Model.pasteRange(cut, 2, clip);
  const expanded = Model.expandPattern(pasted);
  assert.deepEqual(expanded.tones.slice(0, 8), Array(8).fill(3));
});

test("pasteRange: 貼り付け先の既存ノートを上書きする", () => {
  let pat = lengthsFixture();
  const clip = { notes: [36, -1], lengths: [2, 1] };
  pat = Model.pasteRange(pat, 3, clip); // col3の28を上書き
  assert.equal(pat.notes[3], 36);
  assert.equal(pat.lengths[3], 2);
});

test("pasteRange: 休符を含むclipでも例外にならない", () => {
  const pat = Model.createPattern("p1");
  const clip = { notes: [-1, 24, -1], lengths: [1, 1, 1] };
  const pasted = Model.pasteRange(pat, 0, clip);
  assert.equal(pasted.notes[0], -1);
  assert.equal(pasted.notes[1], 24);
  assert.equal(pasted.notes[2], -1);
});

test("pasteRange: パターン末尾を超える分は切り詰め、パターン長は変わらない", () => {
  const pat = Model.createPattern("p1"); // 長さ16
  const clip = { notes: [24, 26, 28], lengths: [1, 1, 1] };
  const pasted = Model.pasteRange(pat, 15, clip); // col15の1列しか残っていない
  assert.equal(pasted.notes.length, 16);
  assert.equal(pasted.notes[15], 24);
});

test("pasteRange: 空clip・範囲外colはパターンを変えない", () => {
  const pat = lengthsFixture();
  assert.deepEqual(Model.pasteRange(pat, 0, null), pat);
  assert.deepEqual(Model.pasteRange(pat, 0, { notes: [], lengths: [] }), pat);
  assert.deepEqual(Model.pasteRange(pat, 99, { notes: [24], lengths: [1] }), pat);
});

test("pasteRange: 同じ位置への貼り直しで音価が選択幅に切り詰められる", () => {
  let pat = lengthsFixture(); // 24(len3)
  const clip = Model.copyRange(pat, 0, 1); // 幅2で切り詰めたclip
  pat = Model.pasteRange(pat, 0, clip);
  assert.equal(pat.lengths[0], 2); // 3 → 2へ縮む
});

test("copyRange/clearRange/pasteRange: 元パターンを破壊しない", () => {
  const pat = lengthsFixture();
  const before = JSON.parse(JSON.stringify(pat));
  Model.copyRange(pat, 0, 3);
  Model.clearRange(pat, 0, 3);
  Model.pasteRange(pat, 0, { notes: [24], lengths: [1] });
  assert.deepEqual(pat.notes, before.notes);
  assert.deepEqual(pat.lengths, before.lengths);
});

test("copyRange/clearRange/pasteRange: 結果はvalidatePatternを通る", () => {
  const pat = lengthsFixture();
  const clip = Model.copyRange(pat, 0, 3);
  const cleared = Model.clearRange(pat, 0, 3);
  const pasted = Model.pasteRange(pat, 0, clip);
  for (const p of [cleared, pasted]) {
    assert.deepEqual(Model.validatePattern(p), []);
  }
});

// ---- transposeRange（選択範囲の移調） ----

test("transposeRange: 範囲内で開始するノートが半音上がる（音価・tones等は不変）", () => {
  const pat = lengthsFixture(); // notes[3]=28, len1
  const result = Model.transposeRange(pat, 3, 3, 1);
  assert.equal(result.notes[3], 29);
  assert.deepEqual(result.lengths, pat.lengths);
  assert.deepEqual(result.tones, pat.tones);
  assert.deepEqual(result.volumes, pat.volumes);
  assert.deepEqual(result.effects, pat.effects);
});

test("transposeRange: 範囲へ左から食い込むノートも分割されず開始列ごと移調される", () => {
  const pat = lengthsFixture(); // notes[0]=24, len3（col0〜2を覆う）
  const result = Model.transposeRange(pat, 1, 2, 1);
  assert.equal(result.notes[0], 25);
  assert.equal(result.lengths[0], 3); // 分割されない
  assert.equal(result.notes[1], -1);
  assert.equal(result.notes[2], -1);
});

test("transposeRange: 範囲から右へ突き抜けるノートも丸ごと移調され音価が変わらない", () => {
  let pat = Model.createPattern("p1");
  pat = Model.placeNote(pat, 2, 30, 4); // col2〜5を覆う
  const result = Model.transposeRange(pat, 2, 3, 1); // 範囲末尾はcol3
  assert.equal(result.notes[2], 31);
  assert.equal(result.lengths[2], 4); // 突き抜け分も保たれる
});

test("transposeRange: 範囲内の1音でも上端(NOTE_MAX)を超えるなら全体を変更せず返す", () => {
  let pat = Model.createPattern("p1");
  pat = Model.placeNote(pat, 0, 58, 1);
  pat = Model.placeNote(pat, 1, 20, 1);
  const result = Model.transposeRange(pat, 0, 1, 2); // 58+2=60は範囲外
  assert.deepEqual(result, pat);
});

test("transposeRange: 範囲内の1音でも下端(0)を割るなら全体を変更せず返す", () => {
  let pat = Model.createPattern("p1");
  pat = Model.placeNote(pat, 0, 0, 1);
  pat = Model.placeNote(pat, 1, 20, 1);
  const result = Model.transposeRange(pat, 0, 1, -1);
  assert.deepEqual(result, pat);
});

test("transposeRange: semitones=0はno-op", () => {
  const pat = lengthsFixture();
  assert.equal(Model.transposeRange(pat, 0, 3, 0), pat);
});

test("transposeRange: 全休符範囲はno-op", () => {
  const pat = lengthsFixture();
  assert.equal(Model.transposeRange(pat, 10, 12, 1), pat);
});

test("transposeRange: 範囲内で同じノートに複数列が重なっていても二重に移調されない", () => {
  const pat = lengthsFixture(); // notes[0]=24, len3（col0〜2を覆う）
  const result = Model.transposeRange(pat, 0, 2, 1);
  assert.equal(result.notes[0], 25);
});

test("transposeRange: 上げてから同じ範囲を下げると元パターンに戻る（可逆性）", () => {
  const pat = lengthsFixture();
  const up = Model.transposeRange(pat, 0, 3, 1);
  const down = Model.transposeRange(up, 0, 3, -1);
  assert.deepEqual(down, pat);
});

test("transposeRange: 元パターンを破壊しない", () => {
  const pat = lengthsFixture();
  const before = JSON.parse(JSON.stringify(pat));
  Model.transposeRange(pat, 0, 3, 1);
  assert.deepEqual(pat.notes, before.notes);
  assert.deepEqual(pat.lengths, before.lengths);
});

test("transposeRange: 結果はvalidatePatternを通る", () => {
  const pat = lengthsFixture();
  const result = Model.transposeRange(pat, 0, 3, 1);
  assert.deepEqual(Model.validatePattern(result), []);
});

test("transposeRange: 幅1(start===end)でも保持音の途中を指していれば開始列のノートが移調される", () => {
  const pat = lengthsFixture(); // notes[0]=24, len3（col1は保持中）
  const result = Model.transposeRange(pat, 1, 1, 1);
  assert.equal(result.notes[0], 25);
});

test("duplicatePatternInChannel: 同じパターンをチャンネルの右隣へ挿入する", () => {
  let p = baseProject();
  p = Model.addPattern(p, "s1"); // p2
  p = Model.updateSong(p, "s1", { channels: [["p1", "p2"]] });

  p = Model.duplicatePatternInChannel(p, "s1", 0, 0);

  const patterns = p.songs[0].patterns;
  assert.deepEqual(patterns.map((x) => x.id), ["p1", "p2"]); // パターンは新規作成されない
  assert.deepEqual(p.songs[0].channels[0], ["p1", "p1", "p2"]); // 同じpatternIdがidx+1に挿入される
});

test("duplicatePatternInChannel: 挿入位置より後ろのセルは1つ後ろへずれる", () => {
  let p = baseProject();
  p = Model.addPattern(p, "s1"); // p2
  p = Model.addPattern(p, "s1"); // p3
  p = Model.updateSong(p, "s1", { channels: [["p1", null, "p2", "p3"]] });

  p = Model.duplicatePatternInChannel(p, "s1", 0, 0);

  const patterns = p.songs[0].patterns;
  assert.equal(patterns.length, 3); // パターン数は変わらない
  assert.deepEqual(p.songs[0].channels[0], ["p1", "p1", null, "p2", "p3"]);
});

test("duplicatePatternInChannel: 空白セルに対する呼び出しを拒否する", () => {
  let p = baseProject();
  p = Model.updateSong(p, "s1", { channels: [[null, "p1"]] });
  assert.throws(() => Model.duplicatePatternInChannel(p, "s1", 0, 0), /空白/);
});

test("duplicatePatternInChannel: 同じパターンを複数回複製できる", () => {
  let p = baseProject();
  p = Model.updateSong(p, "s1", { channels: [["p1"]] });

  p = Model.duplicatePatternInChannel(p, "s1", 0, 0);
  p = Model.duplicatePatternInChannel(p, "s1", 0, 0);

  assert.deepEqual(p.songs[0].channels[0], ["p1", "p1", "p1"]);
  assert.equal(p.songs[0].patterns.length, 1); // パターンは新規作成されない
});
