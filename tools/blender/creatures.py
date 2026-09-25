"""Creature builders. Each returns a Blender object named after the species.
All sizes in metres, nose at +X, tail at -X, centred near origin."""
import math
from mathutils import Vector, Matrix
from lib import *  # noqa

BLACK = (0.03, 0.03, 0.04)
WHITE = (0.93, 0.93, 0.9)
GREY = (0.45, 0.47, 0.5)


def _line(x0, x1, count, z_fn=lambda u: 0.0, y_fn=lambda u: 0.0):
    return [Vector((lerp(x0, x1, i / (count - 1)), y_fn(i / (count - 1)), z_fn(i / (count - 1)))) for i in range(count)]


def body(u, nose=0.35, peak=0.4, tail_min=0.14, head_pow=0.8, tail_pow=1.1):
    """Normalised half-width along a streamlined body. 1.0 at the peak."""
    u = max(0.0, min(1.0, u))
    if u < peak:
        return nose + (1 - nose) * math.sin(math.pi / 2 * u / peak) ** head_pow
    t = (u - peak) / (1 - peak)
    return tail_min + (1 - tail_min) * math.cos(math.pi / 2 * t) ** tail_pow


# ---------------------------------------------------------------- cetaceans

def _h3(ix, iy, iz):
    n = (ix * 374761393 + iy * 668265263 + iz * 2147483647) & 0xffffffff
    n = (n ^ (n >> 13)) * 1274126177 & 0xffffffff
    return ((n ^ (n >> 16)) & 0xffff) / 65535.0


def vnoise3(x, y, z):
    """Smooth 3D value noise in 0..1."""
    ix, iy, iz = math.floor(x), math.floor(y), math.floor(z)
    fx, fy, fz = x - ix, y - iy, z - iz
    fx, fy, fz = fx * fx * (3 - 2 * fx), fy * fy * (3 - 2 * fy), fz * fz * (3 - 2 * fz)
    def l(a, b, t):
        return a + (b - a) * t
    c00 = l(_h3(ix, iy, iz), _h3(ix + 1, iy, iz), fx)
    c10 = l(_h3(ix, iy + 1, iz), _h3(ix + 1, iy + 1, iz), fx)
    c01 = l(_h3(ix, iy, iz + 1), _h3(ix + 1, iy, iz + 1), fx)
    c11 = l(_h3(ix, iy + 1, iz + 1), _h3(ix + 1, iy + 1, iz + 1), fx)
    return l(l(c00, c10, fy), l(c01, c11, fy), fz)


def mixc(a, b, t):
    t = max(0.0, min(1.0, t))
    return tuple(a[i] + (b[i] - a[i]) * t for i in range(3))


def soft(x, edge, w):
    """0 below edge-w, 1 above edge+w, smooth between. Use for anti-aliased colour boundaries."""
    return smoothstep(edge - w, edge + w, x)


def darken(c, f=0.35):
    return tuple(x * f for x in c)


def add_eyes(mb, L, prof, eye_u, z_frac, r, up=0.0):
    """Pair of dark eyes on the flanks at spine fraction eye_u. part=0.25 marks fixed dark detail."""
    rx, rt, rb, n = prof(eye_u)
    x = L / 2 - eye_u * L
    z = (rt if z_frac >= 0 else rb) * z_frac + up
    for side in (1, -1):
        sphere(mb, (x, side * rx * 0.96, z), r, (0.02, 0.02, 0.025), part=0.25, u=eye_u, seg=8, rings=5)


def cetacean(name, L, prof, dorsal, pec, fluke, color_fn, head_z=lambda u: 0.0,
             rings=16, stations=30, pec_tilt=25, notch=True, eye=(0.13, -0.1, 0.03), mouth=(0.14, 0.15, 0.03),
             subdiv=1):
    """Generic whale/dolphin body. prof(u)->(rx, rt, rb, n). dorsal: (x0,x1,h,sweep)
    pec: (x, w_root, length, sweep) fluke: (span, chord, sweep)."""
    mb = MeshBuilder()
    spine = _line(L / 2, -L / 2, 9, z_fn=head_z)
    def profile(u):
        rx, rt, rb, n = prof(u)
        return dict(rx=rx, rt=rt, rb=rb, n=n)
    sts = spine_stations(spine, profile, stations)
    loft(mb, sts, rings=rings, color_fn=color_fn)
    # final-resolution paint: species colour + mouth line + fixed dark details (eyes)
    def paint(p, u, part, n):
        if abs(part - 0.25) < 0.05:
            return (0.02, 0.02, 0.025)
        col = color_fn(p, u, part, n)
        if mouth and part < 0.2 and u < mouth[0]:
            rb = prof(u)[2]
            mz = -rb * mouth[1] + head_z(u)
            if abs(p.z - mz) < mouth[2] * L / 7 and abs(p.y) > 0.02:
                col = darken(col, 0.45)
        return col
    mb.paint = paint
    if eye:
        add_eyes(mb, L, prof, eye[0], eye[1], eye[2] * L / 7, up=head_z(eye[0]))
    # dorsal fin
    x0, x1, h, sweep = dorsal
    top_r = prof((0.5 - (x0 + x1) / 2 / L))[1]
    base_z = top_r * 0.9
    outline = [(x1, base_z - 0.1), (x0, base_z - 0.1),
               (x0 - sweep * 0.2, base_z + h * 0.6),
               (x0 - sweep, base_z + h),
               (x1 - sweep * 0.55, base_z + h * 0.45)]
    plate(mb, outline, thickness=0.09 * L / 7, color_fn=lambda p, u: color_fn(p, u, 0, Vector((0, 0, 1))),
          u_fn=lambda a, b: 0.5 - a / L)
    # pectorals
    px, w, ln, sw = pec
    rx = prof(0.5 - px / L)[0]
    rb = prof(0.5 - px / L)[2]
    for side in (1, -1):
        m = trans(px, side * rx * 0.85, -rb * 0.35) @ rot('X', -side * (90 - pec_tilt)) @ rot('Z', side * 0)  # plate in X-Z plane rotated to stick out along Y
        outline = [(w * 0.5, 0), (-w * 0.5, 0), (-w * 0.5 - sw, ln), (-sw + w * 0.05, ln * 1.02), (w * 0.35 - sw * 0.6, ln * 0.6)]
        plate(mb, outline, thickness=0.08 * L / 7, matrix=m,
              color_fn=lambda p, u: color_fn(p, u, 0.5, Vector((0, 0, -1))),
              u_fn=lambda a, b: 0.5 - px / L)
    # flukes
    span, chord, sw = fluke
    tx = -L / 2 + chord * 0.35
    for side in (1, -1):
        m = trans(tx, 0, 0) @ rot('X', side * 90)
        pts = [(chord * 0.5, 0), (-chord * 0.5, 0), (-chord * 0.5 - sw, span * 0.5), (-sw + chord * 0.1, span * 0.5)]
        if notch:
            pts = [(chord * 0.15, 0)] + pts[1:]
        plate(mb, pts, thickness=0.05 * L / 7, matrix=m,
              color_fn=lambda p, u: color_fn(p, u, 0.5, Vector((0, 0, 1))), u_fn=lambda a, b: 0.97)
    obj = mb.build(name, subdiv=subdiv)
    return finish(obj, name)


