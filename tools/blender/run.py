"""Executed inside Blender via MCP. Usage:
    exec(open(ROOT + '/tools/blender/run.py').read())
    result = preview('orca')           # build, render 3 views, export GLB
"""
import sys, os, importlib, math
import bpy
from mathutils import Vector

ROOT = '/Users/brandon/Portfolio Site'
TOOLS = ROOT + '/tools/blender'
OUT_IMG = '/private/tmp/claude-501/-Users-brandon-Portfolio-Site/932f55f2-9f33-43c6-8926-e87a1b9e7fd6/scratchpad/renders'
OUT_GLB = ROOT + '/public/models'
os.makedirs(OUT_IMG, exist_ok=True)
os.makedirs(OUT_GLB, exist_ok=True)
if TOOLS not in sys.path:
    sys.path.insert(0, TOOLS)
import lib, creatures
importlib.reload(lib)
importlib.reload(creatures)


def setup_render():
    sc = bpy.context.scene
    sc.render.engine = 'BLENDER_WORKBENCH'
    sh = sc.display.shading
    sh.light = 'STUDIO'
    sh.color_type = 'VERTEX'
    sh.show_shadows = False
    sh.show_cavity = True
    sh.cavity_type = 'BOTH'
    sc.render.resolution_x = 720
    sc.render.resolution_y = 480
    sc.render.resolution_percentage = 100
    sc.render.film_transparent = False
    sc.world = sc.world or bpy.data.worlds.new('World')
    sc.world.color = (0.55, 0.6, 0.65)
    sc.view_settings.view_transform = 'Standard'


def frame_camera(obj, azimuth_deg, elev_deg, pad=1.35):
    sc = bpy.context.scene
    cam = sc.camera
    if cam is None:
        cd = bpy.data.cameras.new('Camera')
        cam = bpy.data.objects.new('Camera', cd)
        sc.collection.objects.link(cam)
        sc.camera = cam
    (x0, x1), (y0, y1), (z0, z1) = lib.bounds(obj)
    centre = Vector(((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2))
    size = max(x1 - x0, y1 - y0, z1 - z0)
    cam.data.type = 'ORTHO'
    cam.data.ortho_scale = size * pad
    az = math.radians(azimuth_deg)
    el = math.radians(elev_deg)
    d = Vector((math.cos(el) * math.cos(az), math.cos(el) * math.sin(az), math.sin(el)))
    cam.location = centre + d * size * 4
    cam.data.clip_end = size * 20
    q = (-d).to_track_quat('-Z', 'Y')
    cam.rotation_euler = q.to_euler()


def render(obj, tag, views=((35, 22), (90, 5))):
    setup_render()
    paths = []
    for i, (az, el) in enumerate(views):
        frame_camera(obj, az, el)
        p = f'{OUT_IMG}/{tag}_{i}.png'
        bpy.context.scene.render.filepath = p
        bpy.ops.render.render(write_still=True)
        paths.append(p)
    return paths


def contact_sheet(paths, out):
    """Stitch renders horizontally using Blender's image API (no PIL)."""
    imgs = [bpy.data.images.load(p) for p in paths]
    w = sum(i.size[0] for i in imgs)
    h = max(i.size[1] for i in imgs)
    sheet = bpy.data.images.new('sheet', w, h)
    px = [0.0] * (w * h * 4)
    x_off = 0
    for im in imgs:
        iw, ih = im.size
        src = list(im.pixels)
        for y in range(ih):
            row_src = src[y * iw * 4:(y + 1) * iw * 4]
            start = (y * w + x_off) * 4
            px[start:start + iw * 4] = row_src
        x_off += iw
    sheet.pixels = px
    sheet.filepath_raw = out
    sheet.file_format = 'PNG'
    sheet.save()
    for im in imgs:
        bpy.data.images.remove(im)
    bpy.data.images.remove(sheet)
    return out


def preview(name, export=True):
    importlib.reload(lib)
    importlib.reload(creatures)
    lib.clear_scene()
    obj = creatures.ALL[name]()
    paths = render(obj, name)
    sheet = contact_sheet(paths, f'{OUT_IMG}/{name}.png')
    info = {'name': name, 'verts': len(obj.data.vertices), 'faces': len(obj.data.polygons), 'sheet': sheet,
            'bounds': lib.bounds(obj)}
    if export:
        glb = f'{OUT_GLB}/{name}.glb'
        lib.export_glb([obj.name], glb)
        info['glb'] = glb
        info['bytes'] = os.path.getsize(glb)
    return info


def export_all(names=None):
    out = {}
    for n in (names or list(creatures.ALL)):
        try:
            out[n] = preview(n, export=True)
            out[n].pop('bounds', None)
        except Exception as e:
            import traceback
            out[n] = 'ERR ' + traceback.format_exc()[-600:]
    return out
