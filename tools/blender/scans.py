"""Process downloaded Sketchfab scans (assets-src/*.glb) into web-ready GLBs.

Run inside Blender:
    exec(open(ROOT + '/tools/blender/scans.py').read())
    inspect('herring')                 # renders 3 views + reports size, faces, textures
    process('herring')                 # applies SCANS['herring'] and exports public/models/scan_herring.glb

Conventions of the output (same as the procedural models):
    +X forward (nose), +Z up, centred on the body (swimmers) or resting on z=0 (bottom dwellers), metres.
"""
import os, math
import bpy
from mathutils import Vector, Matrix, Euler

ROOT = '/Users/brandon/Portfolio Site'
SRC = ROOT + '/assets-src'
OUT = ROOT + '/public/models'
IMG = '/private/tmp/claude-501/-Users-brandon-Portfolio-Site/932f55f2-9f33-43c6-8926-e87a1b9e7fd6/scratchpad/scans'
os.makedirs(IMG, exist_ok=True)

# rot: XYZ euler degrees applied after import; length: target size along X (m); faces: decimation target;
# tex: max texture edge; base: 'center' or 'bottom'
SCANS = {
    # side view (render _0) must show the nose to the RIGHT and the back UP
    'giant_pacific_octopus': dict(rot=(0, 0, 180), length=2.2, faces=26000, tex=2048, base='bottom'),
    'herring': dict(rot=(0, 0, 180), length=0.27, faces=1400, tex=512),
    'salmon': dict(rot=(0, 0, 180), length=0.85, faces=6000, tex=1024),
    'rockfish_copper': dict(rot=(0, 0, 180), length=0.42, faces=4500, tex=1024),
    'rockfish_black': dict(rot=(0, 0, 180), length=0.45, faces=4500, tex=1024),
    'crab_dungeness': dict(rot=(-90, 0, -90), length=0.26, faces=7000, tex=1024, base='bottom'),
    'crab_helmet': dict(rot=(0, 0, 90), length=0.13, faces=6000, tex=1024, base='bottom'),
    'crab_kelp': dict(rot=(0, 0, 0), length=0.15, faces=6000, tex=1024, base='bottom'),
    'crab_decorator': dict(rot=(0, 0, 90), length=0.11, faces=5000, tex=1024, base='bottom'),
    'sunflower_star': dict(rot=(-90, 0, 0), length=0.6, faces=6000, tex=1024, base='bottom'),
    'urchin': dict(rot=(0, 0, 0), length=0.11, faces=6000, tex=512, base='bottom'),
    'sea_cucumber': dict(rot=(0, 0, 0), length=0.3, faces=2500, tex=512, base='bottom'),
    'starry_flounder': dict(rot=(0, 0, 180), length=0.45, faces=3000, tex=1024, base='bottom'),
    'sculpin': dict(rot=(0, 0, 180), length=0.3, faces=4000, tex=1024),
    'prawn': dict(rot=(0, 0, 180), length=0.2, faces=3500, tex=512),
    'dogfish': dict(rot=(0, 0, 180), length=1.0, faces=5000, tex=1024),
    'harbor_seal': dict(rot=(90, 0, 0), length=1.6, faces=9000, tex=1024),
    'orca': dict(rot=(0, 0, 90), length=7.0, faces=9000, tex=1024),
    'humpback': dict(rot=(0, 0, 180), length=14.0, faces=10000, tex=1024),
    'harbor_porpoise': dict(rot=(0, 0, -90), length=1.6, faces=6000, tex=1024),
    'bat_star': dict(rot=(0, 0, 0), length=0.18, faces=2500, tex=512, base='bottom'),
    'scallop': dict(rot=(90, 0, 0), length=0.09, faces=1500, tex=512, base='bottom'),
    'barnacle_rock': dict(rot=(0, 0, 0), length=1.6, faces=5000, tex=1024, base='bottom'),
    'rock_boulder': dict(rot=(0, 0, 0), length=2.2, faces=4000, tex=1024, base='bottom'),
    'log': dict(rot=(0, 0, 90), length=4.5, faces=5000, tex=1024, base='bottom', cut_ground=0.04),
}


def _clear():
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.object.delete(use_global=False)
    for coll in (bpy.data.meshes, bpy.data.materials, bpy.data.images, bpy.data.textures):
        for b in list(coll):
            if b.users == 0:
                coll.remove(b)


def _quiet(fn, *a, **k):
    import io, contextlib
    with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
        return fn(*a, **k)