def orca():
    L = 7.0
    def prof(u):
        w = 0.62 * body(u, nose=0.42, peak=0.38, tail_min=0.2, head_pow=0.9)
        return (w * 0.95, w * 1.05, w * 1.0, 2.3)
    def color(p, u, v, n):
        x, y, z = p
        h = prof(u)[1]
        w = 0.035  # boundary softness (m)
        col = BLACK
        # saddle patch (grey) behind the dorsal fin, on the back
        sad = soft(x, -1.35, 0.12) * (1 - soft(x, -0.15, 0.12)) * soft(z, 0.35 * h, 0.08)
        col = mixc(col, GREY, sad)
        # belly / chin: white below a boundary that rises at the chin and in a lobe behind the dorsal
        belly = -0.25 * h + 0.3 * h * soft(x, 1.5, 0.25)
        lobe = smoothstep(-2.3, -1.1, x) * smoothstep(0.2, -0.8, x)
        belly += lobe * 0.55 * h
        col = mixc(col, WHITE, 1 - soft(z, belly, w))
        # eye patch: soft ellipse
        ex, ez = 2.05, 0.28
        e = ((x - ex) / 0.55) ** 2 + ((z - ez) / 0.16) ** 2
        col = mixc(col, WHITE, (1 - soft(e, 1.0, 0.25)) * soft(abs(y), 0.15, 0.05))
        return col
    return cetacean('orca', L, prof, dorsal=(0.6, -0.6, 1.8, 0.3), pec=(1.6, 1.0, 1.5, 0.35),
                    fluke=(2.4, 0.7, 0.45), color_fn=color, pec_tilt=15, eye=(0.16, -0.05, 0.03), mouth=(0.17, 0.2, 0.035), subdiv=2)


def humpback():
    L = 14.0
    DARK = (0.12, 0.13, 0.16)
    def prof(u):
        w = 1.35 * body(u, nose=0.5, peak=0.42, tail_min=0.13, head_pow=1.0)
        return (w * 1.05, w * 0.8, w * 1.15, 2.2)
    def color(p, u, v, n):
        x, y, z = p
        h = prof(u)[2]
        col = DARK
        col = mixc(col, (0.2, 0.2, 0.22), (1 - soft(u, 0.1, 0.03)) * (1 - soft(z, 0.4 * h, 0.1)))
        return mixc(col, (0.85, 0.85, 0.82), 1 - soft(z, -0.3 * h + 0.15 * abs(math.sin(x * 1.3)), 0.12))
    return cetacean('humpback', L, prof, dorsal=(-1.4, -2.8, 0.7, 0.4), pec=(3.0, 1.2, 4.8, 1.3),
                    fluke=(5.2, 1.4, 0.8), color_fn=color, pec_tilt=10, rings=18, stations=34, eye=(0.14, -0.35, 0.018), mouth=(0.24, 0.05, 0.03),
                    head_z=lambda u: -0.25 * smoothstep(0.25, 0.0, u) + 0.35 * math.exp(-((u - 0.62) / 0.12) ** 2))


def dolphin(name='dolphin_pws', L=2.3):
    """Pacific white-sided dolphin."""
    def prof(u):
        w = 0.24 * body(u, nose=0.3, peak=0.4, tail_min=0.12, head_pow=0.75)
        w *= lerp(0.5, 1.0, smoothstep(0.0, 0.07, u))  # short beak
        return (w * 0.95, w, w, 2.2)
    def color(p, u, v, n):
        x, y, z = p
        h = prof(u)[1]
        col = (0.16, 0.17, 0.2)
        stripe = (1 - soft(abs(z), 0.35 * h, 0.04)) * soft(x, -0.7, 0.1) * (1 - soft(x, 0.9, 0.1))
        col = mixc(col, (0.65, 0.68, 0.7), stripe)
        col = mixc(col, (0.7, 0.72, 0.74), (1 - soft(x, -0.7, 0.1)) * (1 - soft(z, 0.4 * h, 0.04)))
        return mixc(col, WHITE, 1 - soft(z, -0.3 * h, 0.03))
    return cetacean(name, L, prof, dorsal=(0.15, -0.2, 0.42, 0.22), pec=(0.55, 0.2, 0.5, 0.14),
                    fluke=(0.66, 0.2, 0.14), color_fn=color, pec_tilt=25, rings=14, stations=26, eye=(0.11, -0.15, 0.028), mouth=(0.13, 0.2, 0.03))


def porpoise(name='dalls_porpoise', L=2.0):
    def prof(u):
        w = 0.27 * body(u, nose=0.4, peak=0.42, tail_min=0.12, head_pow=0.85)
        return (w * 0.95, w * 0.95, w * 1.1, 2.2)
    def color(p, u, v, n):
        x, y, z = p
        h = prof(u)[2]
        return mixc(BLACK, WHITE, (1 - soft(x, 0.25, 0.05)) * (1 - soft(z, 0.05 * h + (0.25 - x) * 0.1, 0.03)))
    return cetacean(name, L, prof, dorsal=(0.05, -0.25, 0.25, 0.06), pec=(0.5, 0.18, 0.36, 0.08),
                    fluke=(0.6, 0.18, 0.12), color_fn=color, pec_tilt=25, rings=14, stations=24, eye=(0.1, -0.15, 0.028), mouth=(0.1, 0.25, 0.03))


# ---------------------------------------------------------------- fish

