"""pyxresをPyxel実機で再生するテスト用プレイヤー。

使い方:
    uv run pyxel-test <pyxresファイル>

操作:
    0-7        音楽スロットを選択して再生
    ←/→       データのあるスロット間を移動
    SPACE      再生 / 停止
    Q / ESC    終了
"""
import os
import sys

import pyxel

WIDTH = 220
HEIGHT = 140


class Player:
    def __init__(self, path: str) -> None:
        self.name = os.path.basename(path)
        pyxel.init(WIDTH, HEIGHT, title="pyxel-test", fps=30)
        pyxel.load(path)
        self.available = [i for i, m in enumerate(pyxel.musics) if len(m.seqs) > 0]
        self.slot = self.available[0] if self.available else 0
        self.playing = False
        if self.available:
            self.play(self.slot)
        pyxel.run(self.update, self.draw)

    def play(self, slot: int) -> None:
        self.slot = slot
        pyxel.playm(slot, loop=True)
        self.playing = True

    def stop(self) -> None:
        pyxel.stop()
        self.playing = False

    def move_slot(self, delta: int) -> None:
        if not self.available:
            return
        if self.slot in self.available:
            idx = (self.available.index(self.slot) + delta) % len(self.available)
        else:
            idx = 0
        self.play(self.available[idx])

    def update(self) -> None:
        if pyxel.btnp(pyxel.KEY_Q) or pyxel.btnp(pyxel.KEY_ESCAPE):
            pyxel.quit()
        if pyxel.btnp(pyxel.KEY_SPACE):
            if self.playing:
                self.stop()
            else:
                self.play(self.slot)
        if pyxel.btnp(pyxel.KEY_LEFT):
            self.move_slot(-1)
        if pyxel.btnp(pyxel.KEY_RIGHT):
            self.move_slot(1)
        for n in range(8):
            if pyxel.btnp(getattr(pyxel, f"KEY_{n}")):
                self.play(n)

    def draw(self) -> None:
        pyxel.cls(1)
        pyxel.text(6, 6, self.name, 7)
        pyxel.text(6, 16, "0-7:slot  </>:move  SPACE:play/stop  Q:quit", 5)

        # スロット一覧（データのあるスロットを明示）
        for i in range(8):
            x = 6 + i * 26
            has_data = i in self.available
            selected = i == self.slot
            color = 10 if selected else (7 if has_data else 5)
            box = 9 if selected else (13 if has_data else 2)
            pyxel.rectb(x, 28, 22, 14, box)
            pyxel.text(x + 4, 32, str(i), color)
            if has_data:
                pyxel.text(x + 10, 32, f"{len(pyxel.musics[i].seqs)}ch", color)

        status = "PLAYING" if self.playing else "STOPPED"
        pyxel.text(6, 50, f"music {self.slot}: {status}", 10 if self.playing else 8)

        # チャンネルごとの再生位置（sound番号とnote位置）
        for ch in range(4):
            pos = pyxel.play_pos(ch)
            if pos is None:
                pyxel.text(6, 62 + ch * 10, f"ch{ch}: -", 5)
            else:
                snd, note = pos  # 新しめのPyxelはfloatを返すため整数へ丸めて表示
                pyxel.text(6, 62 + ch * 10, f"ch{ch}: sound {int(snd):2d}  note {int(note):3d}", 7)

        if not self.available:
            pyxel.text(6, 110, "no music data in this file", 8)


def main() -> None:
    if len(sys.argv) != 2:
        print(__doc__)
        raise SystemExit(1)
    path = sys.argv[1]
    if not os.path.isfile(path):
        print(f"ファイルが見つかりません: {path}")
        raise SystemExit(1)
    Player(path)