def _import(key):
    _clear()
    _quiet(bpy.ops.import_scene.gltf, filepath=f'{SRC}/{key}.glb')
    meshes = [o for o in bpy.context.scene.objects if o.type == 'MESH']
    # drop small separate pieces (photogrammetry colour-checker cards, stands)
    def diag(o):
        bb = [o.matrix_world @ Vector(c) for c in o.bound_box]
        return (Vector((max(v.x for v in bb), max(v.y for v in bb), max(v.z for v in bb))) -
                Vector((min(v.x for v in bb), min(v.y for v in bb), min(v.z for v in bb)))).length
    # the scan is the densest mesh; placeholder primitives (icospheres, cards) are big but coarse
    main = max(meshes, key=lambda o: len(o.data.polygons))
    big = diag(main)
    nmain = len(main.data.polygons)
    for o in [o for o in meshes if o is not main and (diag(o) < big * 0.12 or len(o.data.polygons) < nmain * 0.01)]:
        bpy.data.objects.remove(o, do_unlink=True)
    meshes = [o for o in bpy.context.scene.objects if o.type == 'MESH']
    bpy.ops.object.select_all(action='DESELECT')
    for o in meshes:
        o.select_set(True)
    bpy.context.view_layer.objects.active = meshes[0]
    if len(meshes) > 1:
        bpy.ops.object.join()
    obj = bpy.context.view_layer.objects.active
    # unparent (glTF imports often nest under empties) keeping the world transform, then bake it
    bpy.ops.object.parent_clear(type='CLEAR_KEEP_TRANSFORM')
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    for o in list(bpy.context.scene.objects):
        if o.type != 'MESH':
            bpy.data.objects.remove(o, do_unlink=True)
    return obj


def _bounds(obj):
    vs = [obj.matrix_world @ v.co for v in obj.data.vertices]
    mn = Vector((min(v.x for v in vs), min(v.y for v in vs), min(v.z for v in vs)))
    mx = Vector((max(v.x for v in vs), max(v.y for v in vs), max(v.z for v in vs)))
    return mn, mx


def _images(obj):
    out = []
    for slot in obj.material_slots:
        m = slot.material
        if not m or not m.use_nodes:
            continue
        for n in m.node_tree.nodes:
            if n.type == 'TEX_IMAGE' and n.image:
                out.append((n.image.name, tuple(n.image.size)))
    return out


def _render(obj, tag):
    sc = bpy.context.scene
    sc.render.engine = 'BLENDER_WORKBENCH'
    sh = sc.display.shading
    sh.light = 'STUDIO'
    sh.color_type = 'TEXTURE'
    sc.render.resolution_x = 520
    sc.render.resolution_y = 360
    sc.render.film_transparent = False
    sc.world = sc.world or bpy.data.worlds.new('World')
    sc.world.color = (0.55, 0.6, 0.65)
    cam = sc.camera
    if cam is None:
        cam = bpy.data.objects.new('Camera', bpy.data.cameras.new('Camera'))
        sc.collection.objects.link(cam)
        sc.camera = cam
    mn, mx = _bounds(obj)
    c = (mn + mx) / 2
    size = max(mx - mn)
    cam.data.type = 'ORTHO'
    cam.data.ortho_scale = size * 1.3
    cam.data.clip_end = size * 30
    paths = []
    # views: from +Y looking -Y (side view, nose should point right = +X), from +Z (top), from +X (front)
    for i, d in enumerate([Vector((0, -1, 0)), Vector((0, 0, 1)), Vector((1, 0, 0))]):
        cam.location = c + d * size * 5
        cam.rotation_euler = (-d).to_track_quat('-Z', 'Y').to_euler()
        p = f'{IMG}/{tag}_{i}.png'
        sc.render.filepath = p
        bpy.ops.render.render(write_still=True)
        paths.append(p)
    return paths


def inspect(key):
    obj = _import(key)
    mn, mx = _bounds(obj)
    info = {'key': key, 'faces': len(obj.data.polygons), 'dims': [round(x, 3) for x in (mx - mn)],
            'min': [round(x, 3) for x in mn], 'images': _images(obj)}
    cfg = SCANS.get(key)
    if cfg:
        _orient(obj, cfg)
        mn, mx = _bounds(obj)
        info['oriented_dims'] = [round(x, 3) for x in (mx - mn)]
    info['renders'] = _render(obj, key)
    return info


