"""Pyxel実機でのpyxres読み込み検証（設計書§9 フェーズ1完了基準）。

使い方:
    node tools/make_test_pyxres.js /tmp/two_songs.pyxres
    python tools/verify_with_pyxel.py /tmp/two_songs.pyxres

注意: pyxel.init()がウィンドウを開くため、GUIのある環境で実行すること。
"""
import sys

import pyxel


def main(pyxres_path: str) -> None:
    pyxel.init(64, 64)
    pyxel.load(pyxres_path)

    # sounds検証（make_test_pyxres.jsの登場順割り当て: p1→0, p2→1, p3→2）
    s0 = pyxel.sounds[0]
    assert list(s0.notes) == [24, -1, 26, 28], list(s0.notes)
    assert list(s0.tones) == [1], list(s0.tones)
    assert list(s0.volumes) == [6], list(s0.volumes)
    assert s0.speed == 20, s0.speed
    s1 = pyxel.sounds[1]
    assert list(s1.notes) == [12, 12, -1, 12], list(s1.notes)
    assert list(s1.effects) == [3], list(s1.effects)
    s2 = pyxel.sounds[2]
    assert list(s2.notes) == [33, 35], list(s2.notes)
    assert s2.speed == 40, s2.speed
    assert list(pyxel.sounds[3].notes) == []  # 未使用枠は空エントリ

    # musics検証（パターン共有がindex参照として保たれていること）
    m0 = [list(ch) for ch in pyxel.musics[0].seqs]
    m1 = [list(ch) for ch in pyxel.musics[1].seqs]
    assert m0 == [[0, 1, 0], [2]], m0
    assert m1 == [[1], [0]], m1
    assert [list(ch) for ch in pyxel.musics[2].seqs] == []  # 空トラック

    pyxel.playm(0)  # 再生開始がエラーなく通ること
    print(f"PASS: pyxel.load() + playm() 正常（Pyxel {pyxel.VERSION}）")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        print(__doc__)
        sys.exit(1)
    main(sys.argv[1])
