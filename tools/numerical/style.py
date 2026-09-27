"""Shared look for the Numerical Experiments prints in the portfolio book.

Each print is one idea at a glance: a single chart, no title (the page types it), direct labels
instead of legends, and type big enough to read once the 900 px square is taped onto a page at
about 440 px. Book fonts (Special Elite, Lora) and palette. Output goes to public/portfolio/.

Fonts in fonts/: Special Elite (Apache License 2.0) and Lora (SIL Open Font License 1.1).

    python3 -m venv .venv && .venv/bin/pip install numpy matplotlib imageio-ffmpeg
    .venv/bin/python roots.py      (and simplex.py, cosine.py, least_squares.py, dfp.py, armijo.py)
"""
from pathlib import Path
import shutil
import subprocess

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib import font_manager
import numpy as np

HERE = Path(__file__).resolve().parent
OUT = HERE.parent.parent / "public" / "portfolio"

for f in (HERE / "fonts").glob("*.ttf"):
    font_manager.fontManager.addfont(str(f))

SIZE_IN = 5.0
DPI = 180
PX = int(SIZE_IN * DPI)  # 900
VIDEO_PX = 440  # the MP4s: just over the largest print they fill on the page (430 px of 1024)

PAPER = "#f7f2e6"   # print paper, a touch lighter than the page
INK = "#2a2622"
INK2 = "#5a544b"
INK3 = "#8c8475"
GRID = "#e2d9c3"
RED = "#8d3b2f"
BLUE = "#34505c"
OCHRE = "#b07d2b"
MOSS = "#5f7a3a"
TYPE = "Special Elite"
SERIF = "Lora"

plt.rcParams.update({
    "figure.figsize": (SIZE_IN, SIZE_IN),
    "figure.dpi": DPI,
    "savefig.dpi": DPI,
    "figure.facecolor": PAPER,
    "axes.facecolor": PAPER,
    "savefig.facecolor": PAPER,
    "font.family": TYPE,
    "font.size": 15,
    "mathtext.fontset": "custom",
    "mathtext.rm": SERIF,
    "mathtext.it": f"{SERIF}:italic",
    "text.color": INK,
    "axes.edgecolor": INK2,
    "axes.labelcolor": INK2,
    "axes.linewidth": 1.2,
    "axes.labelsize": 15,
    "axes.spines.top": False,
    "axes.spines.right": False,
    "axes.grid": True,
    "grid.color": GRID,
    "grid.linewidth": 1.0,
    "xtick.color": INK2,
    "ytick.color": INK2,
    "xtick.labelsize": 14,
    "ytick.labelsize": 14,
    "xtick.major.size": 0,
    "ytick.major.size": 0,
    "xtick.major.pad": 6,
    "ytick.major.pad": 6,
    "lines.linewidth": 3.4,
    "lines.solid_capstyle": "round",
})

# every print uses the same plot area, so they sit together on the page
AXES = [0.16, 0.14, 0.78, 0.8]


def figure():
    fig = plt.figure(figsize=(SIZE_IN, SIZE_IN), dpi=DPI)
    return fig, fig.add_axes(AXES)


def note(ax, x, y, text, color=INK, size=15, ha="left", va="center", italic=False, **kw):
    """A label typed straight onto the chart (in data coordinates unless a transform is given)."""
    return ax.text(x, y, text, color=color, fontsize=size, ha=ha, va=va,
                   family=SERIF if italic else TYPE, style="italic" if italic else "normal", **kw)


def save_png(fig, name):
    OUT.mkdir(parents=True, exist_ok=True)
    path = OUT / name
    fig.savefig(path, dpi=DPI)  # exactly PX x PX: no tight bbox
    plt.close(fig)
    print("wrote", path)


def ffmpeg():
    exe = shutil.which("ffmpeg")
    if exe:
        return exe
    import imageio_ffmpeg
    return imageio_ffmpeg.get_ffmpeg_exe()


class Recorder:
    """Pipes a fixed-size figure's frames into ffmpeg as an H.264 MP4 (plays everywhere, Safari included,
    and draws into the book's page canvas). The last frame is also saved as the poster JPEG."""

    def __init__(self, fig, name, fps=30):
        self.fig, self.fps, self.name = fig, fps, name
        OUT.mkdir(parents=True, exist_ok=True)
        w, h = fig.canvas.get_width_height()
        assert (w, h) == (PX, PX), (w, h)
        self.raw = OUT / (name + ".rgb")
        self.fh = open(self.raw, "wb")
        self.n = 0

    def grab(self, repeat=1):
        self.fig.canvas.draw()
        a = np.asarray(self.fig.canvas.buffer_rgba())[:, :, :3].tobytes()
        for _ in range(repeat):
            self.fh.write(a)
            self.n += 1

    def finish(self):
        self.fh.close()
        mp4 = OUT / (self.name + ".mp4")
        subprocess.run([ffmpeg(), "-y", "-loglevel", "error", "-f", "rawvideo", "-pix_fmt", "rgb24",
                        "-s", f"{PX}x{PX}", "-r", str(self.fps), "-i", str(self.raw),
                        # (encoded at the size it's drawn on the page, not the 900 px it's laid out at: every
                        # frame is copied into a page texture, and in Safari that costs by the pixel)
                        "-vf", f"scale={VIDEO_PX}:{VIDEO_PX}:flags=lanczos",
                        "-c:v", "libx264", "-preset", "slow", "-crf", "18", "-pix_fmt", "yuv420p",
                        "-movflags", "+faststart", "-an", str(mp4)], check=True)
        self.raw.unlink()
        self.fig.savefig(OUT / (self.name + "-poster.jpg"), dpi=DPI, pil_kwargs={"quality": 90})
        plt.close(self.fig)
        print(f"wrote {mp4} ({self.n} frames, {self.n / self.fps:.1f} s) + poster")


def ease(u):
    u = min(max(u, 0.0), 1.0)
    return u * u * (3 - 2 * u)
