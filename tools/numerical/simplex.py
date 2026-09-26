"""Simplex scaling (static): iterations against problem size for 500 random linear programs.

Data: data/simplex_runs.json, a seeded re-run (SciPy 1.10.1, the last with method='simplex') of
335Assignment1.py in github.com/Boaxes/Simplex-Scaling-Analysis: random A (m x n, up to 74 x 74), b, c;
maximise c^T x subject to Ax <= b, x >= 0. status 0 = solved (bounded), 3 = unbounded.
"""
import json

import numpy as np

import style as S

R = json.loads((S.HERE / "data" / "simplex_runs.json").read_text())["runs"]


def main():
    fig, ax = S.figure()
    groups = [("bounded", 0, S.BLUE), ("unbounded", 3, S.RED)]
    stats = {}
    for label, st, col in groups:
        pts = np.array([(r["m"] + r["n"], r["nit"]) for r in R if r["status"] == st])
        ax.scatter(pts[:, 0], pts[:, 1], s=34, color=col, alpha=0.72, edgecolor=S.PAPER, lw=0.6, zorder=3)
        stats[label] = (len(pts), pts[:, 1].mean())
    ax.set_xlim(0, 150)
    ax.set_ylim(-25, 800)
    ax.set_xticks([0, 50, 100, 150])
    ax.set_yticks([0, 200, 400, 600, 800])
    ax.set_xlabel("problem size  (constraints + variables)")
    ax.set_ylabel("simplex iterations")
    S.note(ax, 8, 700, "bounded", S.BLUE, size=19)
    S.note(ax, 8, 650, f"mean {stats['bounded'][1]:.0f} iterations", S.BLUE, size=14)
    S.note(ax, 8, 560, "unbounded", S.RED, size=19)
    S.note(ax, 8, 510, f"mean {stats['unbounded'][1]:.0f} iterations", S.RED, size=14)
    S.save_png(fig, "ne-simplex.png")
    print({k: (n, round(m)) for k, (n, m) in stats.items()}, "total", len(R))


if __name__ == "__main__":
    main()
