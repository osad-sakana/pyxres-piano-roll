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

// ---- buildMidi ----
function readVlq(bytes, pos) {
  let value = 0;
  let b;
  do {
    b = bytes[pos++];
    value = (value << 7) | (b & 0x7f);
  } while (b & 0x80);
  return [value, pos];
}

// MTrkチャンクを [{tick, bytes}] へ分解する（メタ/チャンネルイベントのみ）
function parseMidi(bytes) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const header = {
    magic: String.fromCharCode(...bytes.slice(0, 4)),
    format: dv.getUint16(8),
    tracks: dv.getUint16(10),
    division: dv.getUint16(12),
  };
  const tracks = [];
  let pos = 14;
  while (pos < bytes.length) {
    assert.equal(String.fromCharCode(...bytes.slice(pos, pos + 4)), "MTrk");
    const len = dv.getUint32(pos + 4);
    let p = pos + 8;
    const end = p + len;
    let tick = 0;
    const events = [];
    while (p < end) {
      let delta;
      [delta, p] = readVlq(bytes, p);
      tick += delta;
      const status = bytes[p];
      if (status === 0xff) {
        const type = bytes[p + 1];
        let size;
        let q;
        [size, q] = readVlq(bytes, p + 2);
        events.push({ tick, meta: type, data: Array.from(bytes.slice(q, q + size)) });
        p = q + size;
      } else {
        events.push({ tick, status, note: bytes[p + 1], velocity: bytes[p + 2] });
        p += 3;
      }
    }
    tracks.push(events);
    pos = end;
  }
  return { header, tracks };
}

test("buildMidi: SMF Type1ヘッダ・テンポ・拍子・トラック数", () => {
  const bytes = Exporter.buildMidi({ baseSpeed: 15, beatsPerBar: 3, channels: [[], []] });
  const { header, tracks } = parseMidi(bytes);
  assert.deepEqual(
    [header.magic, header.format, header.tracks],
    ["MThd", 1, 3]
  );
  // 1tick = 1/120秒、四分音符 = 60tick(分割なし) → division は480以上の整数倍
  assert.equal(header.division, 480);
  const tempo = tracks[0].find((e) => e.meta === 0x51).data;
  const usPerQuarter = (tempo[0] << 16) | (tempo[1] << 8) | tempo[2];
  assert.equal(usPerQuarter, 500000); // 120BPM
  assert.deepEqual(tracks[0].find((e) => e.meta === 0x58).data.slice(0, 2), [3, 2]);
  assert.ok(tracks.every((t) => t[t.length - 1].meta === 0x2f));
});

test("buildMidi: ノートのon/off位置・音番号・velocity(0〜7→1〜127)", () => {
  const bytes = Exporter.buildMidi({
    baseSpeed: 15,
    beatsPerBar: 4,
    channels: [
      [
        { tick: 0, duration: 60, note: 0, tone: 0, volume: 7 },
        { tick: 60, duration: 15, note: 3, tone: 3, volume: 1 }, // ノイズは+60
      ],
    ],
  });
  const { tracks } = parseMidi(bytes);
  const ev = tracks[1].filter((e) => e.status !== undefined);
  assert.deepEqual(
    ev.map((e) => [e.tick, e.status & 0xf0, e.note]),
    [[0, 0x90, 36], [480, 0x80, 36], [480, 0x90, 63], [600, 0x80, 63]]
  );
  assert.equal(ev[0].velocity, 127);
  assert.equal(ev[2].velocity, 18);
});

test("buildMidi: 長い待ち時間もVLQで正しく符号化される", () => {
  const bytes = Exporter.buildMidi({
    baseSpeed: 15,
    beatsPerBar: 4,
    channels: [[{ tick: 100000, duration: 15, note: 0, tone: 0, volume: 7 }]],
  });
  const { tracks } = parseMidi(bytes);
  assert.equal(tracks[1][0].tick, 100000 * 8);
});
