"""Render photographic stills of the Bee Home from the reconstructed geometry.

Runs Blender headless via the `bpy` PyPI module — no GUI, no manual modelling,
no licence. Everything is built from `viewer/public/models/*.glb`, so any change
to the geometry pipeline reflows into the imagery on the next run.

    pip install bpy
    python tools/render_stills.py hero
    python tools/render_stills.py assembly
    python tools/render_stills.py detail

The look is aimed at the original launch photography: a warm sand cyclorama,
one hard low sun, and dappled shade from an off-camera gobo standing in for the
tree the original shoot used.
"""

import json
import math
import os
import sys

import bpy

MODELS = "viewer/public/models"
OUT = "docs/renders"
TEXTURE = "docs/reference/textures/WoodPlywood001_COL_2K.jpg"

SAND = (0.760, 0.678, 0.545, 1.0)
WOODS = {
    "birch": (0.945, 0.839, 0.729),
    "oak": (0.851, 0.725, 0.549),
    "larch": (0.808, 0.569, 0.349),
    "walnut": (0.420, 0.290, 0.196),
    "charred": (0.169, 0.153, 0.141),
}


# --- scene construction -----------------------------------------------------

def reset(width, height, samples):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    scene.cycles.device = "CPU"
    scene.cycles.samples = samples
    scene.cycles.use_denoising = True
    scene.render.resolution_x = width
    scene.render.resolution_y = height
    scene.render.film_transparent = False
    scene.view_settings.view_transform = "AgX"
    scene.view_settings.look = "AgX - Medium High Contrast"

    world = bpy.data.worlds.new("world")
    scene.world = world
    world.use_nodes = True
    bg = world.node_tree.nodes["Background"]
    bg.inputs[0].default_value = (0.62, 0.68, 0.80, 1.0)  # cool sky bounce
    bg.inputs[1].default_value = 0.38
    return scene


def wood_material(name, rgb):
    """Triplanar plywood — the meshes carry no UVs, so project in the shader."""
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nodes, links = mat.node_tree.nodes, mat.node_tree.links
    bsdf = nodes["Principled BSDF"]
    bsdf.inputs["Roughness"].default_value = 0.62

    if os.path.exists(TEXTURE):
        coord = nodes.new("ShaderNodeTexCoord")
        mapping = nodes.new("ShaderNodeMapping")
        mapping.inputs["Scale"].default_value = (0.006, 0.006, 0.006)
        tex = nodes.new("ShaderNodeTexImage")
        tex.image = bpy.data.images.load(os.path.abspath(TEXTURE))
        tex.projection = "BOX"
        tex.projection_blend = 0.25
        mix = nodes.new("ShaderNodeMixRGB")
        mix.blend_type = "MULTIPLY"
        mix.inputs["Fac"].default_value = 1.0
        links.new(coord.outputs["Object"], mapping.inputs["Vector"])
        links.new(mapping.outputs["Vector"], tex.inputs["Vector"])
        links.new(tex.outputs["Color"], mix.inputs["Color1"])
        mix.inputs["Color2"].default_value = (*rgb, 1.0)
        # Ply laminations: fine bands running up the sheet thickness, which is
        # what you actually read on a cut edge of plywood.
        sep = nodes.new("ShaderNodeSeparateXYZ")
        wave = nodes.new("ShaderNodeTexWave")
        wave.wave_type = "BANDS"
        wave.bands_direction = "Z"
        wave.inputs["Scale"].default_value = 260.0
        wave.inputs["Distortion"].default_value = 1.2
        wave.inputs["Detail"].default_value = 2.0
        plymix = nodes.new("ShaderNodeMixRGB")
        plymix.blend_type = "MULTIPLY"
        plymix.inputs["Fac"].default_value = 0.10
        links.new(coord.outputs["Object"], sep.inputs["Vector"])
        links.new(coord.outputs["Object"], wave.inputs["Vector"])
        links.new(mix.outputs["Color"], plymix.inputs["Color1"])
        links.new(wave.outputs["Color"], plymix.inputs["Color2"])
        links.new(plymix.outputs["Color"], bsdf.inputs["Base Color"])

        # A little roughness break-up so the surface is not uniformly matte.
        rough = nodes.new("ShaderNodeTexNoise")
        rough.inputs["Scale"].default_value = 40.0
        roughmix = nodes.new("ShaderNodeMapRange")
        roughmix.inputs["To Min"].default_value = 0.50
        roughmix.inputs["To Max"].default_value = 0.70
        links.new(coord.outputs["Object"], rough.inputs["Vector"])
        links.new(rough.outputs["Fac"], roughmix.inputs["Value"])
        links.new(roughmix.outputs["Result"], bsdf.inputs["Roughness"])
    else:
        bsdf.inputs["Base Color"].default_value = (*rgb, 1.0)
    return mat