def fish(name, L, prof, color_fn, dorsal_outline, tail_span, tail_fork, rings=12,
         stations=22, pec=(0.35, 0.28, 0.5), anal=(0.7, 0.8, 0.2), pelvic=None, tail_upper=None,
         tail_chord=None, second_dorsal=None, eye=(0.1, 0.25, 0.05), gill=0.2, mouth=(0.07, 0.3, 0.06)):
    """Generic fish. prof(u)->(rx, rt, rb, n). dorsal_outline: list of (u, height) pairs.
    pec: (u, len, sweep-ish). anal: (u0, u1, h)."""
    mb = MeshBuilder()
    spine = _line(L / 2, -L / 2, 5)
    def profile(u):
        rx, rt, rb, n = prof(u)
        return dict(rx=rx, rt=rt, rb=rb, n=n)
    sts = spine_stations(spine, profile, stations)
    loft(mb, sts, rings=rings, color_fn=color_fn)
    def paint(p, u, part, n):
        if abs(part - 0.25) < 0.05:
            return (0.02, 0.02, 0.025)
        col = color_fn(p, u, part, n)
        if part < 0.2:
            if gill and abs(u - gill) < 0.012 and abs(p.y) > 0.01 and p.z > -prof(u)[2] * 0.6:
                col = darken(col, 0.55)
            if mouth and u < mouth[0]:
                mz = -prof(u)[2] * mouth[1]
                if abs(p.z - mz) < mouth[2] * L / 0.9 * 0.02:
                    col = darken(col, 0.5)
        return col
    mb.paint = paint
    if eye:
        add_eyes(mb, L, prof, eye[0], eye[1], eye[2] * L / 0.9 * 0.02 + 0.004)
    fin_col = lambda p, u: color_fn(p, u, 0.5, Vector((0, 0, 1)))
    ux = lambda u: L / 2 - u * L
    # dorsal
    outline = []
    for (u, h) in dorsal_outline:
        outline.append((ux(u), prof(u)[1] * 0.9 + h))
    base = [(ux(u), prof(u)[1] * 0.85) for (u, h) in reversed(dorsal_outline)]
    plate(mb, outline + base, thickness=0.02 * L, color_fn=fin_col, u_fn=lambda a, b: 0.5 - a / L)
    if second_dorsal:
        outline = [(ux(u), prof(u)[1] * 0.9 + h) for (u, h) in second_dorsal]
        base = [(ux(u), prof(u)[1] * 0.85) for (u, h) in reversed(second_dorsal)]
        plate(mb, outline + base, thickness=0.02 * L, color_fn=fin_col, u_fn=lambda a, b: 0.5 - a / L)
    # anal
    u0, u1, h = anal
    outline = [(ux(u0), -prof(u0)[2] * 0.85), (ux(u1), -prof(u1)[2] * 0.85), (ux(u1) - 0.05 * L, -prof(u1)[2] - h), (ux(u0) - 0.02 * L, -prof(u0)[2] - h * 0.5)]
    plate(mb, outline, thickness=0.02 * L, color_fn=fin_col, u_fn=lambda a, b: 0.5 - a / L)
    # pectorals
    pu, pl, ps = pec
    for side in (1, -1):
        rx = prof(pu)[0]
        m = trans(ux(pu), side * rx * 0.9, -prof(pu)[2] * 0.2) @ rot('X', -side * 60) @ rot('Z', side * 0)
        outline = [(0.03 * L, 0), (-0.03 * L, 0), (-0.06 * L - ps * pl, pl), (0.0 - ps * pl * 0.5, pl * 0.9)]
        plate(mb, outline, thickness=0.015 * L, matrix=m, color_fn=fin_col, u_fn=lambda a, b: pu)
    if pelvic:
        pu2, pl2 = pelvic
        for side in (1, -1):
            m = trans(ux(pu2), side * prof(pu2)[0] * 0.4, -prof(pu2)[2] * 0.9) @ rot('X', -side * 25) @ rot('Y', 40)
            outline = [(0.02 * L, 0), (-0.02 * L, 0), (-0.05 * L, -pl2), (0, -pl2 * 0.8)]
            plate(mb, outline, thickness=0.015 * L, matrix=m, color_fn=fin_col, u_fn=lambda a, b: pu2)
    # tail (vertical plate)
    tc = tail_chord or 0.18 * L
    tx = -L / 2 + 0.03 * L
    tu = tail_upper or tail_span
    outline = [(tx + tc * 0.2, prof(0.98)[1] * 0.9), (tx - tc, tu * 0.5), (tx - tc * (1 - tail_fork), 0.0),
               (tx - tc, -tail_span * 0.5), (tx + tc * 0.2, -prof(0.98)[2] * 0.9)]
    plate(mb, outline, thickness=0.02 * L, color_fn=fin_col, u_fn=lambda a, b: 0.5 - a / L)
    obj = mb.build(name, subdiv=1)
    return finish(obj, name)


def salmon(name='chinook', L=0.9):
    def prof(u):
        w = 0.105 * body(u, nose=0.28, peak=0.4, tail_min=0.2, head_pow=0.85)
        return (w * 0.75, w * 1.15, w * 1.0, 2.1)
    def color(p, u, v, n):
        x, y, z = p
        h = prof(u)[1]
        col = mixc((0.16, 0.26, 0.3), (0.2, 0.26, 0.28), 1 - soft(u, 0.22, 0.03))
        col = mixc(col, (0.62, 0.66, 0.66), 1 - soft(z, 0.3 * h, 0.012))
        col = mixc(col, (0.85, 0.86, 0.85), 1 - soft(z, -0.25 * h, 0.01))
        # scattered dark spots on the back
        sp = vnoise3(x * 40, y * 40, z * 40)
        return mixc(col, (0.12, 0.16, 0.18), soft(sp, 0.72, 0.03) * soft(z, 0.1 * h, 0.01))
    return fish(name, L, prof, color, dorsal_outline=[(0.38, 0.0), (0.44, 0.07), (0.56, 0.05), (0.6, 0.0)],
                tail_span=0.28, tail_fork=0.35, pec=(0.25, 0.14, 0.4), anal=(0.7, 0.82, 0.06), pelvic=(0.55, 0.08),
                second_dorsal=[(0.78, 0.0), (0.8, 0.03), (0.86, 0.02), (0.87, 0.0)])


def herring(name='herring', L=0.28):
    def prof(u):
        w = 0.032 * body(u, nose=0.22, peak=0.4, tail_min=0.18, head_pow=0.8)
        return (w * 0.6, w * 1.2, w * 1.15, 2.0)
    def color(p, u, v, n):
        x, y, z = p
        h = prof(u)[1]
        return mixc((0.2, 0.32, 0.42), (0.82, 0.86, 0.88), 1 - soft(z, 0.15 * h, 0.006))
    return fish(name, L, prof, color, dorsal_outline=[(0.42, 0.0), (0.46, 0.022), (0.56, 0.018), (0.58, 0.0)],
                tail_span=0.09, tail_fork=0.45, pec=(0.25, 0.04, 0.3), anal=(0.7, 0.85, 0.014), rings=10, stations=16, eye=(0.1, 0.25, 0.045))


