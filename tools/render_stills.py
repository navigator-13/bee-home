"""Render product photography of the Bee Home from the reconstructed geometry.

Runs Blender headless via the `bpy` PyPI module — no GUI, no manual modelling,
no licence. The product itself is built from `viewer/public/models/*.glb`, so
any change to the geometry pipeline reflows into the imagery on the next run.

    pip install bpy
    python3 tools/fetch_assets.py               # once: pull the CC0 assets
    python3 tools/render_stills.py all          # the whole set, final quality
    python3 tools/render_stills.py all draft    # same framing, quick and small
    python3 tools/render_stills.py workshop-bench

Two sets, both lit by real Poly Haven HDRIs (CC0, cached under
`assets/third_party/` by `tools/fetch_assets.py`):

  workshop — a dressed bench in a plank-walled shop, keyed by a window off to
             the left. The shop is real geometry and real scanned props, not a
             blurred suggestion of one.
  studio   — a white seamless sweep, soft key. Four subjects, one lighting.

Focus is deep throughout. The launch photography is deep-focus daylight where
everything stays legible, and an f/2.8 wash over the background is both the
wrong reference and a way of hiding a set rather than building one.

Every stack is capped with `roof.glb`. The original was never photographed
ending on the open cavity channels of the last storey, and neither is this.
"""

import json
import math
import os
import random
import sys

import bpy

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import fetch_assets

MODELS = "viewer/public/models"
OUT = "docs/renders"
TEXTURE = "docs/reference/textures/WoodPlywood001_COL_2K.jpg"

# Tints multiplied over the plywood scan, which is a very light sheet: its mean
# linear value is (0.94, 0.74, 0.55), so a tint near white leaves the timber
# nearly white too.
#
# These are calibrated against the launch photography, not picked by eye. That
# photography is lit by warm low sun on a cream paper sweep, so the raw pixels
# are much warmer than the timber is; white-balanced against the sweep, a lit
# face sits at sRGB (190, 153, 115) — hue 30, saturation 0.39, value 0.75. The
# previous palette rendered a lit face at hue 25, value 0.67, which is a full
# five degrees to the red of the reference and a stop under it: terracotta.
# Everything below lands at hue 29-31 with the value up where the reference has
# it, and is checked under both the studio key and the workshop window, since
# the workshop light is cooler and drags the same tint several degrees back.
WOODS = {
    "birch": (0.560, 0.382, 0.186),   # pale northern ply, the default
    "ash": (0.505, 0.362, 0.205),     # a shade cooler and greyer
    "beech": (0.610, 0.402, 0.180),   # a shade warmer, still pale
    "walnut": (0.150, 0.092, 0.068),  # dark accent band
    "charred": (0.032, 0.030, 0.031),
}

# The glTF files are millimetre-scaled and Y-up as written. Blender's importer
# leaves the object in quaternion rotation mode, so assigning rotation_euler is
# silently ignored — the mode has to be switched first, the correction applied
# to the mesh data, and only then can scale and placement behave predictably.
MM = 0.001

DRAFT = False


# --- scene construction -----------------------------------------------------

def reset(width, height, samples, look="AgX - Medium High Contrast"):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    scene.cycles.device = "CPU"
    scene.cycles.samples = samples
    scene.cycles.use_denoising = True
    scene.cycles.use_adaptive_sampling = True
    scene.render.resolution_x = width
    scene.render.resolution_y = height
    scene.render.film_transparent = False
    scene.view_settings.view_transform = "AgX"
    scene.view_settings.look = look
    random.seed(7)
    return scene


def node_material(name):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    return mat, mat.node_tree.nodes, mat.node_tree.links


def wood_material(name, rgb, roughness=0.62, scale=0.006):
    """Triplanar plywood — the meshes carry no UVs, so project in the shader."""
    mat, nodes, links = node_material(name)
    bsdf = nodes["Principled BSDF"]
    bsdf.inputs["Roughness"].default_value = roughness
    # Sawn plywood is close to a pure diffuser. Left at the default, the narrow
    # vertical faces of the spine catch the sky at a grazing angle and come back
    # as flat grey bars laid over the timber.
    if "Specular IOR Level" in bsdf.inputs:
        bsdf.inputs["Specular IOR Level"].default_value = 0.22

    if os.path.exists(TEXTURE):
        coord = nodes.new("ShaderNodeTexCoord")
        mapping = nodes.new("ShaderNodeMapping")
        mapping.inputs["Scale"].default_value = (scale, scale, scale)
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
        wave = nodes.new("ShaderNodeTexWave")
        wave.wave_type = "BANDS"
        wave.bands_direction = "Z"
        wave.inputs["Scale"].default_value = 260.0
        wave.inputs["Distortion"].default_value = 1.2
        wave.inputs["Detail"].default_value = 2.0
        plymix = nodes.new("ShaderNodeMixRGB")
        plymix.blend_type = "MULTIPLY"
        plymix.inputs["Fac"].default_value = 0.10
        links.new(coord.outputs["Object"], wave.inputs["Vector"])
        links.new(mix.outputs["Color"], plymix.inputs["Color1"])
        links.new(wave.outputs["Color"], plymix.inputs["Color2"])
        links.new(plymix.outputs["Color"], bsdf.inputs["Base Color"])

        # A little roughness break-up so the surface is not uniformly matte.
        rough = nodes.new("ShaderNodeTexNoise")
        rough.inputs["Scale"].default_value = 40.0
        roughmix = nodes.new("ShaderNodeMapRange")
        roughmix.inputs["To Min"].default_value = roughness - 0.12
        roughmix.inputs["To Max"].default_value = roughness + 0.08
        links.new(coord.outputs["Object"], rough.inputs["Vector"])
        links.new(rough.outputs["Fac"], roughmix.inputs["Value"])
        links.new(roughmix.outputs["Result"], bsdf.inputs["Roughness"])
    else:
        bsdf.inputs["Base Color"].default_value = (*rgb, 1.0)
    return mat


# --- third-party assets -----------------------------------------------------
#
# HDRIs, PBR texture sets and scanned props, all CC0 from Poly Haven. Fetched
# and cached by tools/fetch_assets.py; resolved lazily so `audit` and anything
# else that only touches the product geometry runs without them.

_ASSETS = None


def assets():
    global _ASSETS
    if _ASSETS is None:
        _ASSETS = fetch_assets.ensure()
    return _ASSETS


