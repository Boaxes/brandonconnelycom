"""Root-finding convergence (animated): four methods race to the same root.

Port of convergence_comparison.m in github.com/Boaxes/Root-Finding-Convergence-Analysis (MATLAB): the root
r = 1 of f(x) = x^4 - 10x^3 + 35x^2 - 50x + 24, stopping at |x_n - r| < 1e-6. Newton from 0.5; secant
from 0 and 0.5; false position on [0, 1.5]; fixed-point iteration g(x) = (x^4 - 10x^3 + 35x^2 + 24)/50
from 0.5. They finish in 5, 7, 50 and 97 iterations.
"""
import numpy as np

import style as S

f = lambda x: x ** 4 - 10 * x ** 3 + 35 * x ** 2 - 50 * x + 24
df = lambda x: 4 * x ** 3 - 30 * x ** 2 + 70 * x - 50
g = lambda x: (x ** 4 - 10 * x ** 3 + 35 * x ** 2 + 24) / 50
r, TOL = 1.0, 1e-6


def run(step, x):
    xs = [x]
    while abs(xs[-1] - r) >= TOL:
        xs.append(step(xs))
    return xs


def newton(xs):
    return xs[-1] - f(xs[-1]) / df(xs[-1])


def fixed_point(xs):
    return g(xs[-1])


def secant_run(x0=0.0, x1=0.5):
    xs, prev = [x1], x0
    while abs(xs[-1] - r) >= TOL:
        x = xs[-1]
        xs.append(x - f(x) * (x - prev) / (f(x) - f(prev)))
        prev = x
    return xs


def false_position_run(a=0.0, b=1.5):
    xs = [a]
    while abs(xs[-1] - r) >= TOL:
        x = (a * f(b) - b * f(a)) / (f(b) - f(a))
        xs.append(x)
        if f(a) * f(x) < 0:
            b = x
        else:
            a = x
    return xs


METHODS = [
    ("Newton", run(newton, 0.5), S.RED),
    ("secant", secant_run(), S.OCHRE),
    ("false position", false_position_run(), S.BLUE),
    ("fixed point", run(fixed_point, 0.5), S.MOSS),
]
LOGE = [np.log10(np.maximum(np.abs(np.array(xs) - r), 1e-12)) for _, xs, _ in METHODS]
NMAX = max(len(e) for e in LOGE) - 1


def at(le, t):
    n = len(le) - 1
    if t >= n:
        return le[-1], True
    k = int(np.floor(t))
    u = S.ease(t - k)
    return le[k] + (le[k + 1] - le[k]) * u, False


def build():
    fig, ax = S.figure()
    ax.set_yscale("log")
    ax.set_xlim(0, NMAX + 4)
    ax.set_ylim(1e-10, 3)
    ax.set_yticks([1, 1e-5, 1e-10])
    ax.set_yticklabels(["1", "$10^{-5}$", "$10^{-10}$"])
    ax.set_xticks([0, 25, 50, 75, 100])
    ax.minorticks_off()
    ax.set_xlabel("iterations")
    ax.set_ylabel("distance from the root")
    ax.axhline(TOL, color=S.INK2, lw=1.4, ls=(0, (5, 4)), zorder=1)
    S.note(ax, 58, 10 ** -5.6, "tolerance", S.INK2, size=13, italic=True)
    arts = []
    for i, ((name, xs, col), le) in enumerate(zip(METHODS, LOGE)):
        (ln,) = ax.plot([], [], color=col, zorder=3)
        (hd,) = ax.plot([], [], "o", ms=10, color=col, mec=S.PAPER, mew=1.6, zorder=4)
        n = len(le) - 1
        if n < 20:
            # the two fast ones: name and count beside where they finish, kept apart
            labs = [S.note(ax, 10, 10 ** (le[-1] + (0.35 if i == 1 else -0.35)), f"{name}  {n}", col, size=17)]
        else:
            # the slow ones: the name set along the line, the count under its finish
            # (the angle of the straight second half: the first few iterations bow the line)
            a, b = ax.transData.transform([(n // 2, 10 ** le[n // 2]), (n, 10 ** le[-1])])
            ang = np.degrees(np.arctan2(b[1] - a[1], b[0] - a[0]))
            u = 0.55
            mx = n * u
            my = 10 ** np.interp(mx, np.arange(n + 1), le)
            # false position reads under its line (the wedge above it is narrow), fixed point over its
            under = n < 70
            labs = [S.note(ax, mx, my / 2.4 if under else my * 2.4, name, col, size=16, ha="center",
                           va="top" if under else "bottom", rotation=ang, rotation_mode="anchor"),
                    S.note(ax, n, 10 ** (le[-1] - 0.45), str(n), col, size=18, ha="center", va="top")]
        for lab in labs:
            lab.set_alpha(0)
        arts.append((ln, hd, labs))
    return fig, arts


def render(arts, t):
    for (ln, hd, labs), le in zip(arts, LOGE):
        e, done = at(le, t)
        n = len(le) - 1
        k = min(t, n)
        kk = int(np.floor(k))
        xs = list(range(kk + 1))
        ys = list(10 ** le[: kk + 1])
        if k > kk:
            xs.append(k)
            ys.append(10 ** e)
        ln.set_data(xs, ys)
        hd.set_data([k], [10 ** e])
        for lab in labs:
            lab.set_alpha(1.0 if done else 0.0)


def main():
    fig, arts = build()
    rec = S.Recorder(fig, "ne-roots")
    # slow for the first ten iterations (Newton and secant finish there), then quicker; hold the result
    ts = [0.0] * 18 + list(np.arange(0, 10, 1 / 9)) + list(np.arange(10, NMAX + 1e-9, 1 / 2.2)) + [NMAX] * 90
    for t in ts:
        render(arts, t)
        rec.grab()
    rec.finish()
    print({name: len(xs) - 1 for name, xs, _ in METHODS})


if __name__ == "__main__":
    main()