def rockfish(name='copper_rockfish', L=0.45):
    def prof(u):
        w = 0.075 * body(u, nose=0.45, peak=0.35, tail_min=0.22, head_pow=0.8)
        return (w * 0.55, w * 1.35, w * 1.15, 2.2)
    def color(p, u, v, n):
        x, y, z = p
        h = prof(u)[1]
        col = (0.72, 0.5, 0.33)
        bands = 0.5 + 0.5 * math.sin(u * 9 * math.pi)
        col = mixc(col, (0.55, 0.32, 0.22), soft(bands, 0.5, 0.2) * soft(z, 0.2 * h, 0.01))
        col = mixc(col, (0.55, 0.42, 0.3), soft(u, 0.25, 0.03) * (1 - soft(u, 0.7, 0.03)) * (1 - soft(abs(z), 0.25 * h, 0.01)))
        return mixc(col, (0.85, 0.8, 0.7), 1 - soft(z, -0.3 * h, 0.01))
    spiky = [(0.22, 0.0)] + [(0.24 + i * 0.04, 0.035 if i % 2 == 0 else 0.02) for i in range(11)] + [(0.7, 0.05), (0.78, 0.04), (0.8, 0.0)]
    return fish(name, L, prof, color, dorsal_outline=spiky, tail_span=0.15, tail_fork=0.08,
                pec=(0.28, 0.1, 0.2), anal=(0.62, 0.78, 0.04), pelvic=(0.35, 0.06), rings=12, stations=20, eye=(0.12, 0.35, 0.07))


def lingcod(name='lingcod', L=0.9):
    def prof(u):
        w = 0.085 * body(u, nose=0.6, peak=0.3, tail_min=0.2, head_pow=0.8, tail_pow=0.8)
        return (w * 0.85, w * 0.9, w * 1.0, 2.4)
    def color(p, u, v, n):
        x, y, z = p
        h = prof(u)[1]
        m = vnoise3(x * 14, y * 14, z * 14)
        col = mixc((0.3, 0.36, 0.3), (0.45, 0.47, 0.36), soft(m, 0.5, 0.08))
        col = mixc(col, (0.22, 0.27, 0.25), soft(vnoise3(x * 30 + 5, y * 30, z * 30), 0.62, 0.05))
        return mixc(col, (0.75, 0.78, 0.72), 1 - soft(z, -0.3 * h, 0.015))
    outline = [(0.16, 0.0)] + [(0.2 + i * 0.05, 0.04 + 0.01 * (i % 2)) for i in range(13)] + [(0.87, 0.0)]
    return fish(name, L, prof, color, dorsal_outline=outline, tail_span=0.2, tail_fork=0.05,
                pec=(0.22, 0.14, 0.15), anal=(0.5, 0.85, 0.05), pelvic=(0.25, 0.08), rings=12, stations=22, eye=(0.08, 0.4, 0.05), mouth=(0.12, 0.15, 0.06))


# ---------------------------------------------------------------- shark

def sixgill(name='sixgill', L=4.0):
    mb = MeshBuilder()
    def prof(u):
        w = 0.42 * body(u, nose=0.45, peak=0.35, tail_min=0.16, head_pow=0.9)
        return (w * 1.0, w * 0.85, w * 1.0, 2.4)
    def color(p, u, v, n):
        x, y, z = p
        h = prof(u)[1]
        return mixc((0.28, 0.3, 0.3), (0.55, 0.55, 0.52), 1 - soft(z, -0.35 * h, 0.05))
    sts = spine_stations(_line(L / 2, -L / 2, 5), lambda u: dict(zip(('rx', 'rt', 'rb', 'n'), prof(u))), 30)
    loft(mb, sts, rings=16, color_fn=color)
    def paint(p, u, part, n):
        if abs(part - 0.25) < 0.05:
            return (0.02, 0.02, 0.025)
        col = color(p, u, part, n)
        if part < 0.2 and abs(p.y) > 0.05 and p.z > -prof(u)[2] * 0.5:
            for k in range(6):
                if abs(u - (0.19 + k * 0.022)) < 0.005:
                    col = darken(col, 0.5)
        if part < 0.2 and u < 0.12 and abs(p.z + prof(u)[2] * 0.35) < 0.05:
            col = darken(col, 0.5)
        return col
    mb.paint = paint
    add_eyes(mb, L, prof, 0.09, 0.1, 0.05)
    fin_col = lambda p, u: color(p, u, 0.5, Vector((0, 0, 1)))
    ux = lambda u: L / 2 - u * L
    # single dorsal far back
    outline = [(ux(0.62), prof(0.62)[1] * 0.85), (ux(0.72), prof(0.72)[1] * 0.85), (ux(0.78), prof(0.72)[1] + 0.32), (ux(0.68), prof(0.68)[1] + 0.3)]
    plate(mb, outline, thickness=0.06, color_fn=fin_col, u_fn=lambda a, b: 0.5 - a / L)
    # pectorals
    pu = 0.3
    for side in (1, -1):
        m = trans(ux(pu), side * prof(pu)[0] * 0.9, -prof(pu)[2] * 0.3) @ rot('X', -side * 70)
        outline = [(0.2, 0), (-0.2, 0), (-0.75, 0.75), (-0.3, 0.7)]
        plate(mb, outline, thickness=0.05, matrix=m, color_fn=fin_col, u_fn=lambda a, b: pu)
    # pelvic & anal small
    for side in (1, -1):
        m = trans(ux(0.62), side * prof(0.62)[0] * 0.6, -prof(0.62)[2] * 0.85) @ rot('X', -side * 40)
        plate(mb, [(0.15, 0), (-0.15, 0), (-0.4, 0.3), (-0.15, 0.3)], thickness=0.04, matrix=m, color_fn=fin_col, u_fn=lambda a, b: 0.62)
    # heterocercal tail: long upper lobe
    tx = -L / 2 + 0.05
    outline = [(tx + 0.25, prof(0.97)[1] * 0.8), (tx - 1.1, 0.75), (tx - 0.75, 0.25), (tx - 0.45, 0.05), (tx - 0.45, -0.3), (tx + 0.25, -prof(0.97)[2] * 0.8)]
    plate(mb, outline, thickness=0.05, color_fn=fin_col, u_fn=lambda a, b: 0.5 - a / L)
    obj = mb.build(name)
    return finish(obj, name)


# ---------------------------------------------------------------- pinnipeds

