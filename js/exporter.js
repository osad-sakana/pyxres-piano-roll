"use strict";
// Exporter層: TOML生成 + 無圧縮ZIP梱包（設計書§6）
const Exporter = (() => {
  // CRC-32（テーブル方式）
  const CRC_TABLE = (() => {
    const table = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let k = 0; k < 8; k++) {
        c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      }
      table[i] = c >>> 0;
    }
    return table;
  })();

  function crc32(data) {
    let crc = 0xffffffff;
    for (let i = 0; i < data.length; i++) {
      crc = CRC_TABLE[(crc ^ data[i]) & 0xff] ^ (crc >>> 8);
    }
    return (crc ^ 0xffffffff) >>> 0;
  }

  function intArray(values) {
    return `[${values.join(", ")}]`;
  }

  function seqsToml(seqs) {
    // 末尾の空チャンネルは省略（pyxres-format.mdの省略規則）
    const trimmed = [...seqs];
    while (trimmed.length > 0 && trimmed[trimmed.length - 1].length === 0) {
      trimmed.pop();
    }
    return `[${trimmed.map(intArray).join(", ")}]`;
  }

  // 文字列テンプレートによるTOML直接生成（§6.1）
  function generateToml({ sounds, musics }) {
    const lines = ["format_version = 1", "", "images = []", "tilemaps = []", ""];
    for (const s of sounds) {
      lines.push(
        "[[sounds]]",
        `notes = ${intArray(s.notes)}`,
        `tones = ${intArray(s.tones)}`,
        `volumes = ${intArray(s.volumes)}`,
        `effects = ${intArray(s.effects)}`,
        `speed = ${s.speed}`,
        ""
      );
    }
    for (const m of musics) {
      lines.push("[[musics]]", `seqs = ${seqsToml(m.seqs)}`, "");
    }
    return lines.join("\n");
  }

  function dosDateTime(date) {
    const time = (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1);
    const day =
      ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
    return { time, day };
  }

  // 無圧縮（STORED）ZIPの自前生成（§6.2）
  function buildZip(entries, now = new Date()) {
    const encoder = new TextEncoder();
    const { time, day } = dosDateTime(now);
    const localParts = [];
    const centralParts = [];
    let offset = 0;

    for (const { name, data } of entries) {
      const nameBytes = encoder.encode(name);
      const crc = crc32(data);

      const local = new Uint8Array(30 + nameBytes.length + data.length);
      const lv = new DataView(local.buffer);
      lv.setUint32(0, 0x04034b50, true); // シグネチャ
      lv.setUint16(4, 20, true); // 展開に必要なバージョン
      lv.setUint16(6, 0, true); // フラグ
      lv.setUint16(8, 0, true); // method 0 = STORED
      lv.setUint16(10, time, true);
      lv.setUint16(12, day, true);
      lv.setUint32(14, crc, true);
      lv.setUint32(18, data.length, true); // 圧縮後サイズ（無圧縮なので同値）
      lv.setUint32(22, data.length, true); // 元サイズ
      lv.setUint16(26, nameBytes.length, true);
      lv.setUint16(28, 0, true); // 拡張フィールド長
      local.set(nameBytes, 30);
      local.set(data, 30 + nameBytes.length);
      localParts.push(local);

      const central = new Uint8Array(46 + nameBytes.length);
      const cv = new DataView(central.buffer);
      cv.setUint32(0, 0x02014b50, true);
      cv.setUint16(4, 20, true); // 作成バージョン
      cv.setUint16(6, 20, true); // 展開に必要なバージョン
      cv.setUint16(8, 0, true);
      cv.setUint16(10, 0, true); // STORED
      cv.setUint16(12, time, true);
      cv.setUint16(14, day, true);
      cv.setUint32(16, crc, true);
      cv.setUint32(20, data.length, true);
      cv.setUint32(24, data.length, true);
      cv.setUint16(28, nameBytes.length, true);
      cv.setUint32(42, offset, true); // ローカルヘッダのオフセット
      central.set(nameBytes, 46);
      centralParts.push(central);

      offset += local.length;
    }

    const centralSize = centralParts.reduce((acc, p) => acc + p.length, 0);
    const eocd = new Uint8Array(22);
    const ev = new DataView(eocd.buffer);
    ev.setUint32(0, 0x06054b50, true);
    ev.setUint16(8, entries.length, true); // このディスクのエントリ数
    ev.setUint16(10, entries.length, true); // 総エントリ数
    ev.setUint32(12, centralSize, true);
    ev.setUint32(16, offset, true); // セントラルディレクトリの開始位置

    const total = offset + centralSize + 22;
    const zip = new Uint8Array(total);
    let pos = 0;
    for (const part of [...localParts, ...centralParts, eocd]) {
      zip.set(part, pos);
      pos += part.length;
    }
    return zip;
  }

  function buildPyxres(allocation) {
    const toml = generateToml(allocation);
    const data = new TextEncoder().encode(toml);
    return buildZip([{ name: "pyxel_resource.toml", data }]);
  }

  return { crc32, generateToml, buildZip, buildPyxres };
})();

if (typeof module !== "undefined") module.exports = Exporter;