def _orient(obj, cfg):
    rot = cfg.get('rot', (0, 0, 0))
    obj.rotation_mode = 'XYZ'  # glTF imports come in quaternion mode, which ignores rotation_euler
    obj.rotation_euler = Euler([math.radians(a) for a in rot], 'XYZ')
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=False)
    if cfg.get('cut_ground'):
        # scans captured lying on the ground include a patch of it: drop faces hugging the lowest plane
        import bmesh
        mn, mx = _bounds(obj)
        lim = mn.z + (mx.z - mn.z) * cfg['cut_ground']
        bm = bmesh.new()
        bm.from_mesh(obj.data)
        dead = [f for f in bm.faces if all(v.co.z < lim for v in f.verts)]
        bmesh.ops.delete(bm, geom=dead, context='FACES')
        loose = [v for v in bm.verts if not v.link_faces]
        bmesh.ops.delete(bm, geom=loose, context='VERTS')
        bm.to_mesh(obj.data)
        bm.free()
        # keep only the biggest connected piece (the log), dropping crumbs of ground
        bpy.ops.object.mode_set(mode='EDIT')
        bpy.ops.mesh.select_all(action='DESELECT')
        bpy.ops.object.mode_set(mode='OBJECT')
    mn, mx = _bounds(obj)
    length = mx.x - mn.x
    s = cfg['length'] / length
    obj.scale = (s, s, s)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    mn, mx = _bounds(obj)
    c = (mn + mx) / 2
    base = cfg.get('base', 'center')
    offset = Vector((-c.x, -c.y, -mn.z if base == 'bottom' else -c.z))
    obj.data.transform(Matrix.Translation(offset))


def _decimate(obj, target):
    import bmesh
    # weld vertices split along UV seams so collapse can work across them (UVs are re-made after)
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    mn, mx = _bounds(obj)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=max(mx - mn) * 2e-5)
    bm.to_mesh(obj.data)
    bm.free()
    obj.data.validate(clean_customdata=False)
    bpy.context.view_layer.objects.active = obj
    for _ in range(6):
        n = len(obj.data.polygons)
        if n <= target * 1.08:
            break
        mod = obj.modifiers.new('Dec', 'DECIMATE')
        mod.decimate_type = 'COLLAPSE'
        mod.ratio = max(0.01, target / n)
        mod.use_collapse_triangulate = True
        bpy.ops.object.modifier_apply(modifier='Dec')
    if len(obj.data.polygons) > target * 1.5:
        # fragmented scans (hair, spines, loose shells) stall collapse: fuse into one manifold first
        mn, mx = _bounds(obj)
        rm = obj.modifiers.new('Rem', 'REMESH')
        rm.mode = 'VOXEL'
        rm.voxel_size = max(mx - mn) / 220
        rm.use_smooth_shade = True
        bpy.ops.object.modifier_apply(modifier='Rem')
        for _ in range(6):
            n = len(obj.data.polygons)
            if n <= target * 1.08:
                break
            mod = obj.modifiers.new('Dec', 'DECIMATE')
            mod.decimate_type = 'COLLAPSE'
            mod.ratio = max(0.01, target / n)
            mod.use_collapse_triangulate = True
            bpy.ops.object.modifier_apply(modifier='Dec')
    obj.data.validate(clean_customdata=False)
    for p in obj.data.polygons:
        p.use_smooth = True


def _setup_cycles():
    sc = bpy.context.scene
    sc.render.engine = 'CYCLES'
    try:
        prefs = bpy.context.preferences.addons['cycles'].preferences
        prefs.compute_device_type = 'METAL'
        prefs.get_devices()
        for d in prefs.devices:
            d.use = True
        sc.cycles.device = 'GPU'
    except Exception:
        sc.cycles.device = 'CPU'
    sc.cycles.samples = 4
    sc.cycles.use_denoising = False