def pinniped(name, L, prof, color_fn, fore=(0.28, 0.35, 0.16), hind=(0.14, 0.12), rings=16, stations=28, head_z=None,
             eye=(0.08, 0.25, 0.035)):
    mb = MeshBuilder()
    hz = head_z or (lambda u: 0.0)
    sts = spine_stations(_line(L / 2, -L / 2, 7, z_fn=hz), lambda u: dict(zip(('rx', 'rt', 'rb', 'n'), prof(u))), stations)
    loft(mb, sts, rings=rings, color_fn=color_fn)
    def paint(p, u, part, n):
        if abs(part - 0.25) < 0.05:
            return (0.02, 0.02, 0.025)
        col = color_fn(p, u, part, n)
        if part < 0.2 and u < 0.03:
            col = darken(col, 0.4)  # nose
        if part < 0.2 and u < 0.1 and abs(p.z - hz(u) + prof(u)[2] * 0.3) < 0.02 * L and abs(p.y) > 0.02:
            col = darken(col, 0.6)  # mouth line
        return col
    mb.paint = paint
    add_eyes(mb, L, prof, eye[0], eye[1], eye[2] * L / 1.6, up=hz(eye[0]))
    fin_col = lambda p, u: color_fn(p, u, 0.5, Vector((0, 0, -1)))
    ux = lambda u: L / 2 - u * L
    fu, fl, fw = fore
    for side in (1, -1):
        m = trans(ux(fu), side * prof(fu)[0] * 0.8, -prof(fu)[2] * 0.5) @ rot('X', -side * 70)
        outline = [(fw * 0.5, 0), (-fw * 0.5, 0), (-fw * 0.9, fl), (fw * 0.1, fl * 1.05), (fw * 0.5, fl * 0.5)]
        plate(mb, outline, thickness=0.02 * L, matrix=m, color_fn=fin_col, u_fn=lambda a, b: fu)
    hl, hw = hind
    tx = -L / 2 + 0.02 * L
    for side in (1, -1):
        m = trans(tx, side * prof(0.97)[0] * 0.5, 0) @ rot('Z', side * 20) @ rot('X', side * 80)
        outline = [(0.05 * L, 0), (-0.05 * L, 0), (-hl, hw * 0.5), (-hl * 0.6, hw * 1.0), (0.0, hw * 0.4)]
        plate(mb, outline, thickness=0.02 * L, matrix=m, color_fn=fin_col, u_fn=lambda a, b: 0.97)
    obj = mb.build(name)
    return finish(obj, name)


def harbor_seal(name='harbor_seal', L=1.6):
    def prof(u):
        w = 0.21 * body(u, nose=0.4, peak=0.45, tail_min=0.2, head_pow=1.0)
        head = 0.21 * 0.62 * math.sin(math.pi * min(1.0, u / 0.2)) ** 0.8 * (u < 0.2)
        w = max(w, head)
        return (w, w * 0.95, w * 1.0, 2.2)
    def color(p, u, v, n):
        x, y, z = p
        h = prof(u)[1]
        # spotted grey
        if z < -0.35 * h:
            return (0.5, 0.5, 0.47)
        n = vnoise3(x * 9.0, y * 9.0, z * 9.0) * 0.65 + vnoise3(x * 22.0 + 3, y * 22.0, z * 22.0) * 0.35
        if n > 0.62:
            return (0.16, 0.17, 0.19)
        if n > 0.52:
            return (0.26, 0.28, 0.29)
        return (0.38, 0.4, 0.4)
    return pinniped(name, L, prof, color, fore=(0.32, 0.28, 0.14), hind=(0.22, 0.2),
                    head_z=lambda u: 0.02 * smoothstep(0.3, 0.0, u))


def steller_sea_lion(name='steller_sea_lion', L=3.0):
    def prof(u):
        w = 0.38 * body(u, nose=0.35, peak=0.4, tail_min=0.18, head_pow=1.0)
        if u < 0.14:
            w = max(w, 0.38 * 0.4)
        return (w, w * 0.95, w * 1.0, 2.2)
    def color(p, u, v, n):
        x, y, z = p
        h = prof(u)[1]
        return mixc((0.6, 0.47, 0.32), (0.75, 0.62, 0.45), 1 - soft(z, -0.3 * h, 0.05))
    return pinniped(name, L, prof, color, fore=(0.34, 0.85, 0.3), hind=(0.5, 0.42), rings=16, stations=30,
                    head_z=lambda u: 0.1 * smoothstep(0.35, 0.0, u), eye=(0.06, 0.35, 0.03))


# ---------------------------------------------------------------- invertebrates

def crab(name, W=0.2, body_col=(0.6, 0.25, 0.15), leg_col=None, claw_scale=1.0, leg_len=1.0,
         spiny=False, long_legs=False, spider=False):
    """Generic brachyuran crab. W = carapace width. Faces +X."""
    mb = MeshBuilder()
    leg_col = leg_col or body_col
    H = W * 0.24
    Lc = W * (0.62 if not spider else 0.9)
    # carapace: flattened superellipse loft along X
    sts = []
    n = 9
    for i in range(n):
        u = i / (n - 1)
        x = Lc / 2 - u * Lc
        wf = math.sin(math.pi * (u * 0.9 + 0.05)) ** (0.55 if not spider else 0.8)
        rx = W / 2 * wf
        if spiny and 0.15 < u < 0.7:
            rx *= 1.0 + 0.1 * (i % 2)
        rt = H * 0.5 * (0.6 + 0.4 * math.sin(math.pi * u))
        rb = H * 0.35 * (0.6 + 0.4 * math.sin(math.pi * u))
        sts.append(dict(p=Vector((x, 0, 0)), rx=max(rx, 0.01), rt=max(rt, 0.006), rb=max(rb, 0.006), n=2.6))
    loft(mb, sts, rings=10, color_fn=lambda p, u, v, nrm: (body_col if nrm.z > -0.2 else tuple(c * 0.85 + 0.15 for c in body_col)))
    # eyes
    for side in (1, -1):
        sphere(mb, (Lc / 2 * 0.9, side * W * 0.12, H * 0.35), W * 0.03, (0.05, 0.05, 0.05), part=0.0, u=0.0, seg=5, rings=3)
    # legs: 4 pairs along the side
    segs = 4
    for side in (1, -1):
        for li in range(segs):
            t = li / (segs - 1)
            ax = Lc * (0.25 - 0.55 * t)
            ay = side * W * 0.42 * math.sin(math.pi * (0.2 + 0.6 * t)) ** 0.5
            ang = side * (55 - 95 * t)  # sweep forward to back
            ll = W * (0.42 + 0.08 * (1 - abs(t - 0.5) * 2)) * leg_len * (1.7 if long_legs else 1.0)
            d = Vector((math.cos(math.radians(ang)) * 0.3, math.sin(math.radians(ang)) * 1.0, 0)).normalized()
            base = Vector((ax, ay, -H * 0.1))
            knee = base + d * ll * 0.5 + Vector((0, 0, ll * 0.28))
            tip = base + d * ll * 0.95 + Vector((0, 0, -H * 0.8 - ll * 0.05))
            mid = (knee + tip) / 2 + Vector((0, 0, ll * 0.05))
            tube(mb, [base, knee, mid, tip], lambda u: W * (0.035 - 0.025 * u), rings=5, segs=5,
                 color=leg_col, part=1.0, u_offset=0.0, u_scale=1.0, cap_start=False)
            mb.uvs[-1] = (1.0, 1.0)
    # claws
    for side in (1, -1):
        ax = Lc * 0.35
        ay = side * W * 0.3
        d = Vector((0.6, side * 0.8, 0)).normalized()
        base = Vector((ax, ay, -H * 0.05))
        elbow = base + d * W * 0.22 * claw_scale + Vector((0, 0, W * 0.03))
        wrist = elbow + Vector((0.22 * W * claw_scale, -side * 0.02 * W, -0.02 * W))
        tube(mb, [base, elbow, wrist], lambda u: W * (0.05 - 0.01 * u) * claw_scale, rings=5, segs=3, color=leg_col, part=1.0, u_scale=0.5, cap_start=False)
        # pincer: fixed finger + movable
        hand_len = W * 0.3 * claw_scale
        hand = wrist + Vector((hand_len * 0.6, side * 0.0, 0))
        sts2 = [dict(p=wrist, rx=W * 0.06 * claw_scale, rt=W * 0.05 * claw_scale, rb=W * 0.05 * claw_scale, n=2.5),
                dict(p=hand, rx=W * 0.07 * claw_scale, rt=W * 0.055 * claw_scale, rb=W * 0.055 * claw_scale, n=2.5),
                dict(p=hand + Vector((hand_len * 0.55, side * W * 0.03, 0)), rx=W * 0.03 * claw_scale, rt=W * 0.02 * claw_scale, rb=W * 0.02 * claw_scale, n=2.5)]
        loft(mb, sts2, rings=6, color=leg_col, part=1.0, up=Vector((0, 0, 1)))
        for i in range(len(mb.uvs) - 19, len(mb.uvs)):
            mb.uvs[i] = (0.5 + 0.5 * (mb.verts[i].x - wrist.x) / max(hand_len, 1e-3), 1.0)
        # movable finger
        tip = hand + Vector((hand_len * 0.55, side * W * 0.16 * claw_scale, 0.0))
        tube(mb, [hand + Vector((0, side * W * 0.05 * claw_scale, 0)), tip], lambda u: W * (0.03 - 0.02 * u) * claw_scale, rings=4, segs=2, color=leg_col, part=1.0, u_offset=0.8, u_scale=0.2, cap_start=False)
    obj = mb.build(name)
    return finish(obj, name)


