"""Armijo line search (static): iterations for every setting of its two parameters.

From github.com/Boaxes/Armijo-vs-Newton-vs-Golden-Section (armijo_search.py): gradient descent with
Armijo backtracking on f(x) = (x - 1)^2 + cos^2(x^2 / 2) (as in the code; the README writes cos^2(x/2)),
x0 = 4, direction -sign(f'), alpha0 = 1, stop at |f'| < 1e-6. The sweep covers all 99 x 99 pairs of
c (sufficient decrease) and r (step shrink) in [0.01, 0.99], capped at 100 iterations. The repo's
default (0.2, 0.8) takes 24. Also checks Newton (5) and golden section (27), which the repo compares.
"""
import math

import numpy as np
from matplotlib.colors import LinearSegmentedColormap, LogNorm

import style as S

CAP = 100


def obj(x):
    return (x - 1) ** 2 + math.cos(0.5 * x * x) ** 2


def grad(x):
    return 2 * (x - 1) - 2 * x * math.cos(0.5 * x * x) * math.sin(0.5 * x * x)


def hess(x):
    s, c = math.sin(0.5 * x * x), math.cos(0.5 * x * x)
    return 2 - 2 * s * c - 2 * x * x * (c * c - s * s)


def armijo(c=0.2, r=0.8, x=4.0):
    n, fx = 0, obj(x)
    while abs(grad(x)) >= 1e-6:
        if n >= CAP:
            return None
        g = grad(x)
        d = -math.copysign(1.0, g)
        a, k = 1.0, 0
        while obj(x + a * d) > fx + c * a * g * d:
            a *= r
            k += 1
            if k > 2000:
                return None
        x += a * d
        fx = obj(x)
        n += 1
    return n


def newton(x=2.0, tol=1e-8):
    for k in range(1, 21):
        x_next = x - grad(x) / hess(x)
        if abs(x_next - x) < tol:
            return k, x_next
        x = x_next
    return 20, x


def golden(a=0.0, b=3.0, tol=1e-5):
    gr = (math.sqrt(5) + 1) / 2
    c, d, k = b - (b - a) / gr, a + (b - a) / gr, 0
    while abs(b - a) > tol:
        if obj(c) < obj(d):
            b = d
        else:
            a = c
        c, d, k = b - (b - a) / gr, a + (b - a) / gr, k + 1
    return k, (a + b) / 2


CS = np.linspace(0.01, 0.99, 99)
RS = np.linspace(0.01, 0.99, 99)


def main():
    G = np.full((len(RS), len(CS)), np.nan)
    for i, r in enumerate(RS):
        for j, c in enumerate(CS):
            n = armijo(c, r)
            if n is not None:
                G[i, j] = n
    default = int(G[np.argmin(np.abs(RS - 0.8)), np.argmin(np.abs(CS - 0.2))])
    bi, bj = np.unravel_index(np.nanargmin(G), G.shape)
    best = int(G[bi, bj])
    never = float(np.isnan(G).mean())

    fig, ax = S.figure()
    # leave room on the right for the scale
    ax.set_position([0.16, 0.14, 0.66, 0.8])
    cmap = LinearSegmentedColormap.from_list("ink", ["#f1e6c9", "#dcbb7e", S.OCHRE, S.RED, "#4a1f19"])
    cmap.set_bad((0, 0, 0, 0))
    ax.fill_between([0, 1], 0, 1, hatch="///", facecolor=S.PAPER, edgecolor=S.INK3, lw=0, zorder=0)
    im = ax.imshow(np.ma.masked_invalid(G), origin="lower", extent=(0.005, 0.995, 0.005, 0.995), aspect="auto",
                   cmap=cmap, norm=LogNorm(vmin=5, vmax=100), interpolation="nearest", zorder=1)
    ax.grid(False)
    ax.set_xlim(0, 1)
    ax.set_ylim(0, 1)
    ax.set_xticks([0, 0.5, 1])
    ax.set_yticks([0, 0.5, 1])
    ax.set_xticklabels(["0", "0.5", "1"])
    ax.set_yticklabels(["0", "0.5", "1"])
    ax.set_xlabel("c  (how much decrease to demand)")
    ax.set_ylabel("r  (how fast to shrink the step)")
    box = dict(boxstyle="square,pad=0.25", fc=S.PAPER, ec="none", alpha=0.92)
    ax.plot(0.2, 0.8, "o", ms=15, mfc="none", mec=S.INK, mew=2.6, zorder=3)
    S.note(ax, 0.27, 0.8, f"default: {default}", S.INK, size=16, bbox=box, zorder=4)
    ax.plot(CS[bj], RS[bi], marker="*", ms=20, color=S.INK, mec=S.PAPER, mew=1, zorder=3)
    S.note(ax, CS[bj] + 0.07, RS[bi], f"best: {best}", S.INK, size=16, bbox=box, zorder=4)
    S.note(ax, 0.97, 0.06, f"never converges ({never:.0%})", S.INK2, size=13, ha="right", bbox=box, zorder=4)
    cax = fig.add_axes([0.86, 0.14, 0.035, 0.72])
    cb = fig.colorbar(im, cax=cax)
    cb.set_ticks([5, 10, 25, 50, 100])
    cb.set_ticklabels(["5", "10", "25", "50", "100"])
    cb.outline.set_visible(False)
    cb.ax.tick_params(labelsize=13, colors=S.INK2, length=0)
    fig.text(0.94, 0.955, "iterations", fontsize=14, color=S.INK2, ha="right", va="bottom")
    S.save_png(fig, "ne-armijo.png")
    kn, xn = newton()
    kg, xg = golden()
    print("default", default, "best", best, "at", (round(CS[bj], 2), round(RS[bi], 2)), "never", f"{never:.1%}")
    print("newton", kn, round(xn, 5), "golden", kg, round(xg, 5))


if __name__ == "__main__":
    main()
