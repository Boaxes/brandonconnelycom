"""DFP vs gradient descent (animated): two optimisers in the Rosenbrock valley.

Same algorithms and constants as rosenbrock_optimization.py in
github.com/Boaxes/DFP-vs-Gradient-Descent-on-Rosenbrock: f = (x2 - x1^2)^2 + (1 - x1)^2, Armijo
backtracking (alpha0 = 2, c = 0.5, rho = 0.95), stop at ||grad f|| < 1e-3. From (-4, 4) gradient descent
takes 33 iterations and DFP 14 (from (-4, -4), 38 and 21). One iteration every five frames.
"""
import numpy as np
from matplotlib.colors import LinearSegmentedColormap, LogNorm

import style as S


def f(x):
    return (x[1] - x[0] ** 2) ** 2 + (1 - x[0]) ** 2


def grad_f(x):
    return np.array([-4 * (x[1] - x[0] ** 2) * x[0] + 2 * (x[0] - 1), 2 * (x[1] - x[0] ** 2)])


def armijo(x, p, grad, alpha=2, c=0.5, rho=0.95):
    while f(x + alpha * p) > f(x) + c * alpha * np.dot(grad, p):
        alpha = rho * alpha
    return alpha


def gradient_descent(x):
    grad, path = grad_f(x), [x.copy()]
    while np.linalg.norm(grad) >= 1e-3:
        p = -grad
        x = x + armijo(x, p, grad) * p
        grad = grad_f(x)
        path.append(x.copy())
    return np.array(path)


def dfp(x):
    H, grad, path = np.eye(2), grad_f(x), [x.copy()]
    while np.linalg.norm(grad) >= 1e-3:
        p = -H @ grad
        x_new = x + armijo(x, p, grad) * p
        grad_new = grad_f(x_new)
        s, y = x_new - x, grad_new - grad
        if np.dot(s, y) != 0:
            H = H + np.outer(s, s) / np.dot(s, y) - (H @ np.outer(y, y) @ H) / (y @ H @ y)
        x, grad = x_new, grad_new
        path.append(x.copy())
    return np.array(path)


START = np.array([-4.0, 4.0])
GD, DFP = gradient_descent(START.copy()), dfp(START.copy())
CHECK = [len(p) - 1 for p in (gradient_descent(np.array([-4.0, -4.0])), dfp(np.array([-4.0, -4.0])))]


def partial(path, t):
    k = int(np.floor(t))
    if k >= len(path) - 1:
        return path, path[-1]
    head = path[k] + S.ease(t - k) * (path[k + 1] - path[k])
    return np.vstack([path[: k + 1], head]), head


def build():
    fig, ax = S.figure()
    ax.set_position([0.16, 0.14, 0.78, 0.72])
    X1, X2 = np.meshgrid(np.linspace(-5.5, 3.5, 600), np.linspace(-2, 7, 600))
    Z = (X2 - X1 ** 2) ** 2 + (1 - X1) ** 2
    cmap = LinearSegmentedColormap.from_list("paper", [S.PAPER, "#ede3cc", "#dfd0ae", "#cdb991"])
    levels = np.geomspace(0.02, 3000, 22)
    ax.contourf(X1, X2, Z, levels=levels, cmap=cmap, norm=LogNorm(), extend="both", zorder=0)
    ax.contour(X1, X2, Z, levels=levels[::2], colors=S.INK3, linewidths=0.6, alpha=0.4, zorder=1)
    ax.grid(False)
    ax.set_xlim(-5, 3)
    ax.set_ylim(-1.5, 6.5)
    ax.set_xticks([-4, -2, 0, 2])
    ax.set_yticks([0, 2, 4, 6])
    ax.set_xlabel("$x_1$")
    ax.set_ylabel("$x_2$")
    ax.plot(*START, "o", ms=12, mfc=S.PAPER, mec=S.INK, mew=2.2, zorder=6)
    S.note(ax, START[0], START[1] - 0.5, "start", S.INK, size=15, ha="center")
    ax.plot(1, 1, marker="*", ms=22, color=S.INK, mec=S.PAPER, mew=1, zorder=7)
    S.note(ax, 1.35, 0.55, "minimum", S.INK, size=15)
    arts = []
    for col in (S.BLUE, S.RED):
        (ln,) = ax.plot([], [], color=col, lw=3, zorder=4, solid_joinstyle="round")
        (hd,) = ax.plot([], [], "o", ms=11, color=col, mec=S.PAPER, mew=1.6, zorder=5)
        arts.append((ln, hd))
    counters = (fig.text(0.16, 0.9, "", fontsize=19, color=S.BLUE, ha="left", va="center"),
                fig.text(0.94, 0.9, "", fontsize=19, color=S.RED, ha="right", va="center"))
    return fig, arts, counters


def render(arts, counters, t, fade=1.0):
    for (ln, hd), path, ct, name in zip(arts, (GD, DFP), counters, ("gradient descent", "DFP")):
        pts, head = partial(path, t)
        ln.set_data(pts[:, 0], pts[:, 1])
        hd.set_data([head[0]], [head[1]])
        ln.set_alpha(fade)
        hd.set_alpha(fade)
        ct.set_text(f"{name}  {min(int(t), len(path) - 1)}")


def main():
    fig, arts, counters = build()
    rec = S.Recorder(fig, "ne-dfp")
    per_iter = 5
    n_max = max(len(GD), len(DFP)) - 1
    render(arts, counters, 0)
    rec.grab(18)
    for fr in range(n_max * per_iter + 1):
        render(arts, counters, fr / per_iter)
        rec.grab()
    rec.grab(100)                          # hold on the result
    for fr in range(14):                   # the paths fade, so the loop restarts cleanly
        render(arts, counters, n_max, 1 - S.ease(fr / 13))
        rec.grab()
    render(arts, counters, n_max)          # (the poster keeps the finished paths)
    rec.finish()
    print("from (-4, 4): GD", len(GD) - 1, "DFP", len(DFP) - 1, "| from (-4, -4):", CHECK)


if __name__ == "__main__":
    main()
