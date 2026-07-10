---
name: verify-pyxres
description: 音声エンジン・書き出し・データモデルに触れる変更をした後、Pyxel実機での互換性検証まで実行する。ユニットテストだけでは完了にできない変更（audio.js / exporter.js / model.jsのresolve・allocate系、bpm/音価/移調/空白セルの挙動）で必ず使用。
---

# Pyxel実機互換性の検証

このプロジェクトの品質基準は「エディタが生成したpyxresがPyxel実機で同一内容として
読み込め、再生できること」。以下を上から順に実行する。

## 1. ユニットテスト

```sh
node --test test/*.test.js
```

全件パスするまで先へ進まない。

## 2. 実機検証（読み込み・内容一致）

```sh
node tools/make_test_pyxres.js /tmp/verify.pyxres
uv run python tools/verify_with_pyxel.py /tmp/verify.pyxres
```

- `PASS: pyxel.load() + playm() 正常` が出れば合格。
- **GUI必須**: `pyxel.init()` がウィンドウを開く。`SDL_VIDEODRIVER=dummy` は
  OpenGL非対応で落ちるので使わない。ヘッドレス環境では実行不可（その場合は
  ユーザーに手元実行を依頼する）。
- 初回は `uv sync` が走り依存（pyxel）が入る。

## 3. 検証スクリプト自体の更新

書き出し内容に影響する変更（新フィールド・変換ロジック・割り当て順の変更）をしたときは、
検証がその変更を実際に踏むようにフィクスチャとアサーションを更新する:

1. `tools/make_test_pyxres.js` … 新機能を使う打ち込みを追加（例: 音価はlengths、
   途中開始は`null`セル、移調はtranspose）
2. `tools/verify_with_pyxel.py` … `pyxel.sounds[i].notes/tones/volumes/effects/speed` と
   `pyxel.musics[i].seqs` の期待値を更新。**割り当ては登場順**
   （スロット順→チャンネル順→セル順、休符は初出時に1枠）なのでindexのずれに注意

## 4. 耳での確認（音の変更時のみ）

```sh
uv run pyxel-test /tmp/verify.pyxres
```

0-7でスロット切替、SPACEで再生/停止、Qで終了。エディタのブラウザ再生と
聴き比べて違和感がないか確認する。

## 完了条件

- ユニットテスト全パス
- verify_with_pyxel.py がPASS（実行したPyxelバージョンを報告に書く）
- 書き出しへ影響する変更なら手順3のフィクスチャ更新も済んでいる