def hdri_world(slug, strength=1.0, rotation=0.0, camera_color=None):
    """Light the scene from a real captured environment.

    `camera_color` swaps what the *camera* sees for a flat colour while leaving
    the lighting untouched — a Light Path mix rather than a visibility flag,
    which is the one spelling that has survived every Cycles version. The sets
    here are enclosed, so this only ever matters as insurance against a sliver
    of someone else's room showing through a gap in a wall.
    """
    scene = bpy.context.scene
    world = bpy.data.worlds.new("env")
    scene.world = world
    world.use_nodes = True
    nodes, links = world.node_tree.nodes, world.node_tree.links
    out = nodes["World Output"]
    bg = nodes["Background"]
    bg.inputs["Strength"].default_value = strength

    coord = nodes.new("ShaderNodeTexCoord")
    mapping = nodes.new("ShaderNodeMapping")
    mapping.inputs["Rotation"].default_value = (0, 0, rotation)
    env = nodes.new("ShaderNodeTexEnvironment")
    env.image = bpy.data.images.load(os.path.abspath(assets()["hdri"][slug]))
    links.new(coord.outputs["Generated"], mapping.inputs["Vector"])
    links.new(mapping.outputs["Vector"], env.inputs["Vector"])
    links.new(env.outputs["Color"], bg.inputs["Color"])

    if camera_color is not None:
        flat = nodes.new("ShaderNodeBackground")
        flat.inputs["Color"].default_value = (*camera_color, 1.0)
        flat.inputs["Strength"].default_value = 1.0
        path = nodes.new("ShaderNodeLightPath")
        mix = nodes.new("ShaderNodeMixShader")
        links.new(path.outputs["Is Camera Ray"], mix.inputs["Fac"])
        links.new(bg.outputs["Background"], mix.inputs[1])
        links.new(flat.outputs["Background"], mix.inputs[2])
        links.new(mix.outputs["Shader"], out.inputs["Surface"])
    return world


def pbr_material(name, slug, scale=1.0, tint=None, rough_scale=1.0, bump=1.0):
    """A scanned surface — colour, roughness and normal — projected triplanar.

    Box projection off object coordinates rather than UVs, for the same reason
    the timber shader does it: these surfaces are `slab()` primitives whose scale
    is applied to the mesh, so their UVs are stretched by whatever aspect the
    slab happens to be. Object space is metres, so `scale` is in tiles per metre
    and a bench and a wall can share one material at honest sizes.
    """
    tex = assets()["texture"][slug]
    mat, nodes, links = node_material(name)
    bsdf = nodes["Principled BSDF"]
    coord = nodes.new("ShaderNodeTexCoord")
    mapping = nodes.new("ShaderNodeMapping")
    mapping.inputs["Scale"].default_value = (scale, scale, scale)
    links.new(coord.outputs["Object"], mapping.inputs["Vector"])

    def image(path, non_color):
        node = nodes.new("ShaderNodeTexImage")
        node.image = bpy.data.images.load(os.path.abspath(path))
        node.projection = "BOX"
        node.projection_blend = 0.3
        if non_color:
            node.image.colorspace_settings.name = "Non-Color"
        links.new(mapping.outputs["Vector"], node.inputs["Vector"])
        return node

    if "diff" in tex:
        diff = image(tex["diff"], False)
        if tint is None:
            links.new(diff.outputs["Color"], bsdf.inputs["Base Color"])
        else:
            mix = nodes.new("ShaderNodeMixRGB")
            mix.blend_type = "MULTIPLY"
            mix.inputs["Fac"].default_value = 1.0
            mix.inputs["Color2"].default_value = (*tint, 1.0)
            links.new(diff.outputs["Color"], mix.inputs["Color1"])
            links.new(mix.outputs["Color"], bsdf.inputs["Base Color"])
    if "rough" in tex:
        rough = image(tex["rough"], True)
        remap = nodes.new("ShaderNodeMapRange")
        remap.inputs["To Min"].default_value = 0.30 * rough_scale
        remap.inputs["To Max"].default_value = 0.95 * rough_scale
        links.new(rough.outputs["Color"], remap.inputs["Value"])
        links.new(remap.outputs["Result"], bsdf.inputs["Roughness"])
    if "nor" in tex:
        nor = image(tex["nor"], True)
        nmap = nodes.new("ShaderNodeNormalMap")
        nmap.inputs["Strength"].default_value = bump
        links.new(nor.outputs["Color"], nmap.inputs["Color"])
        links.new(nmap.outputs["Normal"], bsdf.inputs["Normal"])
    return mat


def load_prop(slug, at, rotation=(0, 0, 0), scale=1.0, sit=True):
    """Drop a scanned prop onto a surface.

    Placement is by *footprint*, not by origin: the prop is centred on `at` in x
    and y and its lowest vertex is set to `at.z`. Poly Haven origins sit
    wherever the scan happened to land — a hand plane whose origin is a third of
    the way up the body will float or sink if you trust it — and the whole point
    of dressing a bench is that things touch it.
    """
    from mathutils import Vector

    path = assets()["model"][slug]
    gltf = [f for f in sorted(os.listdir(path)) if f.endswith(".gltf")][0]
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=os.path.abspath(os.path.join(path, gltf)))
    new = [o for o in bpy.data.objects if o not in before]
    meshes = [o for o in new if o.type == "MESH"]

    root = bpy.data.objects.new(f"prop_{slug}", None)
    bpy.context.collection.objects.link(root)
    for obj in new:
        if obj.parent is None:
            obj.parent = root
    root.rotation_mode = "XYZ"
    root.rotation_euler = rotation
    root.scale = (scale, scale, scale)
    bpy.context.view_layer.update()

    corners = [o.matrix_world @ Vector(c) for o in meshes for c in o.bound_box]
    lo = Vector((min(c[i] for c in corners) for i in range(3)))
    hi = Vector((max(c[i] for c in corners) for i in range(3)))
    root.location = (at[0] - (lo.x + hi.x) / 2,
                     at[1] - (lo.y + hi.y) / 2,
                     at[2] - (lo.z if sit else (lo.z + hi.z) / 2))
    bpy.context.view_layer.update()
    return meshes


def plane(size, location=(0, 0, 0), rotation=(0, 0, 0)):
    bpy.ops.mesh.primitive_plane_add(size=size, location=location)
    obj = bpy.context.object
    obj.rotation_euler = rotation
    return obj


def slab(width, depth, height, location):
    """A box with its top face at `location.z`.

    The scale is applied to the mesh, not left on the object. Texture Coordinate
    > Object reads the *local* space, so a unit cube stretched to bench size
    still measures one unit across and every wood shader on it collapses to a
    single flat colour — which is why the bench had no grain on it at all.

    The cube is added at the origin and moved afterwards, and `transform_apply`
    is told explicitly which channels to bake. Adding it at `location` and
    trusting the operator's defaults bakes the offset into the mesh *as well as*
    leaving it on the object, so everything built this way lands at twice the x
    and y it was asked for. That put every wall of the workshop metres out of
    place and left the offcuts hovering above the bench.
    """
    bpy.ops.mesh.primitive_cube_add(size=1, location=(0, 0, 0))
    obj = bpy.context.object
    obj.scale = (width, depth, height)
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    obj.location = (location[0], location[1], location[2] - height / 2)
    return obj


