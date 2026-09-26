"""Polynomial interpolation (animated): cos(x) everywhere from nine points.

Port of cosine_interpolation.m in github.com/Boaxes/Polynomial-Interpolation-and-Cubic-Splines (MATLAB):
the smallest n with (pi/4)^n / (n! 2^(2n-1)) < 1e-10 is 9; Newton divided differences on 9 Chebyshev
nodes over [0, pi/2]; cosine's symmetry and period carry that one polynomial to every real x. The worst
error over [-5, 10] is 9.1e-10 (4.4e-9 with evenly spaced nodes). Reproduces the README's error table.
"""
import math

import numpy as np

import style as S

A, B, TOL = 0.0, np.pi / 2, 1e-10
n = 1
while (np.pi / 4) ** n / (math.factorial(n) * 2 ** (2 * n - 1)) >= TOL:
    n += 1


def divided_differences(xn):
    c = np.cos(xn).astype(float)
    for j in range(1, n):
        c[j:] = (c[j:] - c[j - 1:-1]) / (xn[j:] - xn[: n - j])
    return c


def newton_eval(x, xn, c):
    v = c[-1] * np.ones_like(x, dtype=float)
    for i in range(n - 2, -1, -1):
        v = v * (x - xn[i]) + c[i]
    return v


def cos_approx(x, xn, c):
    xm = np.mod(x, 2 * np.pi)
    loc = lambda z: newton_eval(z, xn, c)
    return np.select([xm <= np.pi / 2, xm <= np.pi, xm <= 1.5 * np.pi],
                     [loc(xm), -loc(np.pi - xm), -loc(xm - np.pi)], loc(2 * np.pi - xm))


theta = np.arange(1, 2 * n, 2) * np.pi / (2 * n)
X_CHEB = (A + B) / 2 + (B - A) / 2 * np.cos(theta)
X_EVEN = np.linspace(A, B, n)
C_CHEB, C_EVEN = divided_differences(X_CHEB), divided_differences(X_EVEN)
XX = np.linspace(-5, 10, 3001)
P = cos_approx(XX, X_CHEB, C_CHEB)
WORST = np.abs(P - np.cos(XX)).max()
WORST_EVEN = np.abs(cos_approx(XX, X_EVEN, C_EVEN) - np.cos(XX)).max()


def build():
    fig, ax = S.figure()
    ax.set_xlim(-5, 10)
    ax.set_ylim(-1.3, 1.55)
    ax.grid(False)
    ax.set_yticks([-1, 0, 1])
    ax.set_xticks([-np.pi, 0, np.pi, 2 * np.pi, 3 * np.pi])
    ax.set_xticklabels([r"$-\pi$", "0", r"$\pi$", r"$2\pi$", r"$3\pi$"])
    ax.set_xlabel("x")
    ax.axvspan(0, np.pi / 2, color=S.OCHRE, alpha=0.2, lw=0, zorder=0)
    ax.axhline(0, color=S.INK3, lw=0.8, zorder=1)
    ax.plot(XX, np.cos(XX), color=S.INK3, lw=1.3, ls=(0, (3, 3)), zorder=2)
    (local,) = ax.plot([], [], color=S.RED, zorder=4)
    (pen,) = ax.plot([], [], color=S.RED, zorder=4)
    (tip,) = ax.plot([], [], "o", ms=10, color=S.RED, mec=S.PAPER, mew=1.6, zorder=6)
    nodes = ax.scatter(X_CHEB, np.cos(X_CHEB), s=60, color=S.INK, edgecolor=S.PAPER, lw=1.2, zorder=7)
    home = S.note(ax, np.pi / 4, 1.36, f"{n} points", S.INK, size=16, ha="center")
    worst = S.note(ax, 9.8, -1.17, f"worst error {WORST:.1e}".replace("e-10", r" $\times 10^{-10}$"),
                   S.RED, size=15, ha="right", alpha=0)
    return fig, dict(local=local, pen=pen, tip=tip, nodes=nodes, home=home, worst=worst)


def render(a, t_nodes, t_local, t_pen, t_end):
    a["nodes"].set_alpha(t_nodes)
    a["home"].set_alpha(t_nodes)
    inside = (XX >= 0) & (XX <= np.pi / 2)
    xs, ps = XX[inside], P[inside]
    k = int(len(xs) * t_local)
    a["local"].set_data(xs[:k], ps[:k])
    j = int((len(XX) - 1) * t_pen)
    a["pen"].set_data(XX[: j + 1] if t_pen > 0 else [], P[: j + 1] if t_pen > 0 else [])
    a["tip"].set_data(([XX[j]], [P[j]]) if 0 < t_pen < 1 else ([], []))
    a["worst"].set_alpha(t_end)


def main():
    fig, a = build()
    rec = S.Recorder(fig, "ne-cosine")
    render(a, 0, 0, 0, 0)
    rec.grab(15)
    for fr in range(24):                  # the nine points appear
        render(a, S.ease(fr / 23), 0, 0, 0)
        rec.grab()
    for fr in range(30):                  # the polynomial through them, on [0, pi/2]
        render(a, 1, S.ease(fr / 29), 0, 0)
        rec.grab()
    rec.grab(12)
    for fr in range(200):                 # carried across every x by symmetry
        render(a, 1, 1, fr / 199, 0)
        rec.grab()
    for fr in range(18):
        render(a, 1, 1, 1, S.ease(fr / 17))
        rec.grab()
    rec.grab(80)
    rec.finish()
    print("n", n, "worst", f"{WORST:.2e}", "evenly spaced", f"{WORST_EVEN:.2e}")


if __name__ == "__main__":
    main()
