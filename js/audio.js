"use strict";
// AudioEngine層: Pyxel準拠のオフラインレンダラ + Web Audio再生（設計書§5）
// レンダラは純関数（AudioBufferSourceNode方式、§5.2）。
const AudioEngine = (() => {
  const SAMPLE_RATE = 22050; // settings.rs AUDIO_SAMPLE_RATE
  const TICKS_PER_SECOND = 120; // settings.rs SOUND_TICKS_PER_SECOND
  const SPT = SAMPLE_RATE / TICKS_PER_SECOND; // samples per tick = 183.75
  const CHANNEL_GAIN = 0.125; // settings.rs DEFAULT_CHANNEL_GAIN
  const A4_FREQUENCY = 440;
  const CROSSFADE_SAMPLES = Math.round(SAMPLE_RATE / 1000); // ノート境界の約1msクロスフェード（§5.3）
  const VIBRATO_PERIOD_TICKS = 20; // 6Hz
  const VIBRATO_DEPTH_SEMITONES = 0.25; // ±25セント
  const NOISE_SEED = 0x7001;

  // 32ステップ・4bit三角波テーブル（settings.rs DEFAULT_TONE_TRIANGLE）
  const TRIANGLE_TABLE = Array.from({ length: 32 }, (_, i) => (i < 16 ? i : 31 - i));

  const TONE_GAINS = [1.0, 0.3, 0.3, 0.6]; // 三角・矩形・パルス・ノイズ

  function noteToMidi(note, tone) {
    // sound.rs base_note: Wavetable=36 / Noise=60
    return note + (tone === 3 ? 60 : 36);
  }

  function midiToFreq(midi) {
    return A4_FREQUENCY * Math.pow(2, (midi - 69) / 12);
  }

  function lfsrStep(reg) {
    // NES APU長周期モード: tap bit 1
    const feedback = (reg & 1) ^ ((reg >> 1) & 1);
    return (reg >> 1) | (feedback << 14);
  }

  function triangleLfo(phase) {
    // 0→+1→-1→0 の三角LFO（phaseは周期単位）
    const x = phase - Math.floor(phase);
    if (x < 0.25) return 4 * x;
    if (x < 0.75) return 2 - 4 * x;
    return 4 * x - 4;
  }

  // エフェクトのエンベロープ（sound.rs EnvelopeSet相当）
  function envelopeAt(effect, tick, speed) {
    if (effect === 3) return Math.max(0, 1 - tick / speed); // FadeOut
    if (effect === 4) {
      const half = speed / 2;
      return tick < half ? 1 : Math.max(0, 1 - (tick - half) / half);
    }
    if (effect === 5) {
      const hold = (speed * 3) / 4;
      return tick < hold ? 1 : Math.max(0, 1 - (tick - hold) / (speed / 4));
    }
    return 1;
  }

  function waveSample(tone, phase, state) {
    if (tone === 0) {
      const step = Math.floor(phase * 32) % 32;
      return (TRIANGLE_TABLE[step] - 7.5) / 7.5;
    }
    if (tone === 1) return phase % 1 < 0.5 ? 1 : -1; // デューティ50%
    if (tone === 2) return phase % 1 < 0.25 ? 1 : -1; // デューティ25%
    return state.lfsr & 1 ? 1 : -1; // ノイズ
  }

  function flattenEvents(patterns) {
    const events = [];
    for (const pat of patterns) {
      for (let i = 0; i < pat.notes.length; i++) {
        events.push({
          note: pat.notes[i],
          tone: pat.tones[i % pat.tones.length],
          volume: pat.volumes[i % pat.volumes.length],
          effect: pat.effects[i % pat.effects.length],
          speed: pat.speed,
        });
      }
    }
    return events;
  }

  // 1チャンネル分をPCM（Float32Array）へオフラインレンダリング
  function renderChannel(patterns) {
    const events = flattenEvents(patterns);
    const totalTicks = events.reduce((acc, ev) => acc + ev.speed, 0);
    const out = new Float32Array(Math.round(totalTicks * SPT));
    const state = { phase: 0, noisePhase: 0, lfsr: NOISE_SEED, lastMidi: null };

    let tickPos = 0;
    for (const ev of events) {
      const start = Math.round(tickPos * SPT);
      const end = Math.round((tickPos + ev.speed) * SPT);
      if (ev.note >= 0 && ev.volume > 0) {
        renderNote(out, start, end, ev, state);
        state.lastMidi = noteToMidi(ev.note, ev.tone);
      } else {
        state.lastMidi = null;
      }
      tickPos += ev.speed;
    }
    return out;
  }

  function renderNote(out, start, end, ev, state) {
    const dur = end - start;
    const targetMidi = noteToMidi(ev.note, ev.tone);
    const level = ev.volume / 7; // 線形音量（§5.1）
    const gain = TONE_GAINS[ev.tone] * level * CHANNEL_GAIN;
    const slideFrom =
      ev.effect === 1 && state.lastMidi !== null ? state.lastMidi : targetMidi;

    for (let s = 0; s < dur; s++) {
      const tick = s / SPT;
      let midi = slideFrom + (targetMidi - slideFrom) * (s / dur); // Slide(1)
      if (ev.effect === 2) {
        midi += triangleLfo(tick / VIBRATO_PERIOD_TICKS) * VIBRATO_DEPTH_SEMITONES; // Vibrato(2)
      }
      const freq = midiToFreq(midi);

      let value;
      if (ev.tone === 3) {
        state.noisePhase += freq / SAMPLE_RATE;
        while (state.noisePhase >= 1) {
          state.lfsr = lfsrStep(state.lfsr);
          state.noisePhase -= 1;
        }
        value = waveSample(3, 0, state);
      } else {
        value = waveSample(ev.tone, state.phase, state);
        state.phase += freq / SAMPLE_RATE;
      }

      const env = envelopeAt(ev.effect, tick, ev.speed);
      const ramp = Math.min(1, s / CROSSFADE_SAMPLES, (dur - 1 - s) / CROSSFADE_SAMPLES);
      out[start + s] += value * gain * env * Math.max(0, ramp);
    }
  }

  function renderPattern(pat) {
    return renderChannel([pat]);
  }

  // 曲全体をレンダリング。channelsは再生可能パターン列の配列
  // （Model.resolveChannels の結果。空白セルは休符パターンとして含まれる）。
  // チャンネルごとにレンダリングし合算（最長チャンネルに揃える）
  function renderSong(channels) {
    const channelBuffers = channels
      .filter((patterns) => patterns.length > 0)
      .map((patterns) => renderChannel(patterns));
    const total = channelBuffers.reduce((m, b) => Math.max(m, b.length), 0);
    const out = new Float32Array(total);
    for (const buf of channelBuffers) {
      for (let i = 0; i < buf.length; i++) out[i] += buf[i];
    }
    return out;
  }

  // 編集中の単音プレビュー用の短いバッファ（§5.2末尾）
  function renderPreviewNote(note, tone, volume = 7) {
    return renderPattern({
      notes: [note],
      tones: [tone],
      volumes: [volume],
      effects: [0],
      speed: 12,
    });
  }

  // ---- Web Audio再生（ブラウザ専用・純関数レンダラとは分離）----
  let audioCtx = null;
  let sourceNode = null;

  function ensureContext() {
    if (!audioCtx) audioCtx = new AudioContext({ sampleRate: SAMPLE_RATE });
    if (audioCtx.state === "suspended") audioCtx.resume();
    return audioCtx;
  }

  function play(samples, { loop = false, onEnded = null } = {}) {
    stop();
    const ctx = ensureContext();
    const buffer = ctx.createBuffer(1, samples.length, SAMPLE_RATE);
    buffer.getChannelData(0).set(samples);
    sourceNode = ctx.createBufferSource();
    sourceNode.buffer = buffer;
    sourceNode.loop = loop;
    if (onEnded) sourceNode.onended = onEnded;
    sourceNode.connect(ctx.destination);
    sourceNode.start();
  }

  function stop() {
    if (sourceNode) {
      sourceNode.onended = null;
      try {
        sourceNode.stop();
      } catch (_) {
        // 既に停止済みの場合は無視
      }
      sourceNode.disconnect();
      sourceNode = null;
    }
  }

  function isPlaying() {
    return sourceNode !== null;
  }

  return {
    SAMPLE_RATE,
    renderPattern,
    renderSong,
    renderPreviewNote,
    play,
    stop,
    isPlaying,
    _lfsrStep: lfsrStep,
    _noteToMidi: noteToMidi,
  };
})();

if (typeof module !== "undefined") module.exports = AudioEngine;