# --- environments -----------------------------------------------------------
#
# Each returns nothing but leaves a complete lit set behind: world, ground at
# z = 0, background, and key/fill. The subject is always built on top of z = 0.

def steel_material(name, colour=(0.615, 0.625, 0.645), roughness=0.34):
    mat, nodes, links = node_material(name)
    bsdf = nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = (*colour, 1.0)
    bsdf.inputs["Metallic"].default_value = 0.92
    bsdf.inputs["Roughness"].default_value = roughness
    wear = nodes.new("ShaderNodeTexNoise")
    wear.inputs["Scale"].default_value = 90.0
    wear.inputs["Detail"].default_value = 6.0
    remap = nodes.new("ShaderNodeMapRange")
    remap.inputs["To Min"].default_value = roughness - 0.10
    remap.inputs["To Max"].default_value = roughness + 0.22
    links.new(wear.outputs["Fac"], remap.inputs["Value"])
    links.new(remap.outputs["Result"], bsdf.inputs["Roughness"])
    return mat


def flat_material(name, colour, roughness=0.7):
    mat, nodes, _ = node_material(name)
    nodes["Principled BSDF"].inputs["Base Color"].default_value = (*colour, 1.0)
    nodes["Principled BSDF"].inputs["Roughness"].default_value = roughness
    return mat


def shaving(name, radius=0.013, turns=2.3, length=0.055, width=0.016, steps=30):
    """One curl of plane shaving: a ribbon wound round an axis, tapering.

    A plane throws a spiral, not a chip, and the spiral is most of what says
    somebody was working here a minute ago. Modelled rather than scattered from
    a texture because at f/9 a flake painted on the bench is obvious.
    """
    verts, faces = [], []
    for i in range(steps + 1):
        t = i / steps
        angle = t * turns * math.tau
        r = radius * (1.0 - 0.42 * t)
        x, z = r * math.cos(angle), r * math.sin(angle)
        y = length * (t - 0.5)
        half = width * (1.0 - 0.30 * t) / 2
        verts += [(x, y - half, z), (x, y + half, z)]
    for i in range(steps):
        a = i * 2
        faces.append((a, a + 1, a + 3, a + 2))
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(verts, [], faces)
    mesh.update()
    return mesh


def try_square(origin, yaw, wood, steel):
    """Stock and blade. Pure silhouette — an L is legible at any size."""
    stock = slab(0.022, 0.115, 0.014, (0, 0, 0.014))
    stock.data.materials.append(wood)
    blade = slab(0.155, 0.030, 0.003, (0.078, 0.036, 0.006))
    blade.data.materials.append(steel)
    parts = [stock, blade]
    root = bpy.data.objects.new("try_square", None)
    bpy.context.collection.objects.link(root)
    for part in parts:
        part.parent = root
    root.rotation_euler = (0, 0, yaw)
    root.location = origin
    return parts


