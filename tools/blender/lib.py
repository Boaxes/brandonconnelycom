"""Procedural low-poly creature toolkit for Blender.

Conventions (Blender space): +X = forward (nose), +Z = up, +Y = left.
glTF export turns that into +X forward, +Y up in three.js.

UV layout used by the web shaders:
  u = 0..1 along the spine (0 = nose, 1 = tail) or along an appendage
  v = part id: 0.0 body, 0.5 fin/plate, 1.0 appendage (leg, tentacle)
Vertex colors carry all shading, there are no textures.
"""
import bpy, bmesh, math
from mathutils import Vector, Matrix

# ---------------------------------------------------------------- helpers

def clear_scene():
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.object.delete(use_global=False)
    for block in (bpy.data.meshes, bpy.data.materials):
        for b in list(block):
            if b.users == 0:
                block.remove(b)


def lerp(a, b, t):
    return a + (b - a) * t


def smoothstep(e0, e1, x):
    t = max(0.0, min(1.0, (x - e0) / (e1 - e0)))
    return t * t * (3 - 2 * t)


def catmull(points, t):
    """Catmull-Rom interpolation over a list of Vectors, t in 0..1."""
    n = len(points) - 1
    if n <= 0:
        return points[0].copy()
    f = t * n
    i = int(math.floor(f))
    i = max(0, min(n - 1, i))
    u = f - i
    p0 = points[max(i - 1, 0)]
    p1 = points[i]
    p2 = points[min(i + 1, n)]
    p3 = points[min(i + 2, n)]
    return 0.5 * ((2 * p1) + (-p0 + p2) * u + (2 * p0 - 5 * p1 + 4 * p2 - p3) * u * u + (-p0 + 3 * p1 - 3 * p2 + p3) * u * u * u)


def interp_scalar(vals, t):
    pts = [Vector((v, 0, 0)) for v in vals]
    return catmull(pts, t).x


class MeshBuilder:
    def __init__(self):
        self.verts = []
        self.faces = []
        self.uvs = []      # per vertex (u, v)
        self.cols = []     # per vertex (r, g, b)
        self.face_cols = []  # per face (r, g, b) or None -> average of verts

    def add_vert(self, p, uv=(0, 0), col=(1, 1, 1)):
        self.verts.append(Vector(p))
        self.uvs.append(uv)
        self.cols.append(col)
        return len(self.verts) - 1

    def add_face(self, idx, col=None):
        # drop degenerate faces
        if len(set(idx)) < 3:
            return
        self.faces.append(list(idx))
        self.face_cols.append(col)

    def centroid(self, idx):
        return sum((self.verts[i] for i in idx), Vector()) / len(idx)

    def merge(self, other, matrix=None):
        off = len(self.verts)
        for i, v in enumerate(other.verts):
            p = matrix @ v if matrix is not None else v
            self.add_vert(p, other.uvs[i], other.cols[i])
        for fi, f in enumerate(other.faces):
            self.add_face([i + off for i in f], other.face_cols[fi])

    def build(self, name, flat=True):
        me = bpy.data.meshes.new(name)
        me.from_pydata([tuple(v) for v in self.verts], [], self.faces)
        me.update()
        uv = me.uv_layers.new(name='UVMap')
        for poly in me.polygons:
            for li in poly.loop_indices:
                vi = me.loops[li].vertex_index
                uv.data[li].uv = self.uvs[vi]
        ca = me.color_attributes.new(name='Col', type='FLOAT_COLOR', domain='CORNER')
        for poly in me.polygons:
            fc = self.face_cols[poly.index] if poly.index < len(self.face_cols) else None
            if fc is None:
                vs = [self.cols[me.loops[li].vertex_index] for li in poly.loop_indices]
                fc = tuple(sum(c[k] for c in vs) / len(vs) for k in range(3))
            for li in poly.loop_indices:
                ca.data[li].color = (fc[0], fc[1], fc[2], 1.0)
        for p in me.polygons:
            p.use_smooth = not flat
        obj = bpy.data.objects.new(name, me)
        bpy.context.collection.objects.link(obj)
        # recompute normals outward
        bpy.context.view_layer.objects.active = obj
        obj.select_set(True)
        bpy.ops.object.mode_set(mode='EDIT')
        bpy.ops.mesh.select_all(action='SELECT')
        bpy.ops.mesh.normals_make_consistent(inside=False)
        bpy.ops.object.mode_set(mode='OBJECT')
        obj.select_set(False)
        return obj