def process(key):
    """High-poly scan -> decimated low-poly with fresh UVs and baked colour + tangent-space normal map."""
    cfg = SCANS[key]
    hi = _import(key)
    _orient(hi, cfg)
    mn, mx = _bounds(hi)
    size = max(mx - mn)
    before = len(hi.data.polygons)

    lo = hi.copy()
    lo.data = hi.data.copy()
    bpy.context.collection.objects.link(lo)
    lo.name = 'scan_' + key
    _decimate(lo, cfg.get('faces', 12000))

    # fresh UVs on the low-poly
    bpy.ops.object.select_all(action='DESELECT')
    lo.select_set(True)
    bpy.context.view_layer.objects.active = lo
    while len(lo.data.uv_layers) > 1:
        lo.data.uv_layers.remove(lo.data.uv_layers[-1])
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.smart_project(angle_limit=math.radians(60), island_margin=0.006)
    bpy.ops.object.mode_set(mode='OBJECT')

    # bake targets
    tex = cfg.get('tex', 1024)
    col = bpy.data.images.new(key + '_col', tex, tex, alpha=False)
    nrm = bpy.data.images.new(key + '_nrm', tex, tex, alpha=False, is_data=True)
    mat = bpy.data.materials.new(key + '_mat')
    mat.use_nodes = True
    nt = mat.node_tree
    bsdf = nt.nodes.get('Principled BSDF')
    n_col = nt.nodes.new('ShaderNodeTexImage'); n_col.image = col
    n_nrm = nt.nodes.new('ShaderNodeTexImage'); n_nrm.image = nrm
    n_nrm.image.colorspace_settings.name = 'Non-Color'
    n_map = nt.nodes.new('ShaderNodeNormalMap')
    nt.links.new(n_col.outputs['Color'], bsdf.inputs['Base Color'])
    nt.links.new(n_nrm.outputs['Color'], n_map.inputs['Color'])
    nt.links.new(n_map.outputs['Normal'], bsdf.inputs['Normal'])
    bsdf.inputs['Roughness'].default_value = 0.55
    lo.data.materials.clear()
    lo.data.materials.append(mat)

    # route every scan material's colour texture straight to emission, so the bake captures albedo
    # whether the source was lit (Principled) or unlit (Sketchfab shadeless)
    for slot in hi.material_slots:
        m = slot.material
        if not m or not m.use_nodes:
            continue
        mnt = m.node_tree
        texs = [n for n in mnt.nodes if n.type == 'TEX_IMAGE' and n.image and n.image.colorspace_settings.name != 'Non-Color']
        out = next((n for n in mnt.nodes if n.type == 'OUTPUT_MATERIAL'), None)
        if not texs or out is None:
            continue
        # prefer the texture actually wired into Base Color; otherwise the largest colour image
        t = None
        for link in mnt.links:
            if link.to_node.type == 'BSDF_PRINCIPLED' and link.to_socket.name == 'Base Color':
                n = link.from_node
                while n is not None and n.type != 'TEX_IMAGE' and n.inputs:
                    ins = [l for l in mnt.links if l.to_node == n]
                    n = ins[0].from_node if ins else None
                if n is not None and n.type == 'TEX_IMAGE':
                    t = n
        if t is None:
            t = max(texs, key=lambda n: n.image.size[0] * n.image.size[1])
        em = mnt.nodes.new('ShaderNodeEmission')
        mnt.links.new(t.outputs['Color'], em.inputs['Color'])
        mnt.links.new(em.outputs['Emission'], out.inputs['Surface'])

    _setup_cycles()
    bpy.ops.object.select_all(action='DESELECT')
    hi.select_set(True)
    lo.select_set(True)
    bpy.context.view_layer.objects.active = lo
    common = dict(use_selected_to_active=True, cage_extrusion=size * 0.012, max_ray_distance=size * 0.04, margin=6)
    nt.nodes.active = n_col
    bpy.ops.object.bake(type='EMIT', **common)
    nt.nodes.active = n_nrm
    bpy.ops.object.bake(type='NORMAL', normal_space='TANGENT', **common)
    col.pack()
    nrm.pack()

    bpy.data.objects.remove(hi, do_unlink=True)
    path = f'{OUT}/scan_{key}.glb'
    bpy.ops.object.select_all(action='DESELECT')
    lo.select_set(True)
    _quiet(bpy.ops.export_scene.gltf,
        filepath=path, export_format='GLB', use_selection=True, export_apply=True,
        export_normals=True, export_texcoords=True, export_materials='EXPORT', export_tangents=False,
        export_image_format='JPEG', export_image_quality=85, export_yup=True,
        export_animations=False, export_skins=False, export_cameras=False, export_lights=False,
    )
    return {'key': key, 'faces_before': before, 'faces': len(lo.data.polygons), 'bytes': os.path.getsize(path),
            'renders': _render(lo, key + '_out')}


# ---------------------------------------------------------------------------------------------
# Background queue: long bakes exceed the MCP request window, so run tasks from a Blender timer.
LOG = IMG + '/queue.log'


def enqueue(tasks):
    """tasks: list of ('process' | 'inspect', key). Progress is appended to LOG."""
    q = list(tasks)

    def _run():
        import traceback as tb
        if not q:
            with open(LOG, 'a') as f:
                f.write('QUEUE DONE\n')
            return None
        kind, key = q.pop(0)
        try:
            if kind == 'process':
                r = process(key)
                msg = f"ok process {key} faces={r['faces']} kb={r['bytes'] // 1024}"
            else:
                r = inspect(key)
                msg = f"ok inspect {key} faces={r['faces']} dims={r['dims']}"
        except Exception:
            msg = f"FAIL {kind} {key} {tb.format_exc()[-600:]}"
        with open(LOG, 'a') as f:
            f.write(msg + '\n')
        return 0.3

    bpy.app.timers.register(_run, first_interval=0.2)
    return len(q)