def env_workshop(dress=True):
    """A toymaker's bench in a plank-walled shop, keyed by a window off left.

    Everything the camera can reach is real: the room is built to size, the
    surfaces are scanned PBR sets and the tools are scanned models. The previous
    version of this set was a bench floating in a dark void with a few grey
    blocks five metres back, and no amount of defocus was going to make that
    read as a place.
    """
    scene = bpy.context.scene
    scene.view_settings.exposure = -2.50

    # Ambient comes from a real room. The set is enclosed, so the HDRI is doing
    # bounce and colour rather than anything the camera sees directly.
    hdri_world("artist_workshop", strength=0.9, rotation=math.radians(-35),
               camera_color=(0.09, 0.088, 0.085))

    floor = plane(22, location=(0, 0, -0.92))
    floor.data.materials.append(
        pbr_material("shop_floor", "concrete_floor_02", scale=0.28, bump=0.8))

    # Raw sawn pine, knocked back a touch off its own warmth so the wall stays
    # behind the subject. The first pass used a French-polished table scan,
    # which came back as near-black mahogany and swallowed the whole back of
    # the room.
    planks = pbr_material("shop_planks", "raw_plank_wall", scale=0.50,
                          tint=(0.86, 0.87, 0.90), bump=1.2)
    plaster = pbr_material("shop_plaster", "beige_wall_001", scale=0.30,
                           tint=(0.92, 0.91, 0.89), bump=0.6)

    # The back wall sits close — a bench in a shop is pushed against something,
    # and at f/10 a wall five metres off is just a large empty area of the frame.
    back = slab(9.4, 0.12, 3.62, (0.1, 1.62, 2.70))
    back.data.materials.append(planks)
    right = slab(0.12, 5.2, 3.62, (3.30, 0.0, 2.70))
    right.data.materials.append(plaster)
    ceiling = plane(12, location=(0, 0.2, 2.70))
    ceiling.data.materials.append(flat_material("ceiling", (0.68, 0.68, 0.665), 0.92))

    # The left wall carries the window. Built as four pieces around the opening
    # rather than boolean-cut: the reveal is what makes window light fall off
    # across a bench instead of washing it flat, and a hole in a plane has no
    # reveal at all.
    for w, d, h, at in (
        (0.11, 2.05, 1.04, (-2.05, 0.02, 0.12)),     # under the sill
        (0.11, 2.05, 1.10, (-2.05, 0.02, 2.70)),     # over the head
        (0.11, 1.40, 3.62, (-2.05, -1.70, 2.70)),    # near jamb, on to the camera
        (0.11, 1.60, 3.62, (-2.05, 1.85, 2.70)),     # far jamb, back to the wall
    ):
        piece = slab(w, d, h, at)
        piece.data.materials.append(plaster)

    frame_mat = flat_material("window_frame", (0.185, 0.180, 0.170), 0.55)
    for w, d, h, at in ((0.075, 0.045, 1.48, (-2.03, 0.02, 1.60)),
                        (0.075, 2.05, 0.045, (-2.03, 0.02, 0.94))):
        bar = slab(w, d, h, at)
        bar.data.materials.append(frame_mat)

    # Key: the window itself. Large, close and square to the bench, so the
    # falloff along the bench top is real inverse-square rather than a gradient.
    bpy.ops.object.light_add(type="AREA", location=(-1.99, 0.02, 0.86))
    key = bpy.context.object
    key.data.shape = "RECTANGLE"
    key.data.size, key.data.size_y = 1.44, 2.01
    key.data.energy = 620.0
    key.data.color = (0.945, 0.960, 1.0)
    key.rotation_euler = (0, math.radians(-90), 0)

    # A wide, soft sun through the same opening, angled to rake along the back
    # wall rather than straight across the room. That rake is what lights the
    # wall at all: in a sealed set every photon has to come through the window,
    # and a key square to the bench leaves everything behind it black.
    bpy.ops.object.light_add(type="SUN", location=(-1.8, 0.0, 1.4))
    sun = bpy.context.object
    sun.data.energy = 4.6
    sun.data.angle = math.radians(9)
    sun.data.color = (1.0, 0.982, 0.958)
    sun.rotation_euler = (math.radians(64), 0, math.radians(-42))

    # A dim, very broad overhead — the rooflight every workshop has, and the
    # thing that stops the upper wall and the tops of the shelves going to black.
    bpy.ops.object.light_add(type="AREA", location=(-0.2, 0.5, 2.55))
    top = bpy.context.object
    top.data.shape = "RECTANGLE"
    top.data.size, top.data.size_y = 3.4, 2.6
    top.data.energy = 95.0
    top.data.color = (0.965, 0.975, 1.0)

    # Bounce off the right-hand wall, keeping the shadow side open. Weak: the
    # shadow side wants to stay a stop or so down, not disappear.
    bpy.ops.object.light_add(type="AREA", location=(2.60, -0.10, 0.55))
    bounce = bpy.context.object
    bounce.data.shape = "RECTANGLE"
    bounce.data.size, bounce.data.size_y = 2.6, 1.8
    bounce.data.energy = 42.0
    bounce.data.color = (1.0, 0.988, 0.972)
    bounce.rotation_euler = (0, math.radians(90), 0)

    # --- the bench ----------------------------------------------------------
    # Shorter and deeper than before. The old one was three metres of plank on
    # four thin posts, which reads as a shelf; a bench is a heavy thing.
    bench = slab(2.10, 0.98, 0.062, (-0.15, 0.10, 0.0))
    bench.data.materials.append(
        pbr_material("bench_top", "plywood", scale=1.15, tint=(0.82, 0.76, 0.66),
                     rough_scale=1.05, bump=0.7))
    frame_wood = pbr_material("bench_frame", "wood_planks_grey", scale=1.3,
                              tint=(1.85, 1.72, 1.52))
    for x in (-1.06, 0.76):
        for y in (-0.26, 0.46):
            leg = slab(0.098, 0.098, 0.86, (x, y, -0.062))
            leg.data.materials.append(frame_wood)
        rail = slab(0.080, 0.80, 0.085, (x, 0.10, -0.60))
        rail.data.materials.append(frame_wood)
    for y in (-0.26, 0.46):
        apron = slab(1.90, 0.055, 0.130, (-0.15, y, -0.075))
        apron.data.materials.append(frame_wood)
    stretcher = slab(1.86, 0.075, 0.085, (-0.15, 0.10, -0.62))
    stretcher.data.materials.append(frame_wood)

    if not dress:
        return bench

    # --- the shop behind ----------------------------------------------------
    # Everything back here is a vertical: shelving, a ladder, a hung saw. A bench
    # is all horizontals, and without something standing up behind it the frame
    # has no structure above the worktop.
    load_prop("wooden_bookshelf_worn", (1.62, 1.26, -0.92), rotation=(0, 0, math.pi))
    for slug, at in (("planter_pot_clay", (1.22, 1.24, 0.30)),
                     ("ceramic_vase_02", (1.94, 1.26, 0.30)),
                     ("can_rusted", (1.58, 1.22, 0.86)),
                     ("cleaner_tin_01", (1.86, 1.24, 0.86)),
                     ("jug_01", (1.30, 1.24, 0.86))):
        load_prop(slug, at)
    load_prop("wooden_ladder", (-1.95, 1.10, -0.92), rotation=(0, 0, math.radians(-16)))
    load_prop("wooden_stool_01", (-0.55, -1.15, -0.92), rotation=(0, 0, math.radians(30)))
    load_prop("cardboard_box_01", (2.15, 0.30, -0.92), rotation=(0, 0, math.radians(-18)))

    # A batten with the saw hung off it — the one tool that reads instantly in
    # silhouette from across a room.
    batten = slab(1.45, 0.032, 0.058, (-0.62, 1.545, 1.05))
    batten.data.materials.append(frame_wood)
    load_prop("handsaw_wood", (-0.66, 1.50, 0.97),
              rotation=(math.radians(90), 0, math.radians(90)), sit=False)

    # --- the bench, dressed -------------------------------------------------
    load_prop("vintage_hand_drill", (-0.78, 0.32, 0.0),
              rotation=(math.radians(90), 0, math.radians(28)))
    load_prop("hand_plane_no4", (0.36, 0.34, 0.0), rotation=(0, 0, math.radians(-24)))
    load_prop("wooden_hammer_01", (-0.48, 0.40, 0.0),
              rotation=(math.radians(90), 0, math.radians(-58)))
    load_prop("flathead_screwdriver", (0.10, 0.42, 0.0),
              rotation=(math.radians(90), 0, math.radians(12)))
    load_prop("measuring_tape_01", (0.26, -0.14, 0.0), rotation=(0, 0, math.radians(-40)))
    load_prop("small_oil_can_01", (0.72, 0.40, 0.0), rotation=(0, 0, math.radians(52)))
    load_prop("can_rusted", (-1.02, 0.42, 0.0))
    load_prop("wicker_basket_01", (0.70, -0.06, 0.0), rotation=(0, 0, math.radians(16)))

    pale = wood_material("shop_pale", WOODS["birch"], roughness=0.72, scale=5.0)
    steel = steel_material("shop_steel")
    try_square((-0.86, -0.22, 0.0), math.radians(24),
               wood_material("square_stock", WOODS["walnut"], roughness=0.5, scale=8.0),
               steel)

    # A rule and a pencil: the two things always within reach, and both are
    # long thin horizontals, which is exactly what a bench full of blocks needs.
    rule = slab(0.310, 0.028, 0.0022, (-0.30, -0.26, 0.0022))
    rule.rotation_euler = (0, 0, math.radians(-7))
    rule.data.materials.append(steel)
    pencil = slab(0.152, 0.0075, 0.0075, (-0.12, -0.31, 0.0075))
    pencil.rotation_euler = (0, 0, math.radians(11))
    pencil.data.materials.append(flat_material("pencil", (0.30, 0.215, 0.085), 0.42))

    # Offcuts: what a sheet leaves behind, dropped in a loose fan. A tidy row
    # reads as a diagram; this is a bench.
    rng = random.Random(21)
    for i in range(9):
        length = rng.uniform(0.09, 0.24)
        off = slab(length, rng.uniform(0.022, 0.048), 0.011,
                   (0.42 + rng.uniform(-0.12, 0.12), -0.30 + i * 0.034 + rng.uniform(-0.012, 0.012),
                    0.011 + i * 0.0006))
        off.rotation_euler = (0, 0, rng.uniform(-0.9, 0.9))
        off.data.materials.append(pale)
    # and a handful more standing in the basket
    for i in range(5):
        off = slab(rng.uniform(0.05, 0.09), 0.030, 0.14,
                   (0.70 + rng.uniform(-0.05, 0.05), -0.06 + rng.uniform(-0.04, 0.04), 0.14))
        off.rotation_euler = (rng.uniform(-0.22, 0.22), rng.uniform(-0.18, 0.18),
                              rng.uniform(0, math.tau))
        off.data.materials.append(pale)

    # Shavings and dust, densest where the plane has been working.
    curl = shaving("curl")
    dense = 0.4 if DRAFT else 1.0
    for i in range(int(26 * dense)):
        obj = bpy.data.objects.new("shaving", curl)
        bpy.context.collection.objects.link(obj)
        obj.location = (0.24 + rng.gauss(0, 0.20), 0.14 + rng.gauss(0, 0.16), 0.012)
        obj.rotation_euler = (rng.uniform(-0.5, 0.5), rng.uniform(0, math.tau),
                              rng.uniform(0, math.tau))
        s = rng.uniform(0.7, 1.5)
        obj.scale = (s, s, s)
        obj.data.materials.clear()
        obj.data.materials.append(pale)
    dust_mesh = None
    for i in range(int(260 * dense)):
        if dust_mesh is None:
            bpy.ops.mesh.primitive_cube_add(size=0.0028)
            seed_obj = bpy.context.object
            seed_obj.data.materials.append(pale)
            dust_mesh = seed_obj.data
            obj = seed_obj
        else:
            obj = bpy.data.objects.new("dust", dust_mesh)
            bpy.context.collection.objects.link(obj)
        obj.location = (0.18 + rng.gauss(0, 0.32), 0.10 + rng.gauss(0, 0.24), 0.0016)
        obj.rotation_euler = (rng.uniform(0, 1), rng.uniform(0, 1), rng.uniform(0, math.tau))
        obj.scale = (rng.uniform(0.6, 2.2), rng.uniform(0.6, 2.2), 0.35)
    return bench


