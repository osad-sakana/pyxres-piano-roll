# Pyxel互換音楽エディタ

ブラウザ単体で動く、[Pyxel](https://github.com/kitao/pyxel)互換の音楽エディタです。
ピアノロールで打ち込んだ曲を `.pyxres`（`format_version = 1`）として書き出し、
Pyxel実機の `pyxel.load()` + `pyxel.playm()` でそのまま再生できます。

> **非公式ツールです**: 本プロジェクトはファンメイドのサードパーティ製ツールであり、
> Pyxel開発者の承認を受けたものではありません。Pyxelは[kitao](https://github.com/kitao)氏の
> 著作物です。本エディタで生成したファイルに起因する不具合をPyxel本体へ報告しないでください。

## 使い方

ビルド不要・外部依存ゼロです。いずれかで開きます。

```sh
# そのまま開く
open index.html

# または静的サーバ経由
python3 -m http.server 8930
# → http://localhost:8930
```

- **曲・パターン**: 左サイドバーで追加・選択・リネーム・削除。パターンは曲ごとに管理されます
- **ピアノロール**: クリックで配置/削除、ドラッグで移動。`←→`で列移動、`↑↓`で移調、`Enter`で音符⇔休符
- **音価**: ノート右端をドラッグで長さを変更（Cubase風）。pyxresに音価の概念はないため、書き出し時に同音程の連続ノートへ分割されます
- **曲構造**: パターンをチャンネルレーンへドラッグ＆ドロップして並べます（4チャンネルまで）
- **BPM**: 曲構造ヘッダで曲ごとに設定（20〜900）
- **再生モード**: パターンごとに 通常／2倍／1/2倍 を選択
- **保存**: 編集は1秒デバウンスでlocalStorageへ自動保存。可搬性が必要なら「JSON保存/読み込み」
- **書き出し**: 「pyxres書き出し」で最大8曲を音楽スロットへ割り当ててダウンロード

pyxresは書き出し専用です。編集の正本は内部JSONで、旧フォーマット（v1）のJSONは読み込み時に自動変換されます。

## 実機での確認（pyxel-test）

書き出したpyxresをPyxel実機エンジンで再生するCLIを同梱しています。

```sh
uv run pyxel-test <pyxresファイル>
```

| キー        | 動作                         |
| ----------- | ---------------------------- |
| `0`〜`7`    | 音楽スロットを選択して再生   |
| `←` `→`     | データのあるスロット間を移動 |
| `SPACE`     | 再生 / 停止                  |
| `Q` / `ESC` | 終了                         |

## データモデル

内部フォーマットv3。曲（Song）がパターンを内包します。

```
Project
 └─ songs: Song[]                  … 曲数は無制限（書き出し時に8スロットへ選択割り当て）
     ├─ bpm                        … 20〜900。書き出し時 speed = round(1800 / bpm)（1列=16分音符）
     ├─ patterns: Pattern[]        … 1曲あたり最大64個
     │   ├─ rateMode               … normal / double(2倍) / half(1/2倍)。speedを1/2倍・2倍に変換
     │   └─ lengths                … 音価（ノートが占有する列数）。書き出し時に同音程の連続ノートへ分割
     └─ channels: patternId[][]    … 最大4チャンネル。ID参照＝曲内のパターン共有
```

Pyxel由来の制約（音域60音階 C0〜B4・4波形・音量0〜7・エフェクト6種）はUIで構造的に超えられないようにしており、
事後エラーは「書き出し対象の参照パターン合計が64を超えた場合」のみです。

## アーキテクチャ

依存方向は一方向（UI → Model、AudioEngine/Exporter → Model）。ModelはDOM・Web Audioに依存しない純粋データ層です。

| モジュール                       | 役割                                                                     |
| -------------------------------- | ------------------------------------------------------------------------ |
| [js/model.js](js/model.js)       | プロジェクトデータ・バリデーション・書き出し割り当て・v1マイグレーション |
| [js/audio.js](js/audio.js)       | Pyxel準拠の22,050Hzオフラインレンダラ（純関数）とWeb Audio再生           |
| [js/exporter.js](js/exporter.js) | TOML生成＋無圧縮ZIP梱包（CRC-32含む自前実装）                            |
| [js/storage.js](js/storage.js)   | localStorage自動保存・JSONファイル入出力                                 |
| [js/ui/](js/ui/)                 | ピアノロール・チャンネルレーン・リスト・プロパティ・ダイアログ           |
| [js/app.js](js/app.js)           | 状態管理（イミュータブル更新）とビューの束ね                             |

音声エンジンはpyxel-coreの実装に準拠しています（4波形・NES APU方式LFSRノイズ・
Slide/Vibrato/FadeOut/Half/Quarterエフェクト・チャンネルゲイン0.125）。詳細は設計書§5を参照。

## 開発

```sh
# ユニットテスト（Model / Exporter / AudioEngine / Storage）
node --test test/*.test.js

# Pyxel実機での読み込み検証（テスト用pyxresを生成して検証）
node tools/make_test_pyxres.js /tmp/verify.pyxres
uv run python tools/verify_with_pyxel.py /tmp/verify.pyxres
```

実機検証はPyxel 2.9.7で、エディタ生成の2曲入りpyxres（曲内パターン共有・再生モードあり）が
`pyxel.load()`で読み込め、sounds/musicsの内容が一致し、`playm()`が通ることを確認しています。

## ライセンスとクレジット

本プロジェクトは [MIT License](LICENSE) です。

- [Pyxel](https://github.com/kitao/pyxel)（MIT License, © [kitao](https://github.com/kitao)）— 本エディタが互換対象とするレトロゲームエンジン
- 再生エンジンの各パラメータ（サンプルレート・波形定義・ゲイン・LFSRシード・エフェクト仕様など）は、
  pyxel-core（MIT License）のソースコード（`settings.rs` / `voice.rs` / `sound.rs` / `channel.rs`）を
  参照して導出したものです。コードの複製・翻訳は含みません
- `.pyxres`フォーマットは公式仕様 [pyxres-format.md](https://github.com/kitao/pyxel/blob/main/docs/pyxres-format.md) に準拠しています