# ---------------------------------------------------------------- lofting

def superellipse(theta, rx, ry_top, ry_bot, n=2.0):
    c = math.cos(theta)
    s = math.sin(theta)
    ry = ry_top if s >= 0 else ry_bot
    x = rx * math.copysign(abs(c) ** (2.0 / n), c)
    y = ry * math.copysign(abs(s) ** (2.0 / n), s)
    return x, y


def loft(mb, stations, rings=10, color=(0.5, 0.5, 0.5), part=0.0,
         cap_start=True, cap_end=True, color_fn=None, n_fn=None, twist=0.0,
         up=Vector((0, 0, 1))):
    """Sweep a superellipse profile along a spine.

    stations: list of dicts {p:(x,y,z), rx, rt, rb, [n], [roll], [dz]}
      rx: half width (Y), rt: half height above spine, rb: below spine.
      dz: vertical offset of the section centre (belly sag etc.)
    color_fn(local_point, u, v, normal-ish) -> (r,g,b) overrides color.
    """
    pts = [Vector(s['p']) for s in stations]
    ns = len(stations)
    ring_ids = []
    for si, st in enumerate(stations):
        u = si / (ns - 1)
        p = pts[si]
        # tangent
        if si == 0:
            tan = (pts[1] - pts[0])
        elif si == ns - 1:
            tan = (pts[-1] - pts[-2])
        else:
            tan = (pts[si + 1] - pts[si - 1])
        tan.normalize()
        side = up.cross(tan)
        if side.length < 1e-6:
            side = Vector((0, 1, 0))
        side.normalize()
        lup = tan.cross(side).normalized()
        roll = st.get('roll', 0.0) + twist * u
        if roll:
            rm = Matrix.Rotation(roll, 3, tan)
            side = rm @ side
            lup = rm @ lup
        n = st.get('n', 2.0)
        if n_fn:
            n = n_fn(u)
        dz = st.get('dz', 0.0)
        ids = []
        for ri in range(rings):
            theta = 2 * math.pi * ri / rings + math.pi / 2  # start at top
            y, z = superellipse(theta, st['rx'], st['rt'], st['rb'], n)
            pos = p + side * y + lup * (z + dz)
            v = ri / rings
            col = color_fn(pos, u, v, (side * y + lup * z)) if color_fn else color
            ids.append(mb.add_vert(pos, (u, part), col))
        ring_ids.append(ids)
    for si in range(ns - 1):
        a = ring_ids[si]
        b = ring_ids[si + 1]
        for ri in range(rings):
            r2 = (ri + 1) % rings
            idx = [a[ri], a[r2], b[r2], b[ri]]
            fc = None
            if color_fn:
                c = mb.centroid(idx)
                uu = (si + 0.5) / (ns - 1)
                axis = (pts[si] + pts[si + 1]) / 2
                fc = color_fn(c, uu, (ri + 0.5) / rings, c - axis)
            mb.add_face(idx, fc)

    def cap(ids, at_start):
        centre = sum((mb.verts[i] for i in ids), Vector()) / len(ids)
        u = 0.0 if at_start else 1.0
        col = mb.cols[ids[0]]
        c = mb.add_vert(centre, (u, part), col)
        for ri in range(rings):
            r2 = (ri + 1) % rings
            idx = [c, ids[r2], ids[ri]] if at_start else [c, ids[ri], ids[r2]]
            fc = None
            if color_fn:
                cc = mb.centroid(idx)
                fc = color_fn(cc, u, (ri + 0.5) / rings, cc - centre + Vector((0, 0, 1e-4)))
            mb.add_face(idx, fc)
    if cap_start:
        cap(ring_ids[0], True)
    if cap_end:
        cap(ring_ids[-1], False)
    return ring_ids


def spine_stations(curve_pts, profile, count):
    """Sample a spline curve (list of Vector) and profile function into stations.
    profile(u) -> dict(rx, rt, rb, [n], [dz])."""
    out = []
    for i in range(count):
        u = i / (count - 1)
        p = catmull(curve_pts, u)
        st = dict(profile(u))
        st['p'] = p
        out.append(st)
    return out