def backdrop():
    """Floor and back wall in one warm sand tone, like a paper sweep."""
    mat = bpy.data.materials.new("sand")
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = SAND
    bsdf.inputs["Roughness"].default_value = 0.94
    nodes, links = mat.node_tree.nodes, mat.node_tree.links
    grain = nodes.new("ShaderNodeTexNoise")
    grain.inputs["Scale"].default_value = 220.0
    grain.inputs["Detail"].default_value = 6.0
    bump = nodes.new("ShaderNodeBump")
    bump.inputs["Strength"].default_value = 0.12
    links.new(grain.outputs["Fac"], bump.inputs["Height"])
    links.new(bump.outputs["Normal"], bsdf.inputs["Normal"])

    bpy.ops.mesh.primitive_plane_add(size=14)
    floor = bpy.context.object
    floor.data.materials.append(mat)

    bpy.ops.mesh.primitive_plane_add(size=14)
    wall = bpy.context.object
    wall.rotation_euler = (math.radians(90), 0, 0)
    wall.location = (0, 1.5, 7)
    wall.data.materials.append(mat)
    return floor, wall


def sun_with_dapple():
    """One hard sun plus an off-camera gobo casting leaf-like shade."""
    bpy.ops.object.light_add(type="SUN", location=(-4, -3, 6))
    sun = bpy.context.object
    sun.data.energy = 5.6
    sun.data.angle = math.radians(1.6)
    sun.data.color = (1.0, 0.945, 0.855)
    sun.rotation_euler = (math.radians(52), 0, math.radians(-38))

    # A plane between sun and subject, transparent except where a noise mask
    # thresholds to opaque — reads as foliage without modelling a tree.
    bpy.ops.mesh.primitive_plane_add(size=12, location=(-0.9, -0.6, 2.2))
    gobo = bpy.context.object
    gobo.visible_camera = False
    gobo.visible_diffuse = False
    gobo.visible_glossy = False

    mat = bpy.data.materials.new("gobo")
    mat.use_nodes = True
    mat.blend_method = "BLEND"
    nodes, links = mat.node_tree.nodes, mat.node_tree.links
    bsdf = nodes["Principled BSDF"]
    # Voronoi cells warped by noise read as overlapping leaves; plain noise
    # reads as cloud, which is the wrong kind of shadow entirely.
    warp = nodes.new("ShaderNodeTexNoise")
    warp.inputs["Scale"].default_value = 1.8
    warp.inputs["Detail"].default_value = 4.0
    disp = nodes.new("ShaderNodeVectorMath")
    disp.operation = "ADD"
    coord = nodes.new("ShaderNodeTexCoord")
    cells = nodes.new("ShaderNodeTexVoronoi")
    cells.feature = "SMOOTH_F1"
    cells.inputs["Scale"].default_value = 5.5
    cells.inputs["Smoothness"].default_value = 0.55
    ramp = nodes.new("ShaderNodeValToRGB")
    ramp.color_ramp.elements[0].position = 0.20
    ramp.color_ramp.elements[1].position = 0.46
    links.new(coord.outputs["Object"], disp.inputs[0])
    links.new(coord.outputs["Object"], warp.inputs["Vector"])
    links.new(warp.outputs["Color"], disp.inputs[1])
    links.new(disp.outputs["Vector"], cells.inputs["Vector"])
    links.new(cells.outputs["Distance"], ramp.inputs["Fac"])
    links.new(ramp.outputs["Color"], bsdf.inputs["Alpha"])
    gobo.data.materials.append(mat)

    # A big soft bounce opposite the sun, so cavities go deep brown rather than
    # to pure black the way they did without it.
    bpy.ops.object.light_add(type="AREA", location=(1.6, -1.3, 0.7))
    fill = bpy.context.object
    fill.data.shape = "RECTANGLE"
    fill.data.size, fill.data.size_y = 3.0, 2.0
    fill.data.energy = 22.0
    fill.data.color = (1.0, 0.96, 0.90)
    fill.rotation_euler = (math.radians(78), 0, math.radians(52))
    return sun