def env_studio():
    """A white seamless sweep, one big soft key — catalogue product lighting.

    The lighting here is the one thing in the set that was signed off, so it is
    untouched: same key, same fill, same background light, same exposure. The
    only change is where the ambient comes from. A flat grey world lights every
    shadow with the same colour from every direction; a scanned studio does not,
    and the difference shows on the shaded faces of a box.
    """
    scene = bpy.context.scene
    scene.view_settings.exposure = -1.30

    hdri_world("brown_photostudio_02", strength=0.28, rotation=math.radians(120),
               camera_color=(0.55, 0.56, 0.58))

    # The sweep: floor, a quarter-round cove, then wall — one continuous
    # surface, which is the whole point of a sweep. No horizon line anywhere.
    width, radius, back, up = 9.0, 1.5, 3.2, 4.0
    profile = [(-back, 0.0)]
    segments = 20
    for i in range(segments + 1):
        t = (i / segments) * (math.pi / 2)
        profile.append((0.9 + radius * math.sin(t), radius - radius * math.cos(t)))
    profile.append((0.9 + radius, radius + up))

    verts, faces = [], []
    for y, z in profile:
        verts += [(-width, y, z), (width, y, z)]
    for i in range(len(profile) - 1):
        a = i * 2
        faces.append((a, a + 1, a + 3, a + 2))
    mesh = bpy.data.meshes.new("sweep")
    mesh.from_pydata(verts, [], faces)
    mesh.update()
    sweep = bpy.data.objects.new("sweep", mesh)
    bpy.context.collection.objects.link(sweep)
    for poly in mesh.polygons:
        poly.use_smooth = True

    mat, nodes, links = node_material("seamless")
    bsdf = nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = (0.820, 0.822, 0.828, 1.0)
    bsdf.inputs["Roughness"].default_value = 0.88
    tooth = nodes.new("ShaderNodeTexNoise")
    tooth.inputs["Scale"].default_value = 420.0
    tooth.inputs["Detail"].default_value = 4.0
    bump = nodes.new("ShaderNodeBump")
    bump.inputs["Strength"].default_value = 0.06
    links.new(tooth.outputs["Fac"], bump.inputs["Height"])
    links.new(bump.outputs["Normal"], bsdf.inputs["Normal"])
    sweep.data.materials.append(mat)

    # Key: a large softbox high and slightly left, the classic three-quarter.
    bpy.ops.object.light_add(type="AREA", location=(-1.5, -1.5, 2.6))
    key = bpy.context.object
    key.data.shape = "RECTANGLE"
    key.data.size, key.data.size_y = 1.8, 1.4
    key.data.energy = 420.0
    key.data.color = (1.0, 0.985, 0.965)
    key.rotation_euler = (math.radians(52), 0, math.radians(-34))

    # Fill: a big white flat opposite, low power, kills the black side.
    bpy.ops.object.light_add(type="AREA", location=(2.0, -1.0, 0.75))
    fill = bpy.context.object
    fill.data.shape = "RECTANGLE"
    fill.data.size, fill.data.size_y = 3.0, 2.2
    fill.data.energy = 34.0
    fill.data.color = (1.0, 0.99, 0.98)
    fill.rotation_euler = (math.radians(88), 0, math.radians(66))

    # Background light so the sweep goes near-white behind the subject and the
    # object separates without a rim light doing something obvious.
    bpy.ops.object.light_add(type="AREA", location=(0.0, 1.6, 2.2))
    back_light = bpy.context.object
    back_light.data.shape = "RECTANGLE"
    back_light.data.size, back_light.data.size_y = 4.0, 2.0
    back_light.data.energy = 105.0
    back_light.rotation_euler = (math.radians(128), 0, 0)
    return sweep


def env_studio_wall():
    """The studio, with a plastered wall standing in the sweep.

    The wall-fixed variant is the one configuration that cannot be photographed
    free-standing: it is a bracket, and a bracket with nothing behind it is a
    brown rectangle in mid-air, which is precisely why the old trio shot failed.
    So the set gets a real wall, standing on the sweep floor, close enough behind
    the subject to take a contact shadow.
    """
    sweep = env_studio()
    wall = slab(3.4, 0.11, 2.6, (0.06, 0.145, 2.10))
    wall.data.materials.append(
        pbr_material("studio_wall", "beige_wall_001", scale=1.7,
                     tint=(0.90, 0.898, 0.90), bump=0.55))
    # A skirting stops the wall meeting the floor on a single hard line, which
    # is the detail that makes a plane read as a wall rather than as a card. It
    # sits well below any of the framing here, but it is what stops a grazing
    # camera catching the join.
    skirt = slab(3.4, 0.026, 0.095, (0.06, 0.076, 0.095))
    skirt.data.materials.append(flat_material("skirting", (0.855, 0.852, 0.842), 0.5))

    # A second, closer soft source aimed along the wall. The studio key alone
    # lights the object beautifully and leaves the wall behind it dead flat,
    # and the whole reason this variant needs a wall is to see it take a shadow.
    bpy.ops.object.light_add(type="AREA", location=(-1.35, -1.15, 1.85))
    graze = bpy.context.object
    graze.data.shape = "RECTANGLE"
    graze.data.size, graze.data.size_y = 1.5, 1.2
    graze.data.energy = 130.0
    graze.data.color = (1.0, 0.99, 0.975)
    graze.rotation_euler = (math.radians(64), 0, math.radians(-40))
    return sweep