def dungeness():
    return crab('dungeness_crab', W=0.2, body_col=(0.36, 0.22, 0.16), leg_col=(0.42, 0.26, 0.17), claw_scale=1.0)


def red_rock_crab():
    return crab('red_rock_crab', W=0.15, body_col=(0.42, 0.08, 0.05), leg_col=(0.36, 0.06, 0.04), claw_scale=1.4)


def kelp_crab():
    return crab('kelp_crab', W=0.08, body_col=(0.45, 0.4, 0.18), leg_col=(0.4, 0.35, 0.15), claw_scale=0.9, long_legs=True, spider=True)


def decorator_crab():
    return crab('decorator_crab', W=0.07, body_col=(0.35, 0.32, 0.2), leg_col=(0.3, 0.28, 0.18), claw_scale=0.7, long_legs=True, spider=True, spiny=True)


def octopus(name='giant_pacific_octopus', S=1.0):
    """Mantle along -X (behind head), arms radiating forward/sideways. Head at origin."""
    mb = MeshBuilder()
    col = (0.62, 0.22, 0.14)
    dark = (0.45, 0.14, 0.1)
    # mantle: an elongated blob behind and above the head
    sts = []
    n = 8
    for i in range(n):
        u = i / (n - 1)
        r = S * 0.28 * math.sin(math.pi * (0.06 + 0.9 * u)) ** 0.6
        r = max(r, 0.02)
        x = -S * 0.15 - u * S * 0.7
        z = S * 0.25 + u * S * 0.22
        sts.append(dict(p=Vector((x, 0, z)), rx=r, rt=r * 1.05, rb=r * 0.9, n=2.2))
    loft(mb, sts, rings=9, color_fn=lambda p, u, v, nrm: (col if nrm.z > -0.3 else dark))
    # head
    sphere(mb, (S * 0.02, 0, S * 0.22), S * 0.24, col, part=0.0, u=0.0, seg=8, rings=5, scale=(1.0, 1.15, 0.85))
    for side in (1, -1):
        sphere(mb, (S * 0.2, side * S * 0.2, S * 0.36), S * 0.06, (0.9, 0.8, 0.3), part=0.0, u=0.0, seg=6, rings=3)
        sphere(mb, (S * 0.25, side * S * 0.2, S * 0.36), S * 0.025, (0.05, 0.05, 0.05), part=0.0, u=0.0, seg=5, rings=3)
    # arms: 8 radiating, mostly forward and to the sides, resting on ground z=0
    for i in range(8):
        a = math.radians(-150 + i * (300 / 7))
        # alternate spread: arms at index give
        base = Vector((S * 0.1 * math.cos(a), S * 0.18 * math.sin(a), S * 0.12))
        d = Vector((math.cos(a), math.sin(a), 0))
        ln = S * (1.2 + 0.25 * math.sin(i * 2.1))
        sd = Vector((-d.y, d.x, 0))
        p1 = base + d * ln * 0.3 + Vector((0, 0, -S * 0.02 + S * 0.06 * (i % 2)))
        p2 = base + d * ln * 0.62 + Vector((0, 0, -S * 0.08)) + sd * ln * 0.18 * math.sin(i * 1.7)
        p3 = base + d * ln * 0.85 + Vector((0, 0, -S * 0.1 + S * 0.12 * (i % 3 == 0))) + sd * ln * 0.45 * math.sin(i * 1.7)
        tube(mb, [base, p1, p2, p3], lambda u: S * (0.08 - 0.075 * u * u), rings=6, segs=10,
             color_fn=lambda p, u: col if p.z > -0.02 * S + 0 else dark, part=1.0, cap_start=False)
    obj = mb.build(name)
    return finish(obj, name)