def frame(objects, azimuth=-58, elevation=14, lens=70, margin=1.5):
    """Point a camera at the bounding box of `objects` and back off to fit it.

    Framing from the geometry rather than hand-placed coordinates means the
    shots survive any change to the stacks below.
    """
    from mathutils import Vector

    # Transforms set via the API are lazy — without this the bound boxes still
    # read as the un-scaled millimetre geometry and the camera ends up in orbit.
    bpy.context.view_layer.update()

    corners = [obj.matrix_world @ Vector(c) for obj in objects for c in obj.bound_box]
    lo = Vector((min(c[i] for c in corners) for i in range(3)))
    hi = Vector((max(c[i] for c in corners) for i in range(3)))
    centre = (lo + hi) / 2
    radius = max((hi - lo).length / 2, 0.02)

    sensor = 36.0
    distance = (radius * margin) / math.tan(math.atan(sensor / (2 * lens)))
    a, e = math.radians(azimuth), math.radians(elevation)
    location = centre + Vector((
        distance * math.cos(e) * math.sin(a),
        -distance * math.cos(e) * math.cos(a),
        distance * math.sin(e),
    ))

    bpy.ops.object.camera_add(location=location)
    cam = bpy.context.object
    cam.data.lens = lens
    empty = bpy.data.objects.new("target", None)
    bpy.context.collection.objects.link(empty)
    empty.location = centre
    cam.constraints.new("TRACK_TO").target = empty
    cam.data.dof.use_dof = True
    cam.data.dof.focus_object = empty
    cam.data.dof.aperture_fstop = 9.0
    bpy.context.scene.camera = cam
    return cam


# --- model assembly ---------------------------------------------------------

# The glTF files are millimetre-scaled and Y-up as written. Blender's importer
# leaves the object in quaternion rotation mode, so assigning rotation_euler is
# silently ignored — the mode has to be switched first, the correction applied
# to the mesh data, and only then can scale and placement behave predictably.
MM = 0.001


def load_part(path):
    """Import one part, orient it Z-up, and report its size in millimetres."""
    from mathutils import Vector

    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=os.path.abspath(path))
    new_objects = [o for o in bpy.data.objects if o not in before and o.type == "MESH"]

    bpy.ops.object.select_all(action="DESELECT")
    for obj in new_objects:
        obj.parent = None
        obj.rotation_mode = "XYZ"
        obj.rotation_euler = (math.radians(90), 0, 0)
        obj.select_set(True)
        bpy.context.view_layer.objects.active = obj
    bpy.ops.object.transform_apply(rotation=True)

    for obj in new_objects:
        repair(obj)
        bevel(obj)

    corners = [Vector(c) for obj in new_objects for c in obj.bound_box]
    z_min = min(c.z for c in corners)
    height = max(c.z for c in corners) - z_min
    return new_objects, height, z_min


def repair(obj):
    """Weld, re-orient and close the mesh.

    The triangulator in tools/mesh_storeys.py groups faces by supporting plane,
    and near-coplanar faces can merge into one group and lose a triangle. Those
    gaps are invisible in the flat-shaded web viewer but read as black slivers
    under a path tracer, so the holes get closed here.
    """
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.mesh.remove_doubles(threshold=0.0005)
    bpy.ops.mesh.normals_make_consistent(inside=False)
    bpy.ops.mesh.select_all(action="DESELECT")
    bpy.ops.mesh.select_non_manifold(extend=False)
    bpy.ops.mesh.fill_holes(sides=8)
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.mesh.normals_make_consistent(inside=False)
    bpy.ops.object.mode_set(mode="OBJECT")


def bevel(obj):
    """A 0.2 mm radius on every cut edge.

    Perfectly sharp edges are the loudest CG tell there is — real sawn plywood
    catches a thin highlight along every arris. Geometry is in millimetres here,
    so the width is in millimetres too.
    """
    mod = obj.modifiers.new("bevel", "BEVEL")
    mod.width = 0.18
    mod.segments = 2
    mod.limit_method = "ANGLE"
    mod.angle_limit = math.radians(40)
    mod.harden_normals = False


def place(obj, x, y, z, z_min, z_stretch=1.0):
    """Sit a part with its underside at world height `z`."""
    obj.location = (x, y, z - z_min * MM * z_stretch)
    obj.scale = (MM, MM, MM * z_stretch)


def paint(objects, wood):
    mat = wood_material(f"wood_{wood}", WOODS[wood])
    for obj in objects:
        obj.data.materials.clear()
        obj.data.materials.append(mat)
    return objects


