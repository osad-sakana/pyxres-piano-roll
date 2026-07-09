"use strict";
// Model層: プロジェクトデータ・バリデーション（設計書§3）
// DOM・Web Audioに依存しない純粋データ層。全操作はイミュータブル。
const Model = (() => {
  const NOTE_MIN = -1;
  const NOTE_MAX = 59;
  const MAX_CHANNELS = 4;
  const MAX_SOUNDS = 64;
  const MAX_MUSICS = 8;
  const VOLUME_MAX = 7;
  const EFFECT_MAX = 5;
  const SPEED_MIN = 1;
  const SPEED_MAX = 65535;
  const DEFAULT_SOUND_SPEED = 30; // pyxel-core settings.rs DEFAULT_SOUND_SPEED
  const DEFAULT_PATTERN_LENGTH = 16;

  function createProject() {
    const now = new Date().toISOString();
    return {
      formatVersion: 1,
      meta: { title: "", created: now, modified: now },
      patterns: [],
      songs: [],
      export: { musicSlots: Array(MAX_MUSICS).fill(null) },
    };
  }

  function createPattern(id, name = "") {
    return {
      id,
      name,
      notes: Array(DEFAULT_PATTERN_LENGTH).fill(-1),
      tones: [0],
      volumes: [7],
      effects: [0],
      speed: DEFAULT_SOUND_SPEED,
    };
  }

  function createSong(id, name = "") {
    return { id, name, channels: [[]] };
  }

  function nextId(items, prefix) {
    const max = items.reduce((acc, item) => {
      const m = String(item.id).match(new RegExp(`^${prefix}(\\d+)$`));
      return m ? Math.max(acc, Number(m[1])) : acc;
    }, 0);
    return `${prefix}${max + 1}`;
  }

  function addPattern(project, name = "") {
    const id = nextId(project.patterns, "p");
    return {
      ...project,
      patterns: [...project.patterns, createPattern(id, name || `パターン${id.slice(1)}`)],
    };
  }

  function addSong(project, name = "") {
    const id = nextId(project.songs, "s");
    return {
      ...project,
      songs: [...project.songs, createSong(id, name || `曲${id.slice(1)}`)],
    };
  }

  function updatePattern(project, patternId, patch) {
    return {
      ...project,
      patterns: project.patterns.map((p) => (p.id === patternId ? { ...p, ...patch } : p)),
    };
  }

  function updateSong(project, songId, patch) {
    return {
      ...project,
      songs: project.songs.map((s) => (s.id === songId ? { ...s, ...patch } : s)),
    };
  }

  function removePattern(project, patternId) {
    return {
      ...project,
      patterns: project.patterns.filter((p) => p.id !== patternId),
      songs: project.songs.map((s) => ({
        ...s,
        channels: s.channels.map((ch) => ch.filter((id) => id !== patternId)),
      })),
    };
  }

  function removeSong(project, songId) {
    return {
      ...project,
      songs: project.songs.filter((s) => s.id !== songId),
      export: {
        ...project.export,
        musicSlots: project.export.musicSlots.map((id) => (id === songId ? null : id)),
      },
    };
  }

  function setNoteAt(pattern, col, value) {
    if (!Number.isInteger(value) || value < NOTE_MIN || value > NOTE_MAX) {
      throw new Error(`note値が範囲外です: ${value}（${NOTE_MIN}〜${NOTE_MAX}）`);
    }
    if (col < 0 || col >= pattern.notes.length) {
      throw new Error(`列が範囲外です: ${col}`);
    }
    const notes = pattern.notes.map((n, i) => (i === col ? value : n));
    return { ...pattern, notes };
  }

  function resizePattern(pattern, length) {
    if (!Number.isInteger(length) || length < 1) {
      throw new Error(`パターン長が不正です: ${length}`);
    }
    const notes = Array.from({ length }, (_, i) => (i < pattern.notes.length ? pattern.notes[i] : -1));
    return { ...pattern, notes };
  }

  // ノート個別編集モード用: 循環配列をnotesと同長に展開する（§4.2）
  function expandProperty(pattern, field) {
    const src = pattern[field];
    const expanded = pattern.notes.map((_, i) => src[i % src.length]);
    return { ...pattern, [field]: expanded };
  }

  function addChannel(song) {
    if (song.channels.length >= MAX_CHANNELS) {
      throw new Error(`チャンネルは最大${MAX_CHANNELS}本です`);
    }
    return { ...song, channels: [...song.channels, []] };
  }

  function removeChannel(song, index) {
    return { ...song, channels: song.channels.filter((_, i) => i !== index) };
  }

  function validatePattern(pattern) {
    const errors = [];
    if (pattern.notes.some((n) => !Number.isInteger(n) || n < NOTE_MIN || n > NOTE_MAX)) {
      errors.push(`note値は${NOTE_MIN}〜${NOTE_MAX}である必要があります`);
    }
    if (pattern.tones.some((t) => !Number.isInteger(t) || t < 0 || t > 3)) {
      errors.push("tone値は0〜3である必要があります");
    }
    if (pattern.volumes.some((v) => !Number.isInteger(v) || v < 0 || v > VOLUME_MAX)) {
      errors.push(`volume値は0〜${VOLUME_MAX}である必要があります`);
    }
    if (pattern.effects.some((e) => !Number.isInteger(e) || e < 0 || e > EFFECT_MAX)) {
      errors.push(`effect値は0〜${EFFECT_MAX}である必要があります`);
    }
    if (!Number.isInteger(pattern.speed) || pattern.speed < SPEED_MIN || pattern.speed > SPEED_MAX) {
      errors.push(`speedは${SPEED_MIN}〜${SPEED_MAX}である必要があります`);
    }
    return errors;
  }

  function emptySound() {
    return { notes: [], tones: [], volumes: [], effects: [], speed: DEFAULT_SOUND_SPEED };
  }

  function patternToSound(pattern) {
    return {
      notes: [...pattern.notes],
      tones: [...pattern.tones],
      volumes: [...pattern.volumes],
      effects: [...pattern.effects],
      speed: pattern.speed,
    };
  }

  // 書き出し時の割り当てアルゴリズム（§3.3）
  function allocateExport(project) {
    const patternById = new Map(project.patterns.map((p) => [p.id, p]));
    const songById = new Map(project.songs.map((s) => [s.id, s]));
    const slots = project.export.musicSlots;

    // 1. 選択された曲が参照するパターンIDを登場順に収集・重複排除
    const orderedIds = [];
    const seen = new Set();
    const perSong = [];
    for (const songId of slots) {
      if (songId === null) continue;
      const song = songById.get(songId);
      if (!song) continue;
      const songIds = new Set();
      for (const channel of song.channels) {
        for (const pid of channel) {
          songIds.add(pid);
          if (!seen.has(pid)) {
            seen.add(pid);
            orderedIds.push(pid);
          }
        }
      }
      perSong.push({ songId: song.id, name: song.name, count: songIds.size });
    }

    // 2. 64超過なら拒否し、超過数と曲別消費数を提示
    if (orderedIds.length > MAX_SOUNDS) {
      return { ok: false, excess: orderedIds.length - MAX_SOUNDS, perSong };
    }

    // 3. 登場順にsounds[0..n]へ割り当て、対応表を作る
    const indexById = new Map(orderedIds.map((id, i) => [id, i]));
    const sounds = orderedIds.map((id) => patternToSound(patternById.get(id)));
    // 5. 未使用スロットは空エントリで埋め、通常セーブと同じ64エントリ構成に揃える
    while (sounds.length < MAX_SOUNDS) sounds.push(emptySound());

    // 4. 各曲のchannelsをindex列に変換しmusics[slot].seqsとする
    const musics = slots.map((songId) => {
      const song = songId !== null ? songById.get(songId) : null;
      if (!song) return { seqs: [] };
      return { seqs: song.channels.map((ch) => ch.map((pid) => indexById.get(pid))) };
    });

    return { ok: true, sounds, musics, indexById };
  }

  return {
    NOTE_MIN,
    NOTE_MAX,
    MAX_CHANNELS,
    MAX_SOUNDS,
    MAX_MUSICS,
    VOLUME_MAX,
    EFFECT_MAX,
    SPEED_MIN,
    SPEED_MAX,
    DEFAULT_SOUND_SPEED,
    createProject,
    createPattern,
    createSong,
    nextId,
    addPattern,
    addSong,
    updatePattern,
    updateSong,
    removePattern,
    removeSong,
    setNoteAt,
    resizePattern,
    expandProperty,
    addChannel,
    removeChannel,
    validatePattern,
    allocateExport,
  };
})();

if (typeof module !== "undefined") module.exports = Model;