ENVIRONMENTS = {"workshop": env_workshop, "studio": env_studio,
                "studio-wall": env_studio_wall}


# --- camera -----------------------------------------------------------------

def frame(objects, azimuth=-58, elevation=14, lens=70, margin=1.5, fstop=8.0,
          target=(0.5, 0.5, 0.5), pull=1.0, focus=None):
    """Point a camera at the bounding box of `objects` and back off to fit it.

    Framing from the geometry rather than hand-placed coordinates means the
    shots survive any change to the stacks below. `target` picks a point inside
    that box in normalised coordinates, and `pull` scales the standoff, which is
    how the macros get in close on one face without losing the auto-fit.
    """
    from mathutils import Vector

    # Transforms set via the API are lazy — without this the bound boxes still
    # read as the un-scaled millimetre geometry and the camera ends up in orbit.
    bpy.context.view_layer.update()

    corners = [obj.matrix_world @ Vector(c) for obj in objects for c in obj.bound_box]
    lo = Vector((min(c[i] for c in corners) for i in range(3)))
    hi = Vector((max(c[i] for c in corners) for i in range(3)))
    centre = Vector((lo[i] + (hi[i] - lo[i]) * target[i] for i in range(3)))
    radius = max(max((c - centre).length for c in corners), 0.02)
    a, e = math.radians(azimuth), math.radians(elevation)
    direction = Vector((
        math.cos(e) * math.sin(a),
        -math.cos(e) * math.cos(a),
        math.sin(e),
    ))

    bpy.ops.object.camera_add(location=centre + direction * radius * 4)
    cam = bpy.context.object
    cam.data.lens = lens
    empty = bpy.data.objects.new("target", None)
    bpy.context.collection.objects.link(empty)
    empty.location = centre
    cam.constraints.new("TRACK_TO").target = empty

    # Fit by projecting the corners through the finished camera rather than by
    # trigonometry on a sensor width. A 36 mm sensor only describes the *long*
    # edge of the frame, so solving against it fits a tall object to the width
    # and lets the legs run off the bottom — which is exactly what happened.
    # Projecting handles both axes, the aspect ratio and the lens at once, and
    # converges in a few passes because extent goes as 1/distance.
    from bpy_extras.object_utils import world_to_camera_view

    scene = bpy.context.scene
    for _ in range(12):
        bpy.context.view_layer.update()
        extent = 0.0
        for corner in corners:
            projected = world_to_camera_view(scene, cam, corner)
            if projected.z <= 0:
                continue
            extent = max(extent, abs(projected.x - 0.5) * 2, abs(projected.y - 0.5) * 2)
        if extent <= 1e-6:
            break
        distance = (cam.location - centre).length
        cam.location = centre + direction * (distance * extent * margin)
    # `pull` comes last: the macros want to sit inside the fitted framing.
    cam.location = centre + direction * ((cam.location - centre).length * pull)
    bpy.context.view_layer.update()

    cam.data.dof.use_dof = True
    if focus is None:
        cam.data.dof.focus_object = empty
    else:
        spot = bpy.data.objects.new("focus", None)
        bpy.context.collection.objects.link(spot)
        spot.location = Vector((lo[i] + (hi[i] - lo[i]) * focus[i] for i in range(3)))
        cam.data.dof.focus_object = spot
    cam.data.dof.aperture_fstop = fstop
    bpy.context.scene.camera = cam
    return cam