def plate(mb, outline, thickness=0.02, matrix=None, color=(0.5, 0.5, 0.5),
          part=0.5, u_fn=None, color_fn=None):
    """Thin extruded polygon. outline: list of (a, b) 2D points in the X-Z
    plane (a -> X, b -> Z), thickness along Y. Outline must be simple, CCW
    ordering is fixed automatically. u_fn(a, b) -> spine u for the shader."""
    # ensure CCW in (a,b)
    area = 0
    for i in range(len(outline)):
        a0, b0 = outline[i]
        a1, b1 = outline[(i + 1) % len(outline)]
        area += a0 * b1 - a1 * b0
    if area < 0:
        outline = list(reversed(outline))
    m = matrix if matrix is not None else Matrix.Identity(4)
    ca = sum(o[0] for o in outline) / len(outline)
    cb = sum(o[1] for o in outline) / len(outline)
    front, back = [], []
    for a, b in outline:
        u = u_fn(a, b) if u_fn else 0.5
        pf = m @ Vector((a, thickness / 2, b))
        pb = m @ Vector((a, -thickness / 2, b))
        cf = color_fn(pf, u) if color_fn else color
        cb_ = color_fn(pb, u) if color_fn else color
        front.append(mb.add_vert(pf, (u, part), cf))
        back.append(mb.add_vert(pb, (u, part), cb_))
    # fan from centre for robustness with concave outlines: use ear-ish fan
    uc = u_fn(ca, cb) if u_fn else 0.5
    cfront = mb.add_vert(m @ Vector((ca, thickness / 2, cb)), (uc, part),
                         color_fn(m @ Vector((ca, 0, cb)), uc) if color_fn else color)
    cback = mb.add_vert(m @ Vector((ca, -thickness / 2, cb)), (uc, part),
                        color_fn(m @ Vector((ca, 0, cb)), uc) if color_fn else color)
    nn = len(outline)
    for i in range(nn):
        j = (i + 1) % nn
        for idx in ([cfront, front[i], front[j]], [cback, back[j], back[i]], [front[i], back[i], back[j], front[j]]):
            fc = None
            if color_fn:
                c = mb.centroid(idx)
                fc = color_fn(c, u_fn(ca, cb) if u_fn else 0.5)
            mb.add_face(idx, fc)


def tube(mb, curve_pts, radius_fn, rings=6, segs=8, color=(0.5, 0.5, 0.5),
         part=1.0, u_offset=0.0, u_scale=1.0, cap_start=True, cap_end=True,
         color_fn=None):
    """Tapered tube along a curve (list of Vector). radius_fn(u) -> r.
    Writes u = u_offset + u * u_scale."""
    sts = []
    for i in range(segs + 1):
        u = i / segs
        r = radius_fn(u)
        sts.append({'p': catmull(curve_pts, u), 'rx': r, 'rt': r, 'rb': r})
    # loft with custom up that avoids degenerate when tube is vertical
    pts = [s['p'] for s in sts]
    d = (pts[-1] - pts[0]).normalized() if (pts[-1] - pts[0]).length > 1e-6 else Vector((0, 0, 1))
    up = Vector((0, 0, 1)) if abs(d.z) < 0.9 else Vector((1, 0, 0))
    ns = len(sts)
    ring_ids = []
    for si, st in enumerate(sts):
        u = si / (ns - 1)
        p = pts[si]
        if si == 0:
            tan = pts[1] - pts[0]
        elif si == ns - 1:
            tan = pts[-1] - pts[-2]
        else:
            tan = pts[si + 1] - pts[si - 1]
        if tan.length < 1e-6:
            tan = d
        tan.normalize()
        side = up.cross(tan)
        if side.length < 1e-6:
            side = Vector((0, 1, 0))
        side.normalize()
        lup = tan.cross(side).normalized()
        ids = []
        for ri in range(rings):
            th = 2 * math.pi * ri / rings
            pos = p + side * (math.cos(th) * st['rx']) + lup * (math.sin(th) * st['rt'])
            uu = u_offset + u * u_scale
            col = color_fn(pos, u) if color_fn else color
            ids.append(mb.add_vert(pos, (uu, part), col))
        ring_ids.append(ids)
    for si in range(ns - 1):
        a, b = ring_ids[si], ring_ids[si + 1]
        for ri in range(rings):
            r2 = (ri + 1) % rings
            idx = [a[ri], a[r2], b[r2], b[ri]]
            fc = color_fn(mb.centroid(idx), (si + 0.5) / (ns - 1)) if color_fn else None
            mb.add_face(idx, fc)
    if cap_start:
        ids = ring_ids[0]
        c = mb.add_vert(pts[0], (u_offset, part), mb.cols[ids[0]])
        for ri in range(rings):
            mb.add_face([c, ids[(ri + 1) % rings], ids[ri]])
    if cap_end:
        ids = ring_ids[-1]
        c = mb.add_vert(pts[-1], (u_offset + u_scale, part), mb.cols[ids[0]])
        for ri in range(rings):
            mb.add_face([c, ids[ri], ids[(ri + 1) % rings]])
    return ring_ids


