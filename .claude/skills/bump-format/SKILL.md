---
name: bump-format
description: 内部プロジェクトフォーマット（Project/Song/Patternのスキーマ）を変更するときの手順。フィールドの追加・削除・意味変更・値表現の変更をする場合に必ず使用。既存ユーザーのlocalStorage・保存済みJSONを壊さないためのチェックリスト。
---

# 内部フォーマットの変更手順

内部モデルはlocalStorageと`.json`ファイルに永続化されており、ユーザーの手元には
過去バージョンのデータが残っている。スキーマを変えるときは必ずこの手順で
バージョンを上げ、マイグレーションを追加する。

## 手順

1. **js/model.js の `FORMAT_VERSION` を +1** し、ファイル冒頭のコメントに
   「vN: 何を変えたか」を1行追記する。

2. **`migrateV(N-1)toVN(data)` を追加**し、`migrateProject` のチェーンに1行足す:
   ```js
   if (project.formatVersion === N-1) project = migrateV(N-1)toVN(project);
   ```
   - 旧データに新フィールドの既定値を与える／旧表現を新表現へ変換する
   - 情報を失う変換は避ける（v1→v2の「曲間共有→複製」のように、意味が保てるなら形を変えてよい）
   - 形が互換でも意味が変わるならバージョンは上げる（旧アプリが新データを
     誤読しないようにするため。v4→v5が前例）

3. **スキーマ本体を変更**（createProject / createSong / createPattern、
   validatePattern / validateSong、関連ロジック）。

4. **テストを更新・追加**:
   - 既存テストの `formatVersion` 期待値を新番号へ（model.test.js と storage.test.js の両方にある）
   - 新しいマイグレーションのテスト（旧形のフィクスチャ → 新フィールドの検証）を追加
   - v1フィクスチャからの全チェーンが通ることは既存テストが担保する

5. **README.md の「データモデル」節**の図とバージョン番号を更新する。
   ヘルプダイアログ（index.html）に影響する制約変更があればそこも更新。

6. **書き出しへ影響する場合**は `/verify-pyxres` の手順3（フィクスチャ更新）も行う。

## 動作確認

- `node --test test/*.test.js` 全パス
- プレビューで旧データからの移行を確認: ブラウザのlocalStorageに旧バージョンの
  プロジェクトが残った状態でリロードし、`App.getState().project.formatVersion` が
  新番号になり内容が保たれていること

## 過去のバージョン履歴（マイグレーションの意図）

| 版 | 変更 |
| --- | --- |
| v1 | 初期。グローバルpatterns＋pattern.speed |
| v2 | 曲がパターンを内包（曲間共有→複製）。speed→曲のbpm＋rateMode |
| v3 | 音価（lengths）追加 |
| v4 | 曲にtranspose追加 |
| v5 | channelsをグリッド化（null=空白セル許容。形は互換） |