# --- model assembly ---------------------------------------------------------

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
    """Weld and re-orient the mesh.

    The parts arrive as triangle soup — glTF with no shared vertices — so the
    weld is what turns them into a surface at all. It used to also have to patch
    holes, because tools/mesh_storeys.py left them: its loop walk cut chords
    across faces and its nesting test mistook solid regions for holes, so parts
    came in with up to thirty-odd open edges each, and the fill that closed them
    is what read as a black wedge. That is fixed at the source now, and every
    part this script loads welds to a closed manifold. The hole fill stays as a
    tripwire — `python3 tools/render_stills.py audit` fails loudly if a part
    ever arrives open again — but on the current geometry it has nothing to do.
    """
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.mesh.remove_doubles(threshold=0.0005)
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
    so the width is in millimetres too. `clamp_overlap` matters: without it the
    bevel on two edges 0.2 mm apart overshoots and folds the face inside out.
    """
    mod = obj.modifiers.new("bevel", "BEVEL")
    mod.width = 0.18
    mod.segments = 2
    mod.limit_method = "ANGLE"
    mod.angle_limit = math.radians(40)
    mod.harden_normals = False
    mod.use_clamp_overlap = True


def place(obj, x, y, z, z_min, z_stretch=1.0, yaw=0.0):
    """Sit a part with its underside at world height `z`."""
    obj.location = (x, y, z - z_min * MM * z_stretch)
    obj.scale = (MM, MM, MM * z_stretch)
    obj.rotation_euler = (0, 0, yaw)


def seat(objects, z=0.0):
    """Drop a group so its lowest vertex rests at `z`.

    `place` positions a part from its untransformed z-extent, which is right for
    a stack but wrong the moment a part is tipped on edge — the rotation swings
    the geometry through the bench. This re-measures after the fact.
    """
    from mathutils import Vector

    bpy.context.view_layer.update()
    corners = [obj.matrix_world @ Vector(c) for obj in objects for c in obj.bound_box]
    shift = z - min(c.z for c in corners)
    for obj in objects:
        obj.location.z += shift
    bpy.context.view_layer.update()
    return objects


def paint(objects, wood):
    mat = wood_material(f"wood_{wood}_{len(bpy.data.materials)}", WOODS[wood])
    for obj in objects:
        obj.data.materials.clear()
        obj.data.materials.append(mat)
    return objects


# Trays touch in reality, but coplanar contact faces z-fight under a path tracer
# and read as dark slivers, so every joint gets 0.05 mm of air.
JOINT = 0.00005


def build(index, letters, woods, origin=(0, 0), lift=0.0, yaw=0.0, roof=True):
    """Stack `letters` at `origin`, each part sitting on the one below."""
    z = lift
    placed = []
    for i, letter in enumerate(letters):
        name = os.path.basename(index["storeys"][letter]["a"]["file"])
        parts, height, z_min = load_part(os.path.join(MODELS, name))
        for obj in parts:
            place(obj, origin[0], origin[1], z, z_min, yaw=yaw)
        placed += paint(parts, woods[i % len(woods)])
        z += height * MM + JOINT
    if roof:
        placed += add_roof(origin, z, yaw=yaw, wood=woods[0])
        z += 22 * MM + JOINT
    return placed, z


def add_roof(origin, z, yaw=0.0, wood="birch"):
    """Cap the stack. Nothing is ever shown ending on the open channels."""
    parts, _, z_min = load_part(os.path.join(MODELS, "roof.glb"))
    for obj in parts:
        place(obj, origin[0], origin[1], z, z_min, yaw=yaw)
    return paint(parts, wood)


def add_support(index, origin, lift, wood="birch", yaw=0.0):
    """Base plate plus four legs, the legs stretched to whatever lift is asked."""
    objs = []
    base_parts, base_h, base_zmin = load_part(os.path.join(MODELS, "base.glb"))
    for obj in base_parts:
        place(obj, origin[0], origin[1], lift - base_h * MM, base_zmin, yaw=yaw)
    objs += base_parts

    leg_top = lift - base_h * MM
    if leg_top > 0.001:
        for sx, sy in ((-1, -1), (1, -1), (-1, 1), (1, 1)):
            leg_parts, leg_h, leg_zmin = load_part(os.path.join(MODELS, "leg.glb"))
            stretch = (leg_top / MM) / leg_h
            for obj in leg_parts:
                place(obj, origin[0] + sx * 0.048, origin[1] + sy * 0.062, 0,
                      leg_zmin, z_stretch=stretch, yaw=yaw)
            objs += leg_parts
    return paint(objs, wood)


def add_spike(index, origin, lift, wood="birch"):
    """The ground spike: one post driven in, base plate on top of it."""
    objs = []
    base_parts, base_h, base_zmin = load_part(os.path.join(MODELS, "base.glb"))
    for obj in base_parts:
        place(obj, origin[0], origin[1], lift - base_h * MM, base_zmin)
    objs += base_parts

    spike_parts, spike_h, spike_zmin = load_part(os.path.join(MODELS, "spike.glb"))
    top = lift - base_h * MM
    # Driven into the ground, so it starts below z = 0 and the visible length is
    # whatever is left above it.
    stretch = ((top + 0.12) / MM) / spike_h
    for obj in spike_parts:
        place(obj, origin[0], origin[1], -0.12, spike_zmin, z_stretch=stretch)
    objs += spike_parts
    return paint(objs, wood)


def add_wall_mount(index, origin, lift, wood="birch", wall_y=0.092):
    """Fixed to a wall: the base plate carried on a short cleat.

    The cleat is a bracket, not a backboard. The earlier version ran a panel the
    full height of the mount, which meant a metre of dark timber standing behind
    a 150 mm object — the framing then had to fit the panel, and the product
    ended up a detail at the top of its own photograph. Anything holding this to
    a wall only has to be as tall as the base it carries.
    """
    objs = []
    base_parts, base_h, base_zmin = load_part(os.path.join(MODELS, "base.glb"))
    for obj in base_parts:
        place(obj, origin[0], origin[1], lift - base_h * MM, base_zmin)
    objs += paint(base_parts, wood)

    cleat = slab(0.150, 0.026, 0.128, (origin[0], origin[1] + wall_y, lift - 0.006))
    cleat.data.materials.append(
        wood_material(f"cleat_{len(bpy.data.materials)}", WOODS["walnut"],
                      roughness=0.62, scale=6.0))
    return objs + [cleat]


def render(path):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    bpy.context.scene.render.filepath = os.path.abspath(path)
    bpy.ops.render.render(write_still=True)
    print("wrote", path)


def size(width, height, samples):
    """Draft mode keeps every framing decision and drops the cost."""
    if DRAFT:
        return max(1, width // 3), max(1, height // 3), 24
    return width, height, samples


# --- shots ------------------------------------------------------------------
#
# Ten frames. No two share a camera except the assembly sequence, where a fixed
# camera is the entire point.
#
# Apertures sit between f/9 and f/13 throughout. The launch photography is deep
# daylight — the setting behind the object stays legible and quiet — and a wide
# stop reads as a way of not having built a set.

def shot_workshop_bench(index):
    """Three-quarter across the bench: subject sharp, the shop reading behind."""
    reset(*size(2000, 1400, 130))
    env_workshop()
    subject, _ = build(index, ["A", "B", "C", "M"], ["birch", "beech"],
                       origin=(-0.06, 0.04), lift=0.0, yaw=math.radians(16))
    frame(subject, azimuth=-34, elevation=15, lens=50, margin=3.05, fstop=10.0,
          target=(0.62, 0.46, 0.52))
    render(f"{OUT}/workshop-bench.png")


def shot_workshop_hands(index):
    """Lower and closer: a part-built stack with the next storeys still loose.

    Nothing hovers. An exploded stack is a diagram convention and it survives on
    a white sweep, but dropped into a room with real light and real shadows a
    floating part stops reading as "about to go on" and starts reading as a
    mistake. The same moment is carried here by a seated stack, the next storey
    laid down beside it and one stood on edge behind.
    """
    reset(*size(2000, 1400, 130))
    env_workshop()
    origin = (-0.02, 0.02)
    yaw = math.radians(-12)
    subject, _ = build(index, ["N", "O"], ["birch", "ash"], origin=origin,
                       lift=0.0, yaw=yaw, roof=False)

    flat, _, z_min = load_part(os.path.join(MODELS, "P_a.glb"))
    for obj in flat:
        place(obj, 0.165, -0.070, 0.0, z_min, yaw=math.radians(28))
    subject += paint(flat, "beech")

    # One stood on its edge, leaning back on the stack — how a part actually
    # waits its turn on a bench.
    edge, _, e_zmin = load_part(os.path.join(MODELS, "C_a.glb"))
    for obj in edge:
        place(obj, -0.150, 0.120, 0.0, e_zmin, yaw=math.radians(-40))
        obj.rotation_euler = (math.radians(74), 0, math.radians(-40))
    subject += paint(seat(edge), "birch")

    frame(subject, azimuth=-40, elevation=11, lens=70, margin=1.45, fstop=9.0,
          target=(0.50, 0.46, 0.56))
    render(f"{OUT}/workshop-hands.png")


def shot_studio_front(index):
    """Near-elevation, clean, the catalogue frame. The approved one."""
    reset(*size(2000, 1500, 120), look="AgX - Base Contrast")
    env_studio()
    lift = 0.26
    subject, _ = build(index, ["N", "O", "P", "M"], ["birch", "beech", "birch"], lift=lift)
    subject += add_support(index, (0, 0), lift, wood="birch")
    frame(subject, azimuth=-13, elevation=5, lens=120, margin=1.08, fstop=11.0,
          target=(0.5, 0.5, 0.54))
    render(f"{OUT}/studio-front.png")


def shot_studio_three_quarter(index):
    """Turned so the cavity face and the open channel side both read at once."""
    reset(*size(2000, 1500, 120), look="AgX - Base Contrast")
    env_studio()
    lift = 0.24
    # Yawed rather than orbited: the key stays exactly where it was signed off
    # and the object turns into it, so the two faces separate on tone instead of
    # on a light that has been dragged round to suit a new camera.
    yaw = math.radians(38)
    subject, _ = build(index, ["D", "F", "G", "M"], ["beech", "birch", "walnut"],
                       lift=lift, yaw=yaw)
    subject += add_support(index, (0, 0), lift, wood="beech", yaw=yaw)
    frame(subject, azimuth=-30, elevation=3, lens=105, margin=1.18, fstop=11.0,
          target=(0.5, 0.5, 0.52))
    render(f"{OUT}/studio-three-quarter.png")


def shot_studio_grounded(index):
    """The ground-spike variant: different storeys again, and a cooler timber."""
    reset(*size(2000, 1500, 120), look="AgX - Base Contrast")
    env_studio()
    lift = 0.27
    subject, _ = build(index, ["I", "J", "C", "M"], ["ash", "ash", "walnut"], lift=lift)
    subject += add_spike(index, (0, 0), lift, wood="ash")
    # Cropped through the spike rather than showing its point. On a seamless
    # sweep there is no ground for it to enter, and a tapered post stopping in
    # mid-air reads as a floating stick; running it out of the frame lets the
    # eye finish it.
    frame(subject, azimuth=-24, elevation=6, lens=110, margin=0.76, fstop=11.0,
          target=(0.5, 0.5, 0.78))
    render(f"{OUT}/studio-grounded.png")


def shot_studio_wall(index):
    """The wall-fixed variant, on an actual wall, with the shadow to prove it."""
    reset(*size(2000, 1500, 120), look="AgX - Base Contrast")
    env_studio_wall()
    lift = 1.05
    subject, _ = build(index, ["N", "O", "P", "M"], ["birch", "walnut", "birch"],
                       lift=lift)
    subject += add_wall_mount(index, (0, 0), lift, wood="birch")
    # Slightly below the object and off to one side, so the cleat, the gap
    # behind it and the shadow it throws all read at once. Square on, a wall
    # mount is indistinguishable from something standing on a shelf.
    frame(subject, azimuth=-31, elevation=-4, lens=100, margin=1.62, fstop=11.0,
          target=(0.5, 0.5, 0.46))
    render(f"{OUT}/studio-wall.png")


def shot_assembly(index):
    """Four build states, one camera, held. Repetition is the point here."""
    letters = ["A", "P", "P", "M"]
    lift = 0.16
    for step in range(1, 5):
        reset(*size(1600, 1200, 110))
        env_workshop(dress=False)
        subject = add_support(index, (0, 0), lift, wood="birch")
        shown = letters[:step]
        placed, stack_top = build(index, shown, ["birch", "beech", "birch"],
                                  lift=lift, roof=(step == 4))
        subject += placed

        # The next part to go on hovers above the stack — except on the last
        # frame, which is the finished object with its roof on.
        if step < 4:
            nxt = letters[step]
            parts, _, z_min = load_part(os.path.join(MODELS, f"{nxt}_a.glb"))
            for obj in parts:
                place(obj, 0, 0, stack_top + 0.075, z_min)
            subject += paint(parts, "birch")

        # The camera is placed from the *finished* object every time, so it
        # cannot drift as the stack grows.
        anchor = frame_anchor(index, letters, lift)
        frame(anchor, azimuth=-42, elevation=18, lens=66, margin=1.30, fstop=11.0,
              target=(0.5, 0.5, 0.50))
        for obj in anchor:
            bpy.data.objects.remove(obj, do_unlink=True)
        render(f"{OUT}/assembly-{step}.png")


def frame_anchor(index, letters, lift):
    """An invisible stand-in for the finished stack, so a growing subject does
    not pull the camera around between frames of a sequence."""
    total = lift
    for letter in letters:
        total += index["storeys"][letter]["a"]["size_mm"][2] * MM + JOINT
    total += 22 * MM + 0.075
    box = slab(0.150, 0.170, total, (0, 0, total))
    box.hide_render = True
    return [box]


SHOTS = {
    "workshop-bench": shot_workshop_bench,
    "workshop-hands": shot_workshop_hands,
    "studio-front": shot_studio_front,
    "studio-three-quarter": shot_studio_three_quarter,
    "studio-grounded": shot_studio_grounded,
    "studio-wall": shot_studio_wall,
    "assembly": shot_assembly,
}


# --- integrity check --------------------------------------------------------

def audit():
    """Fail if any part the shots use is not a closed manifold.

    This is the wedge guard. A part with open edges is a part with a hole in it,
    and a hole under a path tracer is a black shape lying across the timber.
    """
    import bmesh

    reset(64, 64, 1)
    with open(f"{MODELS}/index.json") as fh:
        index = json.load(fh)
    names = [os.path.basename(index["storeys"][k]["a"]["file"]) for k in index["storeys"]]
    names += ["base.glb", "leg.glb", "spike.glb", "roof.glb"]

    bad = 0
    for name in sorted(names):
        objs, _, _ = load_part(os.path.join(MODELS, name))
        for obj in objs:
            mesh = bmesh.new()
            mesh.from_mesh(obj.data)
            open_edges = sum(1 for e in mesh.edges if len(e.link_faces) == 1)
            over = sum(1 for e in mesh.edges if len(e.link_faces) > 2)
            mesh.free()
            if open_edges or over:
                bad += 1
                print(f"  FAIL {name}: {open_edges} open, {over} overlapping")
            else:
                print(f"  ok   {name}")
        for obj in objs:
            bpy.data.objects.remove(obj, do_unlink=True)
    print(f"\n{len(names) - bad}/{len(names)} parts closed")
    return bad == 0


def main():
    global DRAFT
    args = [a for a in sys.argv[1:]]
    DRAFT = "draft" in args
    args = [a for a in args if a != "draft"]
    what = args[0] if args else "all"

    if what == "audit":
        sys.exit(0 if audit() else 1)

    with open(f"{MODELS}/index.json") as fh:
        index = json.load(fh)
    names = list(SHOTS) if what == "all" else [what]
    for name in names:
        print(f"--- {name}")
        SHOTS[name](index)


if __name__ == "__main__":
    main()