def build(index, letters, woods, origin=(0, 0), lift=0.0):
    """Stack `letters` at `origin`, each part sitting on the one below."""
    z = lift
    placed = []
    for i, letter in enumerate(letters):
        name = os.path.basename(index["storeys"][letter]["a"]["file"])
        parts, height, z_min = load_part(os.path.join(MODELS, name))
        for obj in parts:
            place(obj, origin[0], origin[1], z, z_min)
        placed += paint(parts, woods[i % len(woods)])
        # A 0.05 mm air gap between trays. They touch in reality, but coplanar
        # contact faces z-fight under a path tracer and read as dark slivers.
        z += height * MM + 0.00005
    return placed, z


def add_support(index, origin, lift, wood="birch"):
    """Base plate plus four legs, the legs stretched to whatever lift is asked."""
    objs = []
    base_parts, base_h, base_zmin = load_part(os.path.join(MODELS, "base.glb"))
    for obj in base_parts:
        place(obj, origin[0], origin[1], lift - base_h * MM, base_zmin)
    objs += base_parts

    leg_top = lift - base_h * MM
    if leg_top > 0.001:
        for sx, sy in ((-1, -1), (1, -1), (-1, 1), (1, 1)):
            leg_parts, leg_h, leg_zmin = load_part(os.path.join(MODELS, "leg.glb"))
            stretch = (leg_top / MM) / leg_h
            for obj in leg_parts:
                place(obj, origin[0] + sx * 0.048, origin[1] + sy * 0.062, 0,
                      leg_zmin, z_stretch=stretch)
            objs += leg_parts
    return paint(objs, wood)


def render(path):
    os.makedirs(OUT, exist_ok=True)
    bpy.context.scene.render.filepath = os.path.abspath(path)
    bpy.ops.render.render(write_still=True)
    print("wrote", path)


# --- shots ------------------------------------------------------------------

def shot_hero(index, samples):
    """A family of Bee Homes at different heights, as the launch photo had."""
    reset(1600, 1000, samples)
    backdrop()
    sun_with_dapple()
    family = [
        (["A", "B", "C"], 0.10, (-0.42, 0.05), ["birch"]),
        (["N", "O", "P", "M"], 0.30, (-0.16, -0.02), ["oak"]),
        (["D", "F", "G", "H", "M"], 0.52, (0.13, 0.06), ["birch", "birch", "walnut"]),
        (["I", "J", "C", "M"], 0.22, (0.40, -0.04), ["larch"]),
    ]
    subject = []
    for letters, lift, origin, woods in family:
        placed, _ = build(index, letters, woods, origin=origin, lift=lift)
        subject += placed + add_support(index, origin, lift)
    frame(subject, azimuth=-52, elevation=11, lens=80, margin=1.28)
    render(f"{OUT}/hero.png")


def shot_assembly(index, samples):
    """Five build states, same camera — the assembly WIP sequence."""
    letters = ["A", "P", "P", "M"]
    for step in range(5):
        reset(1300, 1000, samples)
        backdrop()
        sun_with_dapple()
        lift = 0.16
        subject = []
        shown = letters[: max(0, step - 1)] if step else []
        if step >= 1:
            subject += add_support(index, (0, 0), lift)
        stack_top = lift
        if shown:
            placed, stack_top = build(index, shown, ["birch"], origin=(0, 0), lift=lift)
            subject += placed
        # The next part to go on hovers above the stack.
        if 1 <= step < 5 and len(shown) < len(letters):
            nxt = letters[len(shown)]
            parts, _, z_min = load_part(os.path.join(MODELS, f"{nxt}_a.glb"))
            for obj in parts:
                place(obj, 0, 0, stack_top + 0.075, z_min)
            subject += paint(parts, "oak")
        if not subject:
            continue
        frame(subject, azimuth=-48, elevation=17, lens=76, margin=1.7)
        render(f"{OUT}/assembly-{step}.png")


def shot_detail(index, samples):
    """Macro on the tunnel mouths and the spine-and-key joinery."""
    reset(1400, 1000, samples)
    backdrop()
    sun_with_dapple()
    placed, _ = build(index, ["N", "O", "P", "M"], ["birch", "oak", "birch"], lift=0.06)
    subject = placed + add_support(index, (0, 0), 0.06)
    frame(subject, azimuth=-40, elevation=8, lens=110, margin=1.15)
    render(f"{OUT}/detail.png")


def main():
    shot = sys.argv[1] if len(sys.argv) > 1 else "hero"
    samples = int(sys.argv[2]) if len(sys.argv) > 2 else 96
    with open(f"{MODELS}/index.json") as fh:
        index = json.load(fh)
    {"hero": shot_hero, "assembly": shot_assembly, "detail": shot_detail}[shot](index, samples)


if __name__ == "__main__":
    main()
