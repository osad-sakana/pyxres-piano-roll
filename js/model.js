"use strict";
// Model層: プロジェクトデータ・バリデーション（設計書§3 / 内部フォーマットv2）
// v2: 曲(Song)がパターンを内包する（曲 has many パターン）。
//     テンポは曲のbpmで持ち、書き出し時にPyxelのspeedへ変換する。
//     パターンはrateMode（通常/2倍/1/2倍再生）を持つ。
// DOM・Web Audioに依存しない純粋データ層。全操作はイミュータブル。
const Model = (() => {
  const FORMAT_VERSION = 2;
  const NOTE_MIN = -1;
  const NOTE_MAX = 59;
  const MAX_CHANNELS = 4;
  const MAX_SOUNDS = 64;
  const MAX_MUSICS = 8;
  const MAX_PATTERNS_PER_SONG = 64; // 1曲だけで64音枠を超えないための構造的上限
  const VOLUME_MAX = 7;
  const EFFECT_MAX = 5;
  const SPEED_MIN = 1;
  const SPEED_MAX = 65535;
  // BPM上限900: 2倍再生でも speed = round(1800/900)/2 = 1 を下回らない範囲
  const BPM_MIN = 20;
  const BPM_MAX = 900;
  const DEFAULT_BPM = 120;
  const DEFAULT_SOUND_SPEED = 30; // 未使用音枠の既定speed（pyxel-core DEFAULT_SOUND_SPEED）
  const DEFAULT_PATTERN_LENGTH = 16;
  const RATE_MODES = ["normal", "double", "half"];

  function createProject() {
    const now = new Date().toISOString();
    return {
      formatVersion: FORMAT_VERSION,
      meta: { title: "", created: now, modified: now },
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
      rateMode: "normal",
    };
  }

  function createSong(id, name = "") {
    return { id, name, bpm: DEFAULT_BPM, patterns: [], channels: [[]] };
  }

  function nextId(items, prefix) {
    const max = items.reduce((acc, item) => {
      const m = String(item.id).match(new RegExp(`^${prefix}(\\d+)$`));
      return m ? Math.max(acc, Number(m[1])) : acc;
    }, 0);
    return `${prefix}${max + 1}`;
  }

  function findSong(project, songId) {
    const song = project.songs.find((s) => s.id === songId);
    if (!song) throw new Error(`曲が見つかりません: ${songId}`);
    return song;
  }

  function addSong(project, name = "") {
    const id = nextId(project.songs, "s");
    return {
      ...project,
      songs: [...project.songs, createSong(id, name || `曲${id.slice(1)}`)],
    };
  }

  function updateSong(project, songId, patch) {
    return {
      ...project,
      songs: project.songs.map((s) => (s.id === songId ? { ...s, ...patch } : s)),
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

  function addPattern(project, songId, name = "") {
    const song = findSong(project, songId);
    if (song.patterns.length >= MAX_PATTERNS_PER_SONG) {
      throw new Error(`パターンは1曲あたり最大${MAX_PATTERNS_PER_SONG}個です`);
    }
    const id = nextId(song.patterns, "p");
    return updateSong(project, songId, {
      patterns: [...song.patterns, createPattern(id, name || `パターン${id.slice(1)}`)],
    });
  }

  function updatePattern(project, songId, patternId, patch) {
    const song = findSong(project, songId);
    return updateSong(project, songId, {
      patterns: song.patterns.map((p) => (p.id === patternId ? { ...p, ...patch } : p)),
    });
  }

  function removePattern(project, songId, patternId) {
    const song = findSong(project, songId);
    return updateSong(project, songId, {
      patterns: song.patterns.filter((p) => p.id !== patternId),
      channels: song.channels.map((ch) => ch.filter((id) => id !== patternId)),
    });
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

  // ---- テンポ変換 ----
  // 1列 = 16分音符とみなす。tick = 1/120秒なので
  // 16分音符のtick数 = (60 / bpm / 4) × 120 = 1800 / bpm（丸めによる近似）
  function bpmToSpeed(bpm) {
    return Math.min(SPEED_MAX, Math.max(SPEED_MIN, Math.round(1800 / bpm)));
  }

  function patternSpeed(song, pattern) {
    const base = bpmToSpeed(song.bpm);
    if (pattern.rateMode === "double") return Math.max(SPEED_MIN, Math.round(base / 2));
    if (pattern.rateMode === "half") return Math.min(SPEED_MAX, base * 2);
    return base;
  }

  // 再生・書き出し用にspeedを確定させたパターンを得る
  function resolvePattern(song, pattern) {
    return { ...pattern, speed: patternSpeed(song, pattern) };
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
    if (!RATE_MODES.includes(pattern.rateMode)) {
      errors.push(`再生モードが不正です: ${pattern.rateMode}`);
    }
    return errors;
  }

  function validateSong(song) {
    const errors = [];
    if (!Number.isInteger(song.bpm) || song.bpm < BPM_MIN || song.bpm > BPM_MAX) {
      errors.push(`BPMは${BPM_MIN}〜${BPM_MAX}である必要があります`);
    }
    if (song.channels.length > MAX_CHANNELS) {
      errors.push(`チャンネルは最大${MAX_CHANNELS}本です`);
    }
    return errors;
  }

  function emptySound() {
    return { notes: [], tones: [], volumes: [], effects: [], speed: DEFAULT_SOUND_SPEED };
  }

  function patternToSound(song, pattern) {
    return {
      notes: [...pattern.notes],
      tones: [...pattern.tones],
      volumes: [...pattern.volumes],
      effects: [...pattern.effects],
      speed: patternSpeed(song, pattern),
    };
  }

  // 書き出し時の割り当てアルゴリズム（§3.3のv2版）
  // パターンは曲に属するため、割り当て単位は（曲, パターン）の組。
  function allocateExport(project) {
    const songById = new Map(project.songs.map((s) => [s.id, s]));
    const slots = project.export.musicSlots;

    // 1. 選択された曲が参照するパターンを登場順に収集・重複排除（曲内共有のみ）
    const ordered = []; // { key, song, pattern }
    const seen = new Set();
    const perSong = [];
    for (const songId of slots) {
      if (songId === null) continue;
      const song = songById.get(songId);
      if (!song) continue;
      const patternById = new Map(song.patterns.map((p) => [p.id, p]));
      const songKeys = new Set();
      for (const channel of song.channels) {
        for (const pid of channel) {
          const pattern = patternById.get(pid);
          if (!pattern) continue;
          const key = `${songId}/${pid}`;
          songKeys.add(key);
          if (!seen.has(key)) {
            seen.add(key);
            ordered.push({ key, song, pattern });
          }
        }
      }
      perSong.push({ songId: song.id, name: song.name, count: songKeys.size });
    }

    // 2. 64超過なら拒否し、超過数と曲別消費数を提示
    if (ordered.length > MAX_SOUNDS) {
      return { ok: false, excess: ordered.length - MAX_SOUNDS, perSong };
    }

    // 3. 登場順にsounds[0..n]へ割り当て、対応表を作る
    const indexByKey = new Map(ordered.map((entry, i) => [entry.key, i]));
    const sounds = ordered.map(({ song, pattern }) => patternToSound(song, pattern));
    // 未使用スロットは空エントリで埋め、通常セーブと同じ64エントリ構成に揃える
    while (sounds.length < MAX_SOUNDS) sounds.push(emptySound());

    // 4. 各曲のchannelsをindex列に変換しmusics[slot].seqsとする
    const musics = slots.map((songId) => {
      const song = songId !== null ? songById.get(songId) : null;
      if (!song) return { seqs: [] };
      const patternIds = new Set(song.patterns.map((p) => p.id));
      return {
        seqs: song.channels.map((ch) =>
          ch.filter((pid) => patternIds.has(pid)).map((pid) => indexByKey.get(`${songId}/${pid}`))
        ),
      };
    });

    return { ok: true, sounds, musics, indexByKey };
  }

  // ---- v1（グローバルパターン＋speed）からのマイグレーション ----
  function migrateProject(data) {
    if (data.formatVersion === FORMAT_VERSION) return data;
    if (data.formatVersion !== 1) {
      throw new Error(`未対応のformatVersionです: ${data.formatVersion}`);
    }

    const globalById = new Map((data.patterns || []).map((p) => [p.id, p]));
    const referenced = new Set();

    const toV2Pattern = (p) => ({
      id: p.id,
      name: p.name || p.id,
      notes: [...p.notes],
      tones: [...p.tones],
      volumes: [...p.volumes],
      effects: [...p.effects],
      rateMode: "normal",
    });

    let songs = (data.songs || []).map((song) => {
      const used = [];
      const seen = new Set();
      for (const ch of song.channels) {
        for (const pid of ch) {
          if (globalById.has(pid) && !seen.has(pid)) {
            seen.add(pid);
            used.push(globalById.get(pid));
            referenced.add(pid);
          }
        }
      }
      // bpmは最初に参照しているパターンのspeedから近似（speed = 1800/bpm の逆算）
      const speed = used.length > 0 ? used[0].speed : DEFAULT_SOUND_SPEED;
      const bpm = Math.min(BPM_MAX, Math.max(BPM_MIN, Math.round(1800 / speed)));
      return {
        id: song.id,
        name: song.name || song.id,
        bpm,
        patterns: used.map(toV2Pattern),
        channels: song.channels.map((ch) => ch.filter((pid) => globalById.has(pid))),
      };
    });

    // どの曲からも参照されていないパターンは失わないよう受け皿の曲に入れる
    const orphans = (data.patterns || []).filter((p) => !referenced.has(p.id));
    if (orphans.length > 0) {
      if (songs.length === 0) {
        songs = [createSong("s1", "曲1")];
      }
      const first = songs[0];
      songs = [
        { ...first, patterns: [...first.patterns, ...orphans.map(toV2Pattern)] },
        ...songs.slice(1),
      ];
    }

    return {
      formatVersion: FORMAT_VERSION,
      meta: data.meta || { title: "", created: "", modified: "" },
      songs,
      export: data.export || { musicSlots: Array(MAX_MUSICS).fill(null) },
    };
  }

  return {
    FORMAT_VERSION,
    NOTE_MIN,
    NOTE_MAX,
    MAX_CHANNELS,
    MAX_SOUNDS,
    MAX_MUSICS,
    MAX_PATTERNS_PER_SONG,
    VOLUME_MAX,
    EFFECT_MAX,
    SPEED_MIN,
    SPEED_MAX,
    BPM_MIN,
    BPM_MAX,
    DEFAULT_BPM,
    RATE_MODES,
    createProject,
    createPattern,
    createSong,
    nextId,
    addSong,
    updateSong,
    removeSong,
    addPattern,
    updatePattern,
    removePattern,
    setNoteAt,
    resizePattern,
    expandProperty,
    addChannel,
    removeChannel,
    bpmToSpeed,
    patternSpeed,
    resolvePattern,
    validatePattern,
    validateSong,
    allocateExport,
    migrateProject,
  };
})();

if (typeof module !== "undefined") module.exports = Model;
