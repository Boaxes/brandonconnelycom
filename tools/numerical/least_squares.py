"""Least squares (static): one model fitted two ways, normal equations and a hand-built QR.

Port of least_squares_regression.m in github.com/Boaxes/Least-Squares-Curve-Fitting (MATLAB): fit
y = a ln x + b cos x + c e^x to ten points by the normal equations, and by a reduced QR factorisation
built from three Householder reflectors. The README's coefficients: a = -1.0410, b = -1.2613,
c = 0.0307, RMSE 0.30423. Also checks the repo's Gauss-Newton power-law fit (gauss_newton.m).
"""
import numpy as np

import style as S

x = np.array([0.24, 0.65, 0.95, 1.24, 1.73, 2.01, 2.23, 2.52, 2.77, 2.99])
y = np.array([0.23, -0.26, -1.10, -0.45, 0.27, 0.10, -0.29, 0.24, 0.56, 1.00])
A = np.column_stack([np.log(x), np.cos(x), np.exp(x)])


def householder_qr(M):
    m, n = M.shape
    Q, R = np.eye(m), M.copy()
    for k in range(n):
        v = R[k:, k].copy()
        e = np.zeros_like(v)
        e[0] = np.linalg.norm(v) * -np.sign(v[0])
        v = v - e
        v /= np.linalg.norm(v)
        H = np.eye(m)
        H[k:, k:] -= 2 * np.outer(v, v)
        R = H @ R
        Q = Q @ H
    return Q, R


def gauss_newton(c=np.array([10.0, 2.0]), tol=1e-8):
    h = np.array([0.9120, 0.9860, 1.0600, 1.1300, 1.1900, 1.2600, 1.3200, 1.3800, 1.4100, 1.4900])
    w = np.array([13.7, 15.9, 18.5, 21.3, 23.5, 27.2, 32.7, 36.0, 38.6, 43.7])
    k, err = 0, np.inf
    while err > tol and k < 100:
        F = c[0] * h ** c[1] - w
        J = np.column_stack([h ** c[1], c[0] * h ** c[1] * np.log(h)])
        s = np.linalg.solve(J.T @ J, -J.T @ F)
        c, err, k = c + s, np.linalg.norm(s), k + 1
    return c, k


def main():
    x_ne = np.linalg.solve(A.T @ A, A.T @ y)
    Q, R = householder_qr(A)
    x_qr = np.linalg.solve(R[:3], Q[:, :3].T @ y)
    rmse = np.sqrt(np.mean((y - A @ x_qr) ** 2))
    digits = -np.log10(np.max(np.abs(x_ne - x_qr) / np.abs(x_qr)))

    fig, ax = S.figure()
    xx = np.linspace(0.2, 3.02, 300)
    Ap = np.column_stack([np.log(xx), np.cos(xx), np.exp(xx)])
    ax.plot(xx, Ap @ x_ne, color=S.BLUE, lw=9, alpha=0.35, solid_capstyle="round", zorder=2)
    ax.plot(xx, Ap @ x_qr, color=S.RED, lw=3, ls=(0, (5, 3)), zorder=3)
    ax.plot(x, y, "o", ms=11, color=S.INK, mec=S.PAPER, mew=1.6, zorder=5)
    ax.set_xlim(0, 3.2)
    ax.set_ylim(-1.4, 1.4)
    ax.set_xticks([0, 1, 2, 3])
    ax.set_yticks([-1, 0, 1])
    ax.set_xlabel("x")
    ax.set_ylabel("y")
    S.note(ax, 0.12, 1.2, r"$y = a\,\ln x + b\,\cos x + c\,e^{x}$", S.INK, size=17, italic=True)
    # a two-line key made of the same marks, bottom right
    for k, (label, col, kw) in enumerate([("normal equations", S.BLUE, dict(lw=9, alpha=0.35)),
                                          ("Householder QR", S.RED, dict(lw=3, ls=(0, (5, 3))))]):
        yy = -0.95 - k * 0.24
        ax.plot([1.45, 1.75], [yy, yy], color=col, solid_capstyle="round", **kw)
        S.note(ax, 1.85, yy, label, col, size=15)
    S.save_png(fig, "ne-least-squares.png")
    c, k = gauss_newton()
    print("ne", x_ne.round(4), "qr", x_qr.round(4), "agree to", round(digits, 1), "digits, RMSE", round(rmse, 5))
    print("gauss-newton", c.round(3), k, "iterations")


if __name__ == "__main__":
    main()
