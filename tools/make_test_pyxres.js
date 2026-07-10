"use strict";
// Pyxel実機検証用の2曲入りpyxresを生成する（設計書§9 フェーズ1完了基準）
// 使い方: node tools/make_test_pyxres.js <出力パス>
const fs = require("node:fs");
const path = require("node:path");
const Model = require(path.join(__dirname, "../js/model.js"));
const Exporter = require(path.join(__dirname, "../js/exporter.js"));

const outPath = process.argv[2];
if (!outPath) {
  console.error("使い方: node tools/make_test_pyxres.js <出力パス>");
  process.exit(1);
}

let project = Model.createProject();
project = Model.addSong(project); // s1
project = Model.addSong(project); // s2

// s1: bpm90（speed20相当）、3パターン（p3は2倍再生）
project = Model.addPattern(project, "s1"); // s1/p1
project = Model.addPattern(project, "s1"); // s1/p2
project = Model.addPattern(project, "s1"); // s1/p3
project = Model.updatePattern(project, "s1", "p1", {
  notes: [24, -1, 26, 28], lengths: [2, 1, 1, 1], tones: [1], volumes: [6], effects: [0],
}); // 24はlen2 → 書き出しで [24, 24, 26, 28] に分割される
project = Model.updatePattern(project, "s1", "p2", {
  notes: [12, 12, -1, 12], tones: [0], volumes: [7], effects: [3],
});
project = Model.updatePattern(project, "s1", "p3", {
  notes: [33, 35], tones: [2], volumes: [5], effects: [2], rateMode: "double",
});
project = Model.updateSong(project, "s1", {
  bpm: 90,
  channels: [["p1", "p2", "p1"], [null, "p3"]], // p1は曲内共有。ch1は1小節の空白から開始
});

// s2: bpm60（speed30相当）、1パターン（1/2倍再生）、移調+12
project = Model.addPattern(project, "s2"); // s2/p1
project = Model.updatePattern(project, "s2", "p1", {
  notes: [36, 38], tones: [0], volumes: [7], effects: [0], rateMode: "half",
});
project = Model.updateSong(project, "s2", { bpm: 60, transpose: 12, channels: [["p1"]] });

project = {
  ...project,
  export: { musicSlots: ["s1", "s2", null, null, null, null, null, null] },
};

const alloc = Model.allocateExport(project);
if (!alloc.ok) {
  console.error("割り当てに失敗:", alloc);
  process.exit(1);
}
fs.writeFileSync(outPath, Exporter.buildPyxres(alloc));
console.log(`生成完了: ${outPath}（2曲・曲内共有・rateModeあり）`);