def sphere(mb, centre, r, color, part=0.0, u=0.5, seg=6, rings=4, scale=(1, 1, 1)):
    ids = []
    c = Vector(centre)
    top = mb.add_vert(c + Vector((0, 0, r * scale[2])), (u, part), color)
    bot = mb.add_vert(c - Vector((0, 0, r * scale[2])), (u, part), color)
    for ri in range(1, rings):
        phi = math.pi * ri / rings
        row = []
        for si in range(seg):
            th = 2 * math.pi * si / seg
            p = c + Vector((math.sin(phi) * math.cos(th) * r * scale[0],
                            math.sin(phi) * math.sin(th) * r * scale[1],
                            math.cos(phi) * r * scale[2]))
            row.append(mb.add_vert(p, (u, part), color))
        ids.append(row)
    for si in range(seg):
        s2 = (si + 1) % seg
        mb.add_face([top, ids[0][si], ids[0][s2]])
        mb.add_face([bot, ids[-1][s2], ids[-1][si]])
    for ri in range(len(ids) - 1):
        for si in range(seg):
            s2 = (si + 1) % seg
            mb.add_face([ids[ri][si], ids[ri + 1][si], ids[ri + 1][s2], ids[ri][s2]])


def rot(axis, deg):
    return Matrix.Rotation(math.radians(deg), 4, axis)


def trans(x, y, z):
    return Matrix.Translation(Vector((x, y, z)))


def scale_m(x, y, z):
    return Matrix.Diagonal(Vector((x, y, z, 1)))


def mirror_y(mb_src):
    """Return a copy of a MeshBuilder mirrored across Y (keeping winding valid)."""
    out = MeshBuilder()
    for i, v in enumerate(mb_src.verts):
        out.add_vert(Vector((v.x, -v.y, v.z)), mb_src.uvs[i], mb_src.cols[i])
    for f in mb_src.faces:
        out.add_face(list(reversed(f)))
    return out


# ---------------------------------------------------------------- export

def export_glb(obj_names, path, apply_scale=1.0):
    bpy.ops.object.select_all(action='DESELECT')
    for n in obj_names:
        bpy.data.objects[n].select_set(True)
    bpy.context.view_layer.objects.active = bpy.data.objects[obj_names[0]]
    bpy.ops.export_scene.gltf(
        filepath=path,
        export_format='GLB',
        use_selection=True,
        export_apply=True,
        export_normals=True,
        export_texcoords=True,
        export_materials='NONE',
        export_yup=True,
        export_animations=False,
        export_skins=False,
        export_cameras=False,
        export_lights=False,
    )
    bpy.ops.object.select_all(action='DESELECT')


def finish(obj, name):
    """Give a mesh a vertex-colour material so viewport renders show colours."""
    mat = bpy.data.materials.get('VCol')
    if mat is None:
        mat = bpy.data.materials.new('VCol')
        mat.use_nodes = True
        nt = mat.node_tree
        bsdf = nt.nodes.get('Principled BSDF')
        vc = nt.nodes.new('ShaderNodeVertexColor')
        vc.layer_name = 'Col'
        nt.links.new(vc.outputs['Color'], bsdf.inputs['Base Color'])
        bsdf.inputs['Roughness'].default_value = 0.7
    obj.data.materials.append(mat)
    obj.name = name
    return obj


def bounds(obj):
    xs = [v.co.x for v in obj.data.vertices]
    ys = [v.co.y for v in obj.data.vertices]
    zs = [v.co.z for v in obj.data.vertices]
    return (min(xs), max(xs)), (min(ys), max(ys)), (min(zs), max(zs))
