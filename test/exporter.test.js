"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const Exporter = require("../js/exporter.js");

test("crc32: 既知ベクタ '123456789' → 0xCBF43926", () => {
  const data = new TextEncoder().encode("123456789");
  assert.equal(Exporter.crc32(data), 0xcbf43926);
});

test("generateToml: format_version・空images/tilemaps・sounds/musicsを出力（§6.1）", () => {
  const sounds = [
    { notes: [24, 26, 28, -1], tones: [1], volumes: [6], effects: [0], speed: 20 },
    { notes: [], tones: [], volumes: [], effects: [], speed: 30 },
  ];
  const musics = [{ seqs: [[0, 1], [0]] }, { seqs: [] }];
  const toml = Exporter.generateToml({ sounds, musics });

  assert.match(toml, /^format_version = 1\n/);
  assert.match(toml, /\nimages = \[\]\n/);
  assert.match(toml, /\ntilemaps = \[\]\n/);
  assert.match(toml, /\[\[sounds\]\]\nnotes = \[24, 26, 28, -1\]\ntones = \[1\]\nvolumes = \[6\]\neffects = \[0\]\nspeed = 20\n/);
  assert.match(toml, /\[\[sounds\]\]\nnotes = \[\]\ntones = \[\]\nvolumes = \[\]\neffects = \[\]\nspeed = 30\n/);
  assert.match(toml, /\[\[musics\]\]\nseqs = \[\[0, 1\], \[0\]\]\n/);
  assert.match(toml, /\[\[musics\]\]\nseqs = \[\]\n/);
});

test("generateToml: 末尾の空チャンネルは省略される（§6.1）", () => {
  const musics = [{ seqs: [[0], [], []] }];
  const toml = Exporter.generateToml({ sounds: [], musics });
  assert.match(toml, /\[\[musics\]\]\nseqs = \[\[0\]\]\n/);
});

test("generateToml: 中間の空チャンネルは保持される", () => {
  const musics = [{ seqs: [[], [0]] }];
  const toml = Exporter.generateToml({ sounds: [], musics });
  assert.match(toml, /\[\[musics\]\]\nseqs = \[\[\], \[0\]\]\n/);
});

test("buildZip: STORED形式のZIP構造（ヘッダシグネチャ・CRC・サイズ）", () => {
  const content = new TextEncoder().encode("hello pyxel");
  const zip = Exporter.buildZip([{ name: "pyxel_resource.toml", data: content }]);
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);

  // ローカルファイルヘッダ
  assert.equal(view.getUint32(0, true), 0x04034b50);
  assert.equal(view.getUint16(8, true), 0); // method = STORED
  assert.equal(view.getUint32(14, true) >>> 0, Exporter.crc32(content));
  assert.equal(view.getUint32(18, true), content.length); // compressed size
  assert.equal(view.getUint32(22, true), content.length); // uncompressed size
  assert.equal(view.getUint16(26, true), "pyxel_resource.toml".length);

  // 終端レコード（EOCD）
  const eocd = zip.byteLength - 22;
  assert.equal(view.getUint32(eocd, true), 0x06054b50);
  assert.equal(view.getUint16(eocd + 10, true), 1); // 総エントリ数

  // セントラルディレクトリ
  const cdOffset = view.getUint32(eocd + 16, true);
  assert.equal(view.getUint32(cdOffset, true), 0x02014b50);
});

test("buildPyxres: TOML 1エントリ入りのZIPバイナリを返す", () => {
  const sounds = [{ notes: [0], tones: [0], volumes: [7], effects: [0], speed: 30 }];
  const musics = [{ seqs: [[0]] }];
  const bin = Exporter.buildPyxres({ sounds, musics });
  const view = new DataView(bin.buffer, bin.byteOffset, bin.byteLength);
  assert.equal(view.getUint32(0, true), 0x04034b50);
  const name = new TextDecoder().decode(bin.slice(30, 30 + 19));
  assert.equal(name, "pyxel_resource.toml");
});
