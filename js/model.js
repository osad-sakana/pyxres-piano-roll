"use strict";
// Model層: プロジェクトデータ・バリデーション（設計書§3 / 内部フォーマットv3）
// v2: 曲(Song)がパターンを内包する（曲 has many パターン）。
//     テンポは曲のbpmで持ち、書き出し時にPyxelのspeedへ変換する。
//     パターンはrateMode（通常/2倍/1/2倍再生）を持つ。
// v3: 音価（lengths）を追加。ノートは複数列を占有でき、
//     書き出し・再生時に同音程の連続ノートへ分割展開される。
// v4: 曲にtranspose（半音）を追加。再生・書き出し時に全ノートへ非破壊で適用される。
// v5: チャンネルをグリッド化。セルはpatternId | null（空白=1小節の休符）で、
//     トラックの途中からパターンを配置できる。書き出し時は空白を休符サウンドへ変換。
// DOM・Web Audioに依存しない純粋データ層。全操作はイミュータブル。
const Model = (() => {
  const FORMAT_VERSION = 5;
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
  const TRANSPOSE_MIN = -59;
  const TRANSPOSE_MAX = 59;
  const DEFAULT_SOUND_SPEED = 30; // 未使用音枠の既定speed（pyxel-core DEFAULT_SOUND_SPEED）
  const DEFAULT_PATTERN_LENGTH = 16;
  const RATE_MODES = ["normal", "double", "half"];
  const REST_CELL_COLUMNS = 16; // 空白セル1個の長さ（16列=1小節ぶんの休符）
  const REST_KEY = "__rest__"; // 書き出し割り当てで休符サウンドを指すキー

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
      lengths: Array(DEFAULT_PATTERN_LENGTH).fill(1), // 音価（占有する列数）。notes[col] >= 0 の位置のみ有効
      tones: [0],
      volumes: [7],
      effects: [0],
      rateMode: "normal",
    };
  }

  function createSong(id, name = "") {
    return { id, name, bpm: DEFAULT_BPM, transpose: 0, patterns: [], channels: [[]] };
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

  // パターンを複製し、元のすぐ後ろへ挿入する
  function duplicatePattern(project, songId, patternId) {
    const song = findSong(project, songId);
    if (song.patterns.length >= MAX_PATTERNS_PER_SONG) {
      throw new Error(`パターンは1曲あたり最大${MAX_PATTERNS_PER_SONG}個です`);
    }
    const index = song.patterns.findIndex((p) => p.id === patternId);
    if (index < 0) {
      throw new Error(`パターンが見つかりません: ${patternId}`);
    }
    const src = song.patterns[index];
    const copy = {
      ...src,
      id: nextId(song.patterns, "p"),
      name: `${src.name || src.id}のコピー`,
      notes: [...src.notes],
      lengths: [...src.lengths],
      tones: [...src.tones],
      volumes: [...src.volumes],
      effects: [...src.effects],
    };
    const patterns = [...song.patterns.slice(0, index + 1), copy, ...song.patterns.slice(index + 1)];
    return updateSong(project, songId, { patterns });
  }

  // channels[ch][idx]と同じパターンへの参照を、その直後のセルへ挿入する
  function duplicatePatternInChannel(project, songId, ch, idx) {
    const song = findSong(project, songId);
    const patternId = song.channels[ch][idx];
    if (patternId == null) {
      throw new Error("空白セルは複製できません");
    }
    const updated = insertChannelCell(song, ch, idx + 1, patternId);
    return updateSong(project, songId, { channels: updated.channels });
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
      // 配置は空白セルへ置き換え、後続セルの位置（タイミング）を保つ
      channels: song.channels.map((ch) =>
        trimCells(ch.map((id) => (id === patternId ? null : id)))
      ),
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

  // ---- 音価（ノート長）----
  // colを占有しているノートの範囲を返す（開始列とcol自身が休符でも、手前のノートが覆っていれば返す）
  function noteSpanAt(pattern, col) {
    if (col < 0 || col >= pattern.notes.length) return null;
    let start = col;
    while (start >= 0 && pattern.notes[start] < 0) start--;
    if (start < 0) return null;
    const len = pattern.lengths[start] || 1;
    if (start + len <= col) return null; // 手前のノートはcolまで届いていない
    return { start, len, note: pattern.notes[start] };
  }

  // fromColより後で最初にノートが始まる列（なければパターン末尾）
  function nextNoteStart(pattern, fromCol) {
    for (let c = fromCol + 1; c < pattern.notes.length; c++) {
      if (pattern.notes[c] >= 0) return c;
    }
    return pattern.notes.length;
  }

  function clampLen(pattern, col, len) {
    return Math.max(1, Math.min(len, nextNoteStart(pattern, col) - col));
  }

  // ノートを配置する。覆っている既存ノートは切り詰め、colに既存ノートがあれば音価を保って音程だけ差し替える
  function placeNote(pattern, col, value, len = null) {
    if (!Number.isInteger(value) || value < 0 || value > NOTE_MAX) {
      throw new Error(`note値が範囲外です: ${value}（0〜${NOTE_MAX}）`);
    }
    if (col < 0 || col >= pattern.notes.length) {
      throw new Error(`列が範囲外です: ${col}`);
    }
    const notes = [...pattern.notes];
    const lengths = [...pattern.lengths];
    const span = noteSpanAt(pattern, col);
    if (span && span.start < col) {
      lengths[span.start] = col - span.start; // 覆っていたノートを切り詰める
    }
    const keepLen = span && span.start === col ? span.len : 1;
    notes[col] = value;
    const p = { ...pattern, notes, lengths };
    lengths[col] = clampLen(p, col, len !== null ? len : keepLen);
    return { ...pattern, notes, lengths };
  }

  // colを占有しているノートを削除する
  function deleteNoteAt(pattern, col) {
    const span = noteSpanAt(pattern, col);
    if (!span) return pattern;
    const notes = pattern.notes.map((n, i) => (i === span.start ? -1 : n));
    const lengths = pattern.lengths.map((l, i) => (i === span.start ? 1 : l));
    return { ...pattern, notes, lengths };
  }

  // startにあるノートの音価を変更する（1以上・次のノート/パターン末尾まで）
  function resizeNoteAt(pattern, start, len) {
    if (pattern.notes[start] < 0) return pattern;
    const lengths = pattern.lengths.map((l, i) =>
      i === start ? clampLen(pattern, start, len) : l
    );
    return { ...pattern, lengths };
  }

  // ノートを音価を保ったまま移動する（移動先で収まらない分は切り詰め）
  function moveNoteTo(pattern, fromCol, toCol, value) {
    const span = noteSpanAt(pattern, fromCol);
    const len = span ? span.len : 1;
    const removed = span ? deleteNoteAt(pattern, fromCol) : pattern;
    return placeNote(removed, toCol, value, len);
  }

  // 音価を列単位の連続ノートへ分割展開する（書き出し・再生用）。
  // pyxresに音価の概念はないため、長さNのノートは同音程N列になる。
  function expandPattern(pattern) {
    if (!pattern.lengths || pattern.lengths.every((l) => (l || 1) <= 1)) return pattern;
    const cols = pattern.notes.length;
    const notes = [...pattern.notes];
    const expandField = (arr) =>
      arr.length === cols ? [...arr] : arr; // ノート個別編集済みの配列のみ列単位で持つ
    const tones = expandField(pattern.tones);
    const volumes = expandField(pattern.volumes);
    const effects = expandField(pattern.effects);
    for (let start = 0; start < cols; start++) {
      if (pattern.notes[start] < 0) continue;
      const len = Math.min(pattern.lengths[start] || 1, cols - start);
      for (let c = start + 1; c < start + len; c++) {
        notes[c] = pattern.notes[start];
        // 個別編集された属性は開始列の値を引き継ぐ（循環配列のままなら全列同値なので不要）
        if (tones.length === cols) tones[c] = tones[start];
        if (volumes.length === cols) volumes[c] = volumes[start];
        if (effects.length === cols) effects[c] = effects[start];
      }
    }
    return { ...pattern, notes, tones, volumes, effects };
  }

  function resizePattern(pattern, length) {
    if (!Number.isInteger(length) || length < 1) {
      throw new Error(`パターン長が不正です: ${length}`);
    }
    const notes = Array.from({ length }, (_, i) => (i < pattern.notes.length ? pattern.notes[i] : -1));
    // 音価も追従させ、新しい末尾からはみ出すノートは切り詰める
    const lengths = Array.from({ length }, (_, i) => {
      const l = i < pattern.lengths.length ? pattern.lengths[i] : 1;
      return notes[i] >= 0 ? Math.min(l, length - i) : 1;
    });
    return { ...pattern, notes, lengths };
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

  // ---- チャンネルグリッド操作 ----
  // セルは patternId | null。nullは1小節（REST_CELL_COLUMNS列）の休符。
  // 末尾のnullは意味を持たないため常に切り詰める。
  function trimCells(cells) {
    const out = [...cells];
    while (out.length > 0 && out[out.length - 1] === null) out.pop();
    return out;
  }

  function withChannel(song, ch, cells) {
    return {
      ...song,
      channels: song.channels.map((c, i) => (i === ch ? trimCells(cells) : c)),
    };
  }

  // idxのセルへ配置/空白化する。既存長を超える位置はnullで埋める
  function setChannelCell(song, ch, idx, value) {
    const cells = [...song.channels[ch]];
    while (cells.length <= idx) cells.push(null);
    cells[idx] = value;
    return withChannel(song, ch, cells);
  }

  // idxの位置へ挿入する（以降のセルは後ろへずれる）
  function insertChannelCell(song, ch, idx, value) {
    const cells = [...song.channels[ch]];
    while (cells.length < idx) cells.push(null);
    cells.splice(idx, 0, value);
    return withChannel(song, ch, cells);
  }

  // idxのセルを取り除く（以降のセルは前へ詰まる）
  function removeChannelCell(song, ch, idx) {
    const cells = song.channels[ch].filter((_, i) => i !== idx);
    return withChannel(song, ch, cells);
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

  // ---- トランスポーズ（曲単位・非破壊）----
  // 音域(0〜59)からはみ出す場合は端へクランプする
  function transposeNote(note, semitones) {
    if (note < 0) return -1; // 休符はそのまま
    return Math.min(NOTE_MAX, Math.max(0, note + semitones));
  }

  function transposeNotes(notes, semitones) {
    if (!semitones) return notes;
    return notes.map((n) => transposeNote(n, semitones));
  }

  // 曲のtransposeでクランプ（音域外→端へ吸着）が発生するノート数
  function transposeClampCount(song) {
    const t = song.transpose || 0;
    if (!t) return 0;
    let count = 0;
    for (const pattern of song.patterns) {
      for (const n of pattern.notes) {
        if (n >= 0 && (n + t < 0 || n + t > NOTE_MAX)) count++;
      }
    }
    return count;
  }

  // 再生・書き出し用に、音価を分割展開しトランスポーズとspeedを確定させたパターンを得る
  function resolvePattern(song, pattern) {
    const expanded = expandPattern(pattern);
    return {
      ...expanded,
      notes: transposeNotes(expanded.notes, song.transpose || 0),
      speed: patternSpeed(song, pattern),
    };
  }

  // 空白セル1個ぶんの休符（再生・書き出し共用の形。speedは曲のbpm基準）
  function restCell(song) {
    return {
      id: null,
      name: "",
      notes: Array(REST_CELL_COLUMNS).fill(-1),
      tones: [0],
      volumes: [7],
      effects: [0],
      speed: bpmToSpeed(song.bpm),
    };
  }

  // 曲の全チャンネルを再生可能なパターン列へ解決する（空白・欠損参照は休符になる）
  function resolveChannels(song) {
    const byId = new Map(song.patterns.map((p) => [p.id, p]));
    return song.channels.map((cells) =>
      cells.map((cell) => {
        const pattern = cell !== null ? byId.get(cell) : null;
        return pattern ? resolvePattern(song, pattern) : restCell(song);
      })
    );
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
    if (
      !Array.isArray(pattern.lengths) ||
      pattern.lengths.length !== pattern.notes.length ||
      pattern.lengths.some((l) => !Number.isInteger(l) || l < 1)
    ) {
      errors.push("音価（lengths）はnotesと同じ長さの1以上の整数配列である必要があります");
    }
    return errors;
  }

  function validateSong(song) {
    const errors = [];
    if (!Number.isInteger(song.bpm) || song.bpm < BPM_MIN || song.bpm > BPM_MAX) {
      errors.push(`BPMは${BPM_MIN}〜${BPM_MAX}である必要があります`);
    }
    if (
      !Number.isInteger(song.transpose) ||
      song.transpose < TRANSPOSE_MIN ||
      song.transpose > TRANSPOSE_MAX
    ) {
      errors.push(`移調は${TRANSPOSE_MIN}〜${TRANSPOSE_MAX}半音である必要があります`);
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
    const expanded = expandPattern(pattern); // 音価はここで同音程の連続ノートへ分割される
    return {
      notes: transposeNotes([...expanded.notes], song.transpose || 0),
      tones: [...expanded.tones],
      volumes: [...expanded.volumes],
      effects: [...expanded.effects],
      speed: patternSpeed(song, pattern),
    };
  }

  // 書き出し時の割り当てアルゴリズム（§3.3のv2版）
  // パターンは曲に属するため、割り当て単位は（曲, パターン）の組。
  function allocateExport(project) {
    const songById = new Map(project.songs.map((s) => [s.id, s]));
    const slots = project.export.musicSlots;

    // セル→割り当てキー。空白セル・欠損参照は曲ごとの休符サウンドを指す
    const cellKey = (song, cell, patternById) =>
      cell !== null && patternById.has(cell)
        ? `${song.id}/${cell}`
        : `${song.id}/${REST_KEY}`;

    // 1. 選択された曲が参照するパターン（＋休符）を登場順に収集・重複排除
    const ordered = []; // { key, song, pattern }  pattern=nullは休符サウンド
    const seen = new Set();
    const perSong = [];
    for (const songId of slots) {
      if (songId === null) continue;
      const song = songById.get(songId);
      if (!song) continue;
      const patternById = new Map(song.patterns.map((p) => [p.id, p]));
      const songKeys = new Set();
      for (const channel of song.channels) {
        for (const cell of channel) {
          const key = cellKey(song, cell, patternById);
          songKeys.add(key);
          if (!seen.has(key)) {
            seen.add(key);
            ordered.push({ key, song, pattern: patternById.get(cell) || null });
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
    const sounds = ordered.map(({ song, pattern }) => {
      if (pattern) return patternToSound(song, pattern);
      const rest = restCell(song); // 空白セルは全休符サウンドとして書き出す
      return {
        notes: rest.notes,
        tones: rest.tones,
        volumes: rest.volumes,
        effects: rest.effects,
        speed: rest.speed,
      };
    });
    // 未使用スロットは空エントリで埋め、通常セーブと同じ64エントリ構成に揃える
    while (sounds.length < MAX_SOUNDS) sounds.push(emptySound());

    // 4. 各曲のchannelsをindex列に変換しmusics[slot].seqsとする（グリッド位置を保持）
    const musics = slots.map((songId) => {
      const song = songId !== null ? songById.get(songId) : null;
      if (!song) return { seqs: [] };
      const patternById = new Map(song.patterns.map((p) => [p.id, p]));
      return {
        seqs: song.channels.map((ch) =>
          ch.map((cell) => indexByKey.get(cellKey(song, cell, patternById)))
        ),
      };
    });

    return { ok: true, sounds, musics, indexByKey };
  }

  // ---- 旧フォーマットからのマイグレーション ----
  function migrateProject(data) {
    if (data.formatVersion === FORMAT_VERSION) return data;
    let project = data;
    if (project.formatVersion === 1) project = migrateV1toV2(project);
    if (project.formatVersion === 2) project = migrateV2toV3(project);
    if (project.formatVersion === 3) project = migrateV3toV4(project);
    if (project.formatVersion === 4) project = migrateV4toV5(project);
    if (project.formatVersion !== FORMAT_VERSION) {
      throw new Error(`未対応のformatVersionです: ${data.formatVersion}`);
    }
    return project;
  }

  // v4 → v5: チャンネルのグリッド化（形は互換。空白セルnullを許容するようになっただけ）
  function migrateV4toV5(data) {
    return { ...data, formatVersion: 5 };
  }

  // v3 → v4: 各曲へtranspose（0）を付与
  function migrateV3toV4(data) {
    return {
      ...data,
      formatVersion: 4,
      songs: data.songs.map((song) => ({ ...song, transpose: 0 })),
    };
  }

  // v2 → v3: 各パターンへ音価（lengths、全て1）を付与
  function migrateV2toV3(data) {
    return {
      ...data,
      formatVersion: 3,
      songs: data.songs.map((song) => ({
        ...song,
        patterns: song.patterns.map((p) => ({
          ...p,
          lengths: Array(p.notes.length).fill(1),
        })),
      })),
    };
  }

  // v1（グローバルパターン＋speed）→ v2（曲がパターンを内包・bpm・rateMode）
  function migrateV1toV2(data) {
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
      formatVersion: 2,
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
    TRANSPOSE_MIN,
    TRANSPOSE_MAX,
    RATE_MODES,
    createProject,
    createPattern,
    createSong,
    nextId,
    addSong,
    updateSong,
    removeSong,
    addPattern,
    duplicatePattern,
    duplicatePatternInChannel,
    updatePattern,
    removePattern,
    setNoteAt,
    noteSpanAt,
    nextNoteStart,
    placeNote,
    deleteNoteAt,
    resizeNoteAt,
    moveNoteTo,
    expandPattern,
    resizePattern,
    expandProperty,
    addChannel,
    removeChannel,
    setChannelCell,
    insertChannelCell,
    removeChannelCell,
    restCell,
    resolveChannels,
    REST_CELL_COLUMNS,
    bpmToSpeed,
    patternSpeed,
    transposeNote,
    transposeClampCount,
    resolvePattern,
    validatePattern,
    validateSong,
    allocateExport,
    migrateProject,
  };
})();

if (typeof module !== "undefined") module.exports = Model;
