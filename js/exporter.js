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

  // ---- 標準MIDI(SMF Type 1) ----
  // MIDI tick = Pyxel tick × scale。四分音符(4列)がちょうど division tick になるよう
  // division を 4×baseSpeed×scale（480以上）に取り、実機と同じ速さを丸め誤差なしで保つ。
  function vlq(value) {
    const bytes = [value & 0x7f];
    for (let v = value >>> 7; v > 0; v >>>= 7) bytes.unshift((v & 0x7f) | 0x80);
    return bytes;
  }

  function trackChunk(events) {
    // 同tickではnote-off(order 0)をnote-on(order 1)より先に出す
    const sorted = [...events].sort((a, b) => a.tick - b.tick || a.order - b.order);
    const body = [];
    let last = 0;
    for (const ev of sorted) {
      body.push(...vlq(ev.tick - last), ...ev.bytes);
      last = ev.tick;
    }
    body.push(...vlq(0), 0xff, 0x2f, 0x00);
    const chunk = new Uint8Array(8 + body.length);
    chunk.set([0x4d, 0x54, 0x72, 0x6b]); // "MTrk"
    new DataView(chunk.buffer).setUint32(4, body.length);
    chunk.set(body, 8);
    return chunk;
  }

  function midiNoteNumber(note, tone) {
    const n = note + (tone === 3 ? 60 : 36); // Pyxel: 波形=36 / ノイズ=60
    return Math.min(127, Math.max(0, n));
  }

  function buildMidi({ baseSpeed, beatsPerBar, channels }) {
    const scale = Math.ceil(480 / (4 * baseSpeed));
    const division = 4 * baseSpeed * scale;
    const usPerQuarter = Math.round((baseSpeed * 1000000) / 30);
    const denomPower = 2; // 分母4
    const conductor = [
      {
        tick: 0,
        order: 0,
        bytes: [0xff, 0x51, 0x03, (usPerQuarter >> 16) & 0xff, (usPerQuarter >> 8) & 0xff, usPerQuarter & 0xff],
      },
      { tick: 0, order: 0, bytes: [0xff, 0x58, 0x04, beatsPerBar, denomPower, 24, 8] },
    ];
    const tracks = [trackChunk(conductor)];
    channels.forEach((notes, ch) => {
      const events = [];
      for (const n of notes) {
        const key = midiNoteNumber(n.note, n.tone);
        const velocity = Math.max(1, Math.round((n.volume / 7) * 127));
        events.push({ tick: n.tick * scale, order: 1, bytes: [0x90 | ch, key, velocity] });
        events.push({ tick: (n.tick + n.duration) * scale, order: 0, bytes: [0x80 | ch, key, 0] });
      }
      tracks.push(trackChunk(events));
    });
    const header = new Uint8Array(14);
    header.set([0x4d, 0x54, 0x68, 0x64]); // "MThd"
    const dv = new DataView(header.buffer);
    dv.setUint32(4, 6);
    dv.setUint16(8, 1);
    dv.setUint16(10, tracks.length);
    dv.setUint16(12, division);
    const out = new Uint8Array(tracks.reduce((a, t) => a + t.length, header.length));
    out.set(header);
    let pos = header.length;
    for (const t of tracks) {
      out.set(t, pos);
      pos += t.length;
    }
    return out;
  }

  return { crc32, generateToml, buildZip, buildPyxres, buildMidi };
})();

if (typeof module !== "undefined") module.exports = Exporter;
