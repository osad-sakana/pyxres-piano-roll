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
project = Model.addPattern(project); // p1
project = Model.addPattern(project); // p2
project = Model.addPattern(project); // p3
project = Model.updatePattern(project, "p1", {
  notes: [24, -1, 26, 28], tones: [1], volumes: [6], effects: [0], speed: 20,
});
project = Model.updatePattern(project, "p2", {
  notes: [12, 12, -1, 12], tones: [0], volumes: [7], effects: [3], speed: 20,
});
project = Model.updatePattern(project, "p3", {
  notes: [33, 35], tones: [2], volumes: [5], effects: [2], speed: 40,
});
project = Model.addSong(project); // s1
project = Model.addSong(project); // s2
project = Model.updateSong(project, "s1", { channels: [["p1", "p2", "p1"], ["p3"]] });
project = Model.updateSong(project, "s2", { channels: [["p2"], ["p1"]] }); // p1/p2を共有
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
console.log(`生成完了: ${outPath}（2曲・パターン共有あり）`);