def jelly(name, R, bell_h, col, ntent, tent_len, tent_col=None, arms=0, arm_col=None, arm_len=0.0, rings=10):
    """Bell centred at origin, opening downward (-Z). u along tentacles = 0 at bell."""
    mb = MeshBuilder()
    tent_col = tent_col or col
    # bell: hemisphere-ish loft along Z (top at +bell_h, rim at 0)
    sts = []
    n = 6
    for i in range(n):
        u = i / (n - 1)
        r = R * math.sin(math.pi / 2 * (0.15 + 0.85 * u)) ** 0.8
        z = bell_h * (1 - u) ** 1.1
        sts.append(dict(p=Vector((0, 0, z)), rx=max(r, 0.01), rt=max(r, 0.01), rb=max(r, 0.01), n=2.0))
    # hollow underside: add a second surface slightly inside
    sts_in = [dict(p=Vector((0, 0, s['p'].z - bell_h * 0.15)), rx=s['rx'] * 0.9, rt=s['rt'] * 0.9, rb=s['rb'] * 0.9, n=2.0) for s in sts]
    ids_out = loft(mb, sts, rings=rings, color=col, part=0.0, cap_start=True, cap_end=False, up=Vector((1, 0, 0)))
    ids_in = loft(mb, sts_in, rings=rings, color=tuple(c * 0.8 for c in col), part=0.0, cap_start=True, cap_end=False, up=Vector((1, 0, 0)))
    # flip inner faces (they face outward otherwise; normals get recomputed anyway)
    # bridge rim
    a, b = ids_out[-1], ids_in[-1]
    for ri in range(rings):
        r2 = (ri + 1) % rings
        mb.add_face([a[ri], b[ri], b[r2], a[r2]])
    # fix u on bell: set u=0 for bell
    for i in range(len(mb.uvs)):
        mb.uvs[i] = (0.0, 0.0)
    # tentacles
    for i in range(ntent):
        th = 2 * math.pi * i / ntent
        rr = R * 0.92
        base = Vector((math.cos(th) * rr, math.sin(th) * rr, -bell_h * 0.05))
        sway = Vector((math.cos(th + 1.3), math.sin(th + 1.3), 0)) * tent_len * 0.15 * math.sin(i * 3.3)
        p1 = base + Vector((math.cos(th) * R * 0.1, math.sin(th) * R * 0.1, -tent_len * 0.35)) + sway * 0.3
        p2 = base + Vector((0, 0, -tent_len * 0.7)) + sway
        p3 = base + Vector((0, 0, -tent_len)) + sway * 0.5
        tube(mb, [base, p1, p2, p3], lambda u: R * (0.03 - 0.02 * u), rings=4, segs=6, color=tent_col, part=1.0, cap_start=False)
    for i in range(arms):
        th = 2 * math.pi * i / arms + 0.3
        base = Vector((math.cos(th) * R * 0.2, math.sin(th) * R * 0.2, -bell_h * 0.1))
        p1 = base + Vector((math.cos(th) * R * 0.35, math.sin(th) * R * 0.35, -arm_len * 0.4))
        p2 = base + Vector((math.cos(th) * R * 0.25, math.sin(th) * R * 0.25, -arm_len * 0.8))
        p3 = base + Vector((math.cos(th) * R * 0.4, math.sin(th) * R * 0.4, -arm_len))
        tube(mb, [base, p1, p2, p3], lambda u: R * (0.12 - 0.1 * u), rings=5, segs=6, color=arm_col or tent_col, part=1.0, cap_start=False)
    obj = mb.build(name)
    return finish(obj, name)


def moon_jelly():
    return jelly('moon_jelly', R=0.2, bell_h=0.09, col=(0.8, 0.85, 0.92), ntent=14, tent_len=0.12, tent_col=(0.85, 0.88, 0.95), arms=4, arm_col=(0.8, 0.75, 0.85), arm_len=0.18)


def lions_mane():
    return jelly('lions_mane', R=0.55, bell_h=0.28, col=(0.7, 0.28, 0.15), ntent=28, tent_len=1.8, tent_col=(0.65, 0.3, 0.2), arms=8, arm_col=(0.6, 0.25, 0.18), arm_len=0.9, rings=12)


def sea_nettle():
    return jelly('sea_nettle', R=0.3, bell_h=0.22, col=(0.85, 0.55, 0.3), ntent=16, tent_len=1.3, tent_col=(0.8, 0.45, 0.3), arms=4, arm_col=(0.9, 0.7, 0.5), arm_len=0.9)


def seastar(name, R, arms, col, thick=0.25, col2=None):
    mb = MeshBuilder()
    col2 = col2 or col
    h = R * thick
    # central disk
    sphere(mb, (0, 0, h * 0.4), R * 0.25, col, seg=arms, rings=3, scale=(1, 1, 0.55))
    for i in range(arms):
        th = 2 * math.pi * i / arms
        d = Vector((math.cos(th), math.sin(th), 0))
        sts = []
        n = 5
        for j in range(n):
            u = j / (n - 1)
            r = R * 0.12 * (1 - u * 0.85) + 0.005
            p = d * (R * 0.18 + u * R * 0.82) + Vector((0, 0, h * 0.25 * (1 - u) + r * 0.5))
            sts.append(dict(p=p, rx=r, rt=r * 0.8, rb=r * 0.5, n=2.5))
        loft(mb, sts, rings=6, color_fn=lambda p, u, v, nrm: (col if nrm.z > 0 else col2), part=0.0, cap_start=False)
    obj = mb.build(name)
    return finish(obj, name)


def ochre_star():
    return seastar('ochre_star', R=0.15, arms=5, col=(0.55, 0.3, 0.55), col2=(0.8, 0.7, 0.4), thick=0.3)


def sunflower_star():
    return seastar('sunflower_star', R=0.4, arms=18, col=(0.75, 0.45, 0.35), col2=(0.9, 0.7, 0.5), thick=0.2)


def urchin(name='red_urchin', R=0.08):
    mb = MeshBuilder()
    col = (0.45, 0.1, 0.15)
    sphere(mb, (0, 0, R * 0.8), R, col, seg=8, rings=4, scale=(1, 1, 0.8))
    # spines
    k = 0
    for ring in range(4):
        phi = math.pi * (0.15 + 0.7 * ring / 3)
        cnt = 7 if ring in (1, 2) else 5
        for j in range(cnt):
            th = 2 * math.pi * j / cnt + ring * 0.4
            d = Vector((math.sin(phi) * math.cos(th), math.sin(phi) * math.sin(th), math.cos(phi) * 0.8))
            base = Vector((0, 0, R * 0.8)) + d * R * 0.9
            tip = base + d * R * (0.9 + 0.3 * math.sin(k * 2.3))
            tube(mb, [base, tip], lambda u: R * 0.05 * (1 - u * 0.7), rings=3, segs=1, color=(0.55, 0.12, 0.18), part=0.0, cap_start=False)
            k += 1
    obj = mb.build(name)
    return finish(obj, name)


def plumose_anemone(name='plumose_anemone', H=0.4):
    mb = MeshBuilder()
    col = (0.92, 0.9, 0.85)
    sts = []
    n = 6
    for i in range(n):
        u = i / (n - 1)
        r = H * (0.11 + 0.03 * math.sin(math.pi * u)) * (1.0 if u < 0.85 else 1.6)
        sts.append(dict(p=Vector((0, 0, u * H * 0.8)), rx=r, rt=r, rb=r, n=2.0))
    loft(mb, sts, rings=8, color=col, part=0.0, cap_end=True, up=Vector((1, 0, 0)))
    for i in range(len(mb.uvs)):
        mb.uvs[i] = (mb.verts[i].z / H, 0.0)
    # crown of feathery tentacles: many small tapered cones
    for ring_i, (cnt, rr_f, lift) in enumerate(((30, 0.2, 0.12), (22, 0.13, 0.2), (12, 0.06, 0.26))):
        for j in range(cnt):
            th = 2 * math.pi * j / cnt + ring_i * 0.3
            rr = H * rr_f
            base = Vector((math.cos(th) * rr * 0.6, math.sin(th) * rr * 0.6, H * 0.8))
            tip = base + Vector((math.cos(th) * rr * 1.6, math.sin(th) * rr * 1.6, H * lift + (j % 3) * H * 0.03))
            tube(mb, [base, (base + tip) / 2 + Vector((0, 0, H * 0.06)), tip], lambda u: H * 0.022 * (1 - u * 0.7), rings=3, segs=3,
                 color=(0.95, 0.94, 0.9), part=1.0, u_offset=0.8, u_scale=0.2, cap_start=False)
    obj = mb.build(name)
    return finish(obj, name)


