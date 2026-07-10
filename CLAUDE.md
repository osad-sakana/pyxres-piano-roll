# pyxres-piano-roll 開発ガイド

ブラウザ単体で動くPyxel互換音楽エディタ（依存ゼロ・ビルドなし）。機能概要と使い方は
[README.md](README.md)、当初設計は[設計書](260708_Pyxel互換音楽エディタ設計書.md)を参照。
**設計書はフェーズ1（v1スキーマ）時点のもの**で、データモデルはその後v5まで進化している。
正はコード（js/model.js冒頭のコメント）とREADMEの「データモデル」節。

## 絶対に守ること

1. **品質基準は「Pyxel実機と同じ音・同じ読み込み結果」**。音声・書き出しに触れたら
   必ず `/verify-pyxres` スキルの手順で実機検証まで行う（ユニットテストだけで完了にしない）。
2. **エディタで聴く音＝書き出される音**。再生も書き出しも必ず
   `Model.resolvePattern` / `Model.resolveChannels` を通す（音価の分割展開・移調・
   BPM→speed変換・空白セル→休符がここで一括適用される）。UI側で独自に変換しない。
3. **Modelは純粋データ層**。DOM・Web Audioへの依存を持ち込まない。全操作イミュータブル。
   これによりnode:testでの検証とPyxel互換性の検証が成立している。
4. **内部フォーマットを変えるときは必ずマイグレーション**。`/bump-format` スキルの手順に従う。
   既存ユーザーのlocalStorage・JSONファイルを壊さないこと。
5. **コミットメッセージに他社製品名を入れない**（Domino・Cubase・Logic等。
   「〜風」の一般表現にする）。attribution行も付けない（グローバル設定で無効化済み）。
6. **1作業=1コミット**。日本語のconventional commits（feat/fix/test/docs/chore/ci）。

## アーキテクチャ（依存方向は一方向）

```
UI (js/ui/*.js, js/app.js)  →  Model (js/model.js)
AudioEngine (js/audio.js)   →  Model が解決したパターンを受け取るだけ
Exporter (js/exporter.js)   →  Model.allocateExport の結果を受け取るだけ
Storage (js/storage.js)     →  Model.migrateProject でバージョン差を吸収
```

- 各ファイルはIIFE＋グローバル定数。末尾の `if (typeof module !== "undefined")` で
  Node（テスト）とブラウザ（`<script src>`）の両対応。ESモジュール化しない
  （file://直開きでの動作が要件）。
- UIビューは `window.APP_VIEWS` に自己登録し、`init(App)` / `render(state)` を実装。
  状態は js/app.js が一元管理（`updateProject` がmodified更新+自動保存+全再描画を行う）。

## ドメイン知識（コードだけでは読み取りにくいもの）

- **1列=16分音符**。BPM→Pyxel speed変換は `speed = round(1800 / bpm)`（tick=1/120秒から導出）。
- **音価（lengths）**: ノートは複数列を占有できるが、pyxresに音価の概念はないため
  書き出し時に同音程の連続ノートへ分割される。Pyxel側でノート境界に約1msの補間が入るので
  完全なタイではない（仕様として許容済み）。
- **空白セル（channels内のnull）**: 1小節（16列）の休符。書き出し時は曲ごとに1つの
  休符サウンドに変換され、64枠を1つ消費する。チャンネル末尾のnullは常に切り詰める。
- **移調（transpose）**: 非破壊。音域(0〜59)外は端へクランプ（書き出しダイアログで警告表示）。
- **パターンは曲ごとに所有**（曲間共有なし・曲内はID参照で共有）。IDは曲ごとに独立採番
  なので、書き出し割り当てのキーは `songId/patternId`。
- 制約はUIで「構造的に不可能」にするのが基本方針。事後エラーは64枠超過のみ。

## 開発コマンド

```sh
node --test test/*.test.js        # ユニットテスト（変更のたびに実行）
uv run pyxel-test <file.pyxres>   # 実機プレイヤーで耳確認（ウィンドウが開く）
```

- ブラウザ確認はプレビューサーバ（.claude/launch.json の `static`）を使う。
  **注意**: ブラウザが古いJSをキャッシュして「修正が効かない」ように見える事故が
  過去に複数回発生。サーバはno-store付きだが、挙動が不可解なときはまずキャッシュを疑い、
  `location.reload()` ではなくポート変更やno-store fetchで実行中コードの鮮度を確認する。
- Pyxel実機検証はGUI必須（SDLのdummyビデオドライバはOpenGL非対応で `pyxel.init()` が落ちる）。
  ヘッドレスCI上では実行できないので、GitHub Actionsではユニットテストのみ実行している。

## デプロイ

mainへのpushで [.github/workflows/deploy-pages.yml](.github/workflows/deploy-pages.yml) が
テスト→GitHub Pagesデプロイを行う。公開物は index.html / css / js のみ
（設計書・tools・testは公開しない）。

## テスト方針

- 新機能はテストファースト（Model層のロジックはnode:testで先に書く）。
- UIはプレビューサーバ上で合成イベント（`dispatchEvent`）による動作検証を行い、
  スクリーンショットで見た目を確認する。
- 書き出しに影響する変更は tools/make_test_pyxres.js と tools/verify_with_pyxel.py を
  更新して実機アサーションを増やす。
