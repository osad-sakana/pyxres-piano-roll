"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const AudioEngine = require("../js/audio.js");

const SAMPLE_RATE = 22050;
const SPT = SAMPLE_RATE / 120; // samples per tick = 183.75

function pattern(overrides) {
  return {
    id: "p1",
    name: "",
    notes: [24],
    tones: [1],
    volumes: [7],
    effects: [0],
    speed: 30,
    ...overrides,
  };
}

test("renderPattern: 出力長 = notes.length × speed × 183.75 サンプル（§5.1 tick換算）", () => {
  const buf = AudioEngine.renderPattern(pattern({ notes: [24, 26, 28, -1] }));
  assert.equal(buf.length, Math.round(4 * 30 * SPT));
});

test("renderPattern: 全休符は無音", () => {
  const buf = AudioEngine.renderPattern(pattern({ notes: [-1, -1] }));
  assert.ok(buf.every((v) => v === 0));
});

test("renderPattern: 発音時は非ゼロかつ振幅がゲイン積を超えない", () => {
  const buf = AudioEngine.renderPattern(pattern({ notes: [33], tones: [1] }));
  const peak = buf.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
  assert.ok(peak > 0);
  // 矩形波: toneGain 0.3 × level 1.0 × channelGain 0.125 = 0.0375
  assert.ok(peak <= 0.3 * 0.125 + 1e-6, `peak=${peak}`);
});

test("renderPattern: volume=0は無音（level = volume/7）", () => {
  const buf = AudioEngine.renderPattern(pattern({ volumes: [0] }));
  assert.ok(buf.every((v) => v === 0));
});

test("renderPattern: FadeOut(3)は末尾が先頭より小さい", () => {
  const buf = AudioEngine.renderPattern(pattern({ notes: [24], effects: [3], speed: 60 }));
  const head = peakOf(buf.subarray(0, 500));
  const tail = peakOf(buf.subarray(buf.length - 500));
  assert.ok(tail < head * 0.2, `head=${head} tail=${tail}`);
});

test("renderPattern: Half(4)は前半保持・後半フェード", () => {
  const buf = AudioEngine.renderPattern(pattern({ notes: [24], effects: [4], speed: 60 }));
  const mid = peakOf(buf.subarray(Math.floor(buf.length * 0.4), Math.floor(buf.length * 0.5)));
  const tail = peakOf(buf.subarray(buf.length - 300));
  assert.ok(mid > 0.03, `mid=${mid}`);
  assert.ok(tail < mid * 0.2, `tail=${tail}`);
});

test("renderSong: チャンネル合算で最長チャンネルの長さになる", () => {
  const p1 = pattern({ id: "p1", notes: [24, 26] });
  const p2 = pattern({ id: "p2", notes: [12] });
  const song = { id: "s1", name: "", channels: [["p1"], ["p2"]] };
  const buf = AudioEngine.renderSong(song, [p1, p2]);
  assert.equal(buf.length, Math.round(2 * 30 * SPT));
});

test("lfsrStep: NES APU長周期LFSR（tap bit1）の基本動作", () => {
  // seed 0x7001: bit0=1, bit1=0 → feedback 1 が bit14 に入る
  const next = AudioEngine._lfsrStep(0x7001);
  assert.equal(next, (0x7001 >> 1) | (1 << 14));
});

test("noteToMidi: 通常波形は+36、ノイズは+60（§5.1）", () => {
  assert.equal(AudioEngine._noteToMidi(33, 1), 69); // A4 → midi 69 (440Hz)
  assert.equal(AudioEngine._noteToMidi(9, 3), 69); // ノイズは+60
});

function peakOf(arr) {
  let m = 0;
  for (const v of arr) m = Math.max(m, Math.abs(v));
  return m;
}