def ribbon(mb, pts, width_fn, color, part=0.5, segs=7, u_fn=None):
    """Thin flat blade following a curve. pts: list of Vector. width_fn(u) -> half width."""
    sts = []
    for i in range(segs + 1):
        u = i / segs
        w = max(width_fn(u), 0.004)
        sts.append(dict(p=catmull(pts, u), rx=w, rt=0.006, rb=0.006, n=2.0))
    ids = loft(mb, sts, rings=4, color=color, part=part, cap_start=False, cap_end=False)
    if u_fn:
        for ring in ids:
            for vi in ring:
                mb.uvs[vi] = (u_fn(mb.verts[vi]), part)
    return ids


def bull_kelp(name='bull_kelp', H=6.0):
    """Stipe from ground to float bulb, blades trailing down-current. u = height fraction."""
    mb = MeshBuilder()
    stipe = (0.34, 0.3, 0.14)
    blade = (0.5, 0.46, 0.2)
    pts = [Vector((0, 0, 0)), Vector((0.2, 0.1, H * 0.35)), Vector((0.1, -0.15, H * 0.7)), Vector((0.3, 0.0, H * 0.95))]
    tube(mb, pts, lambda u: 0.03 + 0.05 * u, rings=5, segs=8, color=stipe, part=0.0, cap_start=False)
    for i in range(len(mb.uvs)):
        mb.uvs[i] = (mb.verts[i].z / H, 0.0)
    top = pts[-1]
    sphere(mb, top + Vector((0, 0, 0.1)), 0.18, (0.42, 0.36, 0.15), part=0.0, u=0.97, seg=7, rings=4)
    # blades: long ribbons that hang from the bulb and trail sideways
    for j in range(10):
        # blades all trail down-current (+X) with some spread, like a streamer
        th = (j / 9 - 0.5) * 1.6 + 0.15 * math.sin(j * 3.1)
        d = Vector((math.cos(th), math.sin(th), 0))
        side = Vector((-d.y, d.x, 0))
        ln = 3.2 + 1.1 * math.sin(j * 1.9)
        base = top + Vector((0, 0, 0.1 + 0.04 * (j % 3))) + d * 0.1
        # blades hang from the bulb and stream down-current: mostly downward, drifting sideways
        p1 = base + d * ln * 0.22 - Vector((0, 0, ln * 0.2)) + side * 0.08 * math.sin(j)
        p2 = base + d * ln * 0.45 - Vector((0, 0, ln * 0.5)) + side * 0.18 * math.sin(j * 2.1)
        p3 = base + d * ln * 0.62 - Vector((0, 0, ln * 0.78)) + side * 0.22 * math.sin(j * 1.3)
        ribbon(mb, [base, p1, p2, p3], lambda u: 0.04 + 0.09 * math.sin(math.pi * min(1, u * 1.1)) ** 0.7, blade,
               part=0.5, u_fn=lambda v: min(1.0, 0.97 + 0.03 * (v - top).length / ln))
    obj = mb.build(name)
    return finish(obj, name)


def sugar_kelp(name='sugar_kelp', H=1.8):
    mb = MeshBuilder()
    blade = (0.42, 0.36, 0.14)
    for j in range(3):
        th = 2 * math.pi * j / 3 + 0.5
        d = Vector((math.cos(th), math.sin(th), 0))
        side = Vector((-d.y, d.x, 0))
        ln = H * (0.8 + 0.2 * j / 2)
        base = Vector((0, 0, 0.02)) + d * 0.05
        p1 = base + d * ln * 0.15 + Vector((0, 0, ln * 0.35))
        p2 = base + d * ln * 0.5 + Vector((0, 0, ln * 0.55)) + side * 0.15 * math.sin(j * 2.0)
        p3 = base + d * ln * 0.95 + Vector((0, 0, ln * 0.45)) + side * 0.2 * math.sin(j * 1.4)
        col = tuple(c * (0.9 + 0.1 * j) for c in blade)
        ribbon(mb, [base, p1, p2, p3], lambda u: 0.02 + 0.16 * math.sin(math.pi * min(1, u * 1.05)) ** 0.8, col,
               part=0.0, u_fn=lambda v: min(1.0, (v - Vector((0, 0, 0))).length / ln))
    obj = mb.build(name)
    return finish(obj, name)


def rock(name='rock', R=1.0, seed=1):
    import random
    rnd = random.Random(seed)
    mb = MeshBuilder()
    col = (0.32, 0.33, 0.3)
    seg, rings_ = 8, 4
    c = Vector((0, 0, 0))
    top = mb.add_vert(c + Vector((0, 0, R * 0.7)), (0, 0), col)
    ids = []
    for ri in range(1, rings_):
        phi = math.pi / 2 * ri / (rings_ - 1) * 0.95
        row = []
        for si in range(seg):
            th = 2 * math.pi * si / seg
            rr = R * (0.8 + 0.4 * rnd.random())
            p = Vector((math.sin(phi) * math.cos(th) * rr, math.sin(phi) * math.sin(th) * rr * 0.8, math.cos(phi) * R * 0.7 * (0.85 + 0.3 * rnd.random())))
            row.append(mb.add_vert(p, (0, 0), col))
        ids.append(row)
    for si in range(seg):
        s2 = (si + 1) % seg
        mb.add_face([top, ids[0][si], ids[0][s2]])
    for ri in range(len(ids) - 1):
        for si in range(seg):
            s2 = (si + 1) % seg
            mb.add_face([ids[ri][si], ids[ri + 1][si], ids[ri + 1][s2], ids[ri][s2]])
    obj = mb.build(name)
    return finish(obj, name)


ALL = {
    'orca': orca, 'humpback': humpback, 'dolphin_pws': dolphin, 'dalls_porpoise': porpoise,
    'chinook': salmon, 'herring': herring, 'copper_rockfish': rockfish, 'lingcod': lingcod, 'sixgill': sixgill,
    'harbor_seal': harbor_seal, 'steller_sea_lion': steller_sea_lion,
    'dungeness_crab': dungeness, 'red_rock_crab': red_rock_crab, 'kelp_crab': kelp_crab, 'decorator_crab': decorator_crab,
    'giant_pacific_octopus': octopus, 'moon_jelly': moon_jelly, 'lions_mane': lions_mane, 'sea_nettle': sea_nettle,
    'ochre_star': ochre_star, 'sunflower_star': sunflower_star, 'red_urchin': urchin, 'plumose_anemone': plumose_anemone,
    'bull_kelp': bull_kelp, 'sugar_kelp': sugar_kelp,
}
