"""Render product photography of the Bee Home from the reconstructed geometry.

Runs Blender headless via the `bpy` PyPI module — no GUI, no manual modelling,
no licence. Everything is built from `viewer/public/models/*.glb`, so any change
to the geometry pipeline reflows into the imagery on the next run.

    pip install bpy
    python3 tools/render_stills.py all          # the whole set, final quality
    python3 tools/render_stills.py all draft    # same framing, quick and small
    python3 tools/render_stills.py hero-garden

Three environments are built procedurally — there is no network here, so no
HDRIs. They are meant to be genuinely different rooms rather than one room with
the lamp moved: a garden at low sun, a workshop lit through a north window, and
a white studio sweep. Colour temperature, ground material, background and depth
of field all change with them.

Every stack is capped with `roof.glb`. The original was never photographed
ending on the open cavity channels of the last storey, and neither is this.
"""

import json
import math
import os
import random
import sys

import bpy

MODELS = "viewer/public/models"
OUT = "docs/renders"
TEXTURE = "docs/reference/textures/WoodPlywood001_COL_2K.jpg"

# Tints multiplied over the plywood scan, which is a very light sheet: its mean
# linear value is (0.94, 0.74, 0.55), so a tint near white leaves the timber
# nearly white too. That is what made earlier passes read as bleached MDF. The
# launch photography sits around sRGB (0.66, 0.43, 0.31) on a lit face — a warm
# oak — so the tints are set to land there once the scan is multiplied through.
WOODS = {
    "birch": (0.520, 0.395, 0.290),
    "oak": (0.360, 0.225, 0.150),
    "larch": (0.430, 0.250, 0.145),
    "walnut": (0.150, 0.092, 0.068),
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
    """
    bpy.ops.mesh.primitive_cube_add(size=1, location=location)
    obj = bpy.context.object
    obj.scale = (width, depth, height)
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.transform_apply(scale=True)
    obj.location = (location[0], location[1], location[2] - height / 2)
    return obj


# --- environments -----------------------------------------------------------
#
# Each returns nothing but leaves a complete lit set behind: world, ground at
# z = 0, background, and key/fill. The subject is always built on top of z = 0.

def foliage_gobo(location, size=12, scale=5.5):
    """A plane between key and subject, transparent except where a noise mask
    thresholds to opaque — reads as leaf shade without modelling a tree."""
    gobo = plane(size, location=location)
    gobo.visible_camera = False
    gobo.visible_diffuse = False
    gobo.visible_glossy = False

    mat, nodes, links = node_material("gobo")
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
    cells.inputs["Scale"].default_value = scale
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
    return gobo


def leaf_mesh(name, length, width):
    """One tapered blade, curled slightly so it never reads as a flat card."""
    mesh = bpy.data.meshes.new(name)
    steps = 5
    verts, faces = [], []
    for i in range(steps + 1):
        t = i / steps
        half = width * (1 - t ** 1.6) / 2
        # A gentle arc: the tip leans over rather than standing to attention.
        z = length * t
        y = length * 0.20 * t * t
        verts += [(-half, y, z), (half, y, z)]
    for i in range(steps):
        a = i * 2
        faces.append((a, a + 1, a + 3, a + 2))
    mesh.from_pydata(verts, [], faces)
    mesh.update()
    return mesh


def foliage_material(name, rgb, translucency=0.30):
    mat, nodes, links = node_material(name)
    bsdf = nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = (*rgb, 1.0)
    bsdf.inputs["Roughness"].default_value = 0.48
    # Leaves lit from behind glow; without this a planting bank reads as
    # cut-out cardboard the moment the sun is behind it.
    for slot in ("Transmission Weight", "Subsurface Weight"):
        if slot in bsdf.inputs:
            bsdf.inputs[slot].default_value = translucency
            break
    variation = nodes.new("ShaderNodeTexNoise")
    variation.inputs["Scale"].default_value = 6.0
    hsv = nodes.new("ShaderNodeHueSaturation")
    hsv.inputs["Color"].default_value = (*rgb, 1.0)
    hsv.inputs["Saturation"].default_value = 1.15
    links.new(variation.outputs["Fac"], hsv.inputs["Hue"])
    links.new(hsv.outputs["Color"], bsdf.inputs["Base Color"])
    mat.use_backface_culling = False
    return mat


def scatter(mesh, material, count, centre, spread, height, tilt=0.5, seed=1, rise=0.0):
    """Instance one leaf many times — linked mesh data, so it stays cheap.

    `rise` is what makes a bank of planting rather than a lawn. Scattering
    everything on the ground and scaling it up to fill the background gives
    metre-long leaves, which read as agave however far out of focus they are.
    Small leaves spread through a *height* instead pile into a mass, which is
    what a shrub actually is.
    """
    rng = random.Random(seed)
    objs = []
    for _ in range(count):
        obj = bpy.data.objects.new("leaf", mesh)
        bpy.context.collection.objects.link(obj)
        sx, sy = spread if isinstance(spread, tuple) else (spread, spread * 0.7)
        radius = math.sqrt(rng.random())
        angle = rng.uniform(0, math.tau)
        obj.location = (centre[0] + sx * radius * math.cos(angle),
                        centre[1] + sy * radius * math.sin(angle),
                        centre[2] + rise * rng.random() ** 0.7)
        obj.rotation_euler = (rng.uniform(-tilt, tilt), rng.uniform(-tilt, tilt),
                              rng.uniform(0, math.tau))
        s = height * rng.uniform(0.6, 1.4)
        obj.scale = (s, s, s)
        obj.data.materials.clear()
        obj.data.materials.append(material)
        objs.append(obj)
    return objs


def env_garden():
    """Late afternoon outdoors: warm low sun, leaf shade, planting behind."""
    scene = bpy.context.scene
    # AgX desaturates as it approaches white, so a timber left sitting up at
    # 0.8 goes pale and chalky no matter how warm the albedo is. Every set here
    # is trimmed to land lit oak near 0.55, where the tint survives the transform
    # — which is where the launch photography sits.
    scene.view_settings.exposure = -0.12

    world = bpy.data.worlds.new("garden")
    scene.world = world
    world.use_nodes = True
    nodes, links = world.node_tree.nodes, world.node_tree.links
    sky = nodes.new("ShaderNodeTexSky")
    sky.sky_type = "MULTIPLE_SCATTERING"
    sky.sun_elevation = math.radians(9.0)
    sky.sun_rotation = math.radians(-40)
    sky.sun_disc = False          # the disc is a real lamp below, for hard shade
    sky.altitude = 120.0
    bg = nodes["Background"]
    bg.inputs[1].default_value = 0.32
    links.new(sky.outputs["Color"], bg.inputs["Color"])

    # Ground: soil showing through thin grass, not a green bedsheet.
    mat, nodes, links = node_material("garden_ground")
    bsdf = nodes["Principled BSDF"]
    bsdf.inputs["Roughness"].default_value = 0.95
    coord = nodes.new("ShaderNodeTexCoord")
    patch = nodes.new("ShaderNodeTexNoise")
    patch.inputs["Scale"].default_value = 5.0
    patch.inputs["Detail"].default_value = 8.0
    ramp = nodes.new("ShaderNodeValToRGB")
    ramp.color_ramp.elements[0].position = 0.36
    ramp.color_ramp.elements[0].color = (0.105, 0.072, 0.046, 1.0)   # damp soil
    ramp.color_ramp.elements[1].position = 0.62
    ramp.color_ramp.elements[1].color = (0.115, 0.145, 0.052, 1.0)   # grass
    links.new(coord.outputs["Object"], patch.inputs["Vector"])
    links.new(patch.outputs["Fac"], ramp.inputs["Fac"])
    links.new(ramp.outputs["Color"], bsdf.inputs["Base Color"])
    grain = nodes.new("ShaderNodeTexNoise")
    grain.inputs["Scale"].default_value = 300.0
    grain.inputs["Detail"].default_value = 8.0
    bump = nodes.new("ShaderNodeBump")
    bump.inputs["Strength"].default_value = 0.35
    links.new(coord.outputs["Object"], grain.inputs["Vector"])
    links.new(grain.outputs["Fac"], bump.inputs["Height"])
    links.new(bump.outputs["Normal"], bsdf.inputs["Normal"])
    ground = plane(30)
    ground.data.materials.append(mat)

    # Planting, in four depths. A single even scatter reads as mown lawn from a
    # low camera, and the horizon line behind it gives the whole thing away as a
    # plane with grass on it. So: ground cover at the feet, clumps at mid depth,
    # then a bank tall enough to close the frame off above the subject, and a
    # few stems right in front of the lens to open on.
    blade = leaf_mesh("blade", 1.0, 0.045)
    # The bank behind is broad-leaved, not more grass. Blades of grass at a
    # metre tall read as a reed bed however far out of focus they are; wide
    # leaves overlap into a mass, which is what a planted border looks like.
    broad = leaf_mesh("broad", 1.0, 0.20)
    near = foliage_material("leaf_near", (0.075, 0.140, 0.034))
    mid = foliage_material("leaf_mid", (0.062, 0.118, 0.030))
    far = foliage_material("leaf_far", (0.048, 0.092, 0.032))
    dense = 0.35 if DRAFT else 1.0
    # The mass of the border is a painted wall of leaf colour standing 3 m back.
    # Real leaves cannot be scattered thinly enough to fill a whole background
    # without either turning into agave or floating like confetti — so the bulk
    # is a mottled surface, and instanced leaves only have to break its edge.
    hedge_mat, hnodes, hlinks = node_material("hedge")
    hbsdf = hnodes["Principled BSDF"]
    hbsdf.inputs["Roughness"].default_value = 0.72
    hcoord = hnodes.new("ShaderNodeTexCoord")
    clump = hnodes.new("ShaderNodeTexVoronoi")
    clump.feature = "SMOOTH_F1"
    clump.inputs["Scale"].default_value = 9.0
    clump.inputs["Smoothness"].default_value = 0.85
    detail = hnodes.new("ShaderNodeTexNoise")
    detail.inputs["Scale"].default_value = 26.0
    detail.inputs["Detail"].default_value = 8.0
    blend = hnodes.new("ShaderNodeMixRGB")
    blend.blend_type = "MULTIPLY"
    blend.inputs["Fac"].default_value = 0.55
    hramp = hnodes.new("ShaderNodeValToRGB")
    hramp.color_ramp.elements[0].position = 0.10
    hramp.color_ramp.elements[0].color = (0.012, 0.024, 0.008, 1.0)
    hramp.color_ramp.elements[1].position = 0.85
    hramp.color_ramp.elements[1].color = (0.105, 0.190, 0.052, 1.0)
    hlinks.new(hcoord.outputs["Object"], clump.inputs["Vector"])
    hlinks.new(hcoord.outputs["Object"], detail.inputs["Vector"])
    hlinks.new(clump.outputs["Distance"], blend.inputs["Color1"])
    hlinks.new(detail.outputs["Fac"], blend.inputs["Color2"])
    hlinks.new(blend.outputs["Color"], hramp.inputs["Fac"])
    hlinks.new(hramp.outputs["Color"], hbsdf.inputs["Base Color"])
    hedge = plane(26, location=(0.2, 3.4, 2.4), rotation=(math.radians(90), 0, 0))
    hedge.data.materials.append(hedge_mat)

    scatter(blade, near, int(2600 * dense), (0.0, 0.10, 0.0), (1.5, 1.1), 0.085, seed=3)
    scatter(blade, mid, int(1500 * dense), (-0.3, 1.2, 0.0), (2.6, 0.6), 0.16, seed=5)
    scatter(broad, mid, int(1900 * dense), (0.5, 1.7, 0.0), (3.0, 0.45), 0.11,
            tilt=1.0, rise=0.36, seed=9)
    scatter(broad, far, int(5200 * dense), (0.1, 2.7, 0.0), (6.0, 0.50), 0.13,
            tilt=1.2, rise=1.30, seed=13)
    # Foreground stems, out at the edges and inside the near focus limit so they
    # melt into a soft green frame instead of standing over the subject.
    scatter(blade, near, int(70 * dense), (-0.90, -0.58, 0.0), 0.26, 0.16, seed=19)
    scatter(blade, near, int(55 * dense), (0.96, -0.64, 0.0), 0.24, 0.14, seed=23)

    # Key: a low sun raking across, warm, with leaf shade thrown over it.
    bpy.ops.object.light_add(type="SUN", location=(-5, -3, 3))
    sun = bpy.context.object
    sun.data.energy = 8.6
    sun.data.angle = math.radians(1.0)
    sun.data.color = (1.0, 0.760, 0.505)
    sun.rotation_euler = (math.radians(79), 0, math.radians(-52))
    foliage_gobo((-0.7, -0.5, 1.9), size=10, scale=4.6)

    # Sky fill from the open side, cool against the warm key.
    bpy.ops.object.light_add(type="AREA", location=(1.7, -1.2, 1.0))
    fill = bpy.context.object
    fill.data.shape = "RECTANGLE"
    fill.data.size, fill.data.size_y = 3.0, 2.2
    fill.data.energy = 10.0
    fill.data.color = (0.86, 0.91, 1.0)
    fill.rotation_euler = (math.radians(74), 0, math.radians(54))

    # A warm bounce off the ground on the key side — low sun over soil is never
    # neutral, and without this the shaded faces go straight to sky blue.
    bpy.ops.object.light_add(type="AREA", location=(-1.5, -0.9, 0.22))
    warm = bpy.context.object
    warm.data.shape = "RECTANGLE"
    warm.data.size, warm.data.size_y = 2.4, 1.2
    warm.data.energy = 16.0
    warm.data.color = (1.0, 0.80, 0.58)
    warm.rotation_euler = (math.radians(64), 0, math.radians(-58))
    return ground


def env_makerspace():
    """A workshop: big cool north window, plywood bench, shop thrown far back."""
    scene = bpy.context.scene
    scene.view_settings.exposure = -0.85

    world = bpy.data.worlds.new("makerspace")
    scene.world = world
    world.use_nodes = True
    bg = world.node_tree.nodes["Background"]
    bg.inputs[0].default_value = (0.115, 0.125, 0.145, 1.0)
    bg.inputs[1].default_value = 0.55

    # Bench: a worn plywood top with the ply edge showing, at z = 0.
    top = wood_material("bench_ply", (0.400, 0.345, 0.268), roughness=0.78, scale=1.7)
    bench = slab(4.6, 1.65, 0.042, (0.0, 0.16, 0.0))
    bench.data.materials.append(top)

    # Trestle legs, only ever seen as dark verticals under the bench edge.
    dark, nodes, _ = node_material("bench_frame")
    nodes["Principled BSDF"].inputs["Base Color"].default_value = (0.055, 0.055, 0.062, 1.0)
    nodes["Principled BSDF"].inputs["Roughness"].default_value = 0.45
    nodes["Principled BSDF"].inputs["Metallic"].default_value = 0.7
    for sx in (-1.6, 1.6):
        for sy in (-0.42, 0.62):
            leg = slab(0.06, 0.06, 0.92, (sx, sy, -0.038))
            leg.data.materials.append(dark)

    # Floor far below, and a back wall a long way off so it defocuses hard.
    floor_mat, nodes, _ = node_material("shop_floor")
    nodes["Principled BSDF"].inputs["Base Color"].default_value = (0.205, 0.198, 0.186, 1.0)
    nodes["Principled BSDF"].inputs["Roughness"].default_value = 0.80
    floor = plane(24, location=(0, 0, -0.90))
    floor.data.materials.append(floor_mat)

    wall_mat, nodes, _ = node_material("shop_wall")
    nodes["Principled BSDF"].inputs["Base Color"].default_value = (0.215, 0.222, 0.216, 1.0)
    nodes["Principled BSDF"].inputs["Roughness"].default_value = 0.92
    wall = plane(24, location=(0, 5.2, 1.6), rotation=(math.radians(90), 0, 0))
    wall.data.materials.append(wall_mat)

    # A hint of a shop: racking, sheet stock on edge, a couple of crates. All of
    # it sits metres behind the subject and only ever appears as soft blocks.
    props, nodes, _ = node_material("shop_props")
    nodes["Principled BSDF"].inputs["Base Color"].default_value = (0.215, 0.190, 0.150, 1.0)
    nodes["Principled BSDF"].inputs["Roughness"].default_value = 0.85
    rng = random.Random(4)
    for i in range(11):
        x = -3.8 + i * 0.76 + rng.uniform(-0.18, 0.18)
        h = rng.uniform(1.1, 2.3)
        d = rng.uniform(0.10, 0.42)
        sheet = slab(rng.uniform(0.45, 1.0), d, h, (x, 4.3 + rng.uniform(-0.4, 0.4), h - 0.90))
        sheet.data.materials.append(props)
    for i in range(5):
        crate = slab(0.7, 0.6, 0.52, (-3.0 + i * 1.6, 3.0, -0.38))
        crate.data.materials.append(props)
    # Stock stacked just past the far edge of the bench, so a high camera has
    # something behind the work instead of an empty floor.
    for i, (x, w, h) in enumerate(((-1.75, 0.9, 0.74), (-0.60, 0.7, 0.52),
                                   (0.55, 1.1, 0.64), (1.70, 0.6, 0.86))):
        stack = slab(w, 0.5, h, (x, 1.35 + (i % 2) * 0.20, h - 0.90))
        stack.data.materials.append(props)

    # Key: a tall north window, cool and very soft — the whole look of the room.
    bpy.ops.object.light_add(type="AREA", location=(-2.6, -0.9, 1.5))
    key = bpy.context.object
    key.data.shape = "RECTANGLE"
    key.data.size, key.data.size_y = 2.6, 2.0
    key.data.energy = 420.0
    key.data.color = (0.815, 0.870, 1.0)
    key.rotation_euler = (math.radians(90), 0, math.radians(-72))

    # Neutral bounce off the bench and a far wall wash, both weak.
    bpy.ops.object.light_add(type="AREA", location=(2.2, -0.4, 0.85))
    bounce = bpy.context.object
    bounce.data.shape = "RECTANGLE"
    bounce.data.size, bounce.data.size_y = 2.4, 1.6
    bounce.data.energy = 45.0
    bounce.data.color = (1.0, 0.975, 0.945)
    bounce.rotation_euler = (math.radians(84), 0, math.radians(96))

    bpy.ops.object.light_add(type="AREA", location=(0.0, 5.4, 2.4))
    wash = bpy.context.object
    wash.data.shape = "RECTANGLE"
    wash.data.size, wash.data.size_y = 6.0, 2.0
    wash.data.energy = 140.0
    wash.data.color = (0.90, 0.92, 1.0)
    wash.rotation_euler = (math.radians(120), 0, 0)
    return bench


def env_studio():
    """A white seamless sweep, one big soft key — catalogue product lighting."""
    scene = bpy.context.scene
    scene.view_settings.exposure = -1.30

    world = bpy.data.worlds.new("studio")
    scene.world = world
    world.use_nodes = True
    bg = world.node_tree.nodes["Background"]
    bg.inputs[0].default_value = (0.55, 0.56, 0.58, 1.0)
    bg.inputs[1].default_value = 0.30

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


ENVIRONMENTS = {"garden": env_garden, "makerspace": env_makerspace, "studio": env_studio}


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


def add_wall_mount(index, origin, lift, wood="birch"):
    """Fixed to a board: the base plate cantilevered off a vertical panel."""
    objs = []
    base_parts, base_h, base_zmin = load_part(os.path.join(MODELS, "base.glb"))
    for obj in base_parts:
        place(obj, origin[0], origin[1], lift - base_h * MM, base_zmin)
    objs += base_parts
    objs = paint(objs, wood)

    board = slab(0.30, 0.020, lift + 0.30, (origin[0], origin[1] + 0.092, lift + 0.22))
    board.data.materials.append(
        wood_material(f"board_{len(bpy.data.materials)}", WOODS["walnut"],
                      roughness=0.70, scale=5.0))
    return objs + [board]


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
# Eleven frames, and no two share a camera except the assembly sequence, where
# a fixed camera is the entire point.

def shot_hero_garden(index):
    """Sited in planting, low three-quarter, long lens, warm rake."""
    reset(*size(2000, 1250, 110))
    env_garden()
    lift = 0.34
    yaw = math.radians(-8)
    subject, _ = build(index, ["D", "F", "G", "H", "M"], ["oak", "oak", "walnut"],
                       lift=lift, yaw=yaw)
    subject += add_support(index, (0, 0), lift, wood="oak", yaw=yaw)
    frame(subject, azimuth=-50, elevation=7, lens=105, margin=1.14, fstop=4.5,
          target=(0.5, 0.5, 0.62), focus=(0.35, 0.15, 0.74))
    render(f"{OUT}/hero-garden.png")


def shot_hero_studio(index):
    """Near-elevation, clean, the catalogue frame."""
    reset(*size(2000, 1500, 110), look="AgX - Base Contrast")
    env_studio()
    lift = 0.26
    subject, _ = build(index, ["N", "O", "P", "M"], ["oak", "larch", "oak"], lift=lift)
    subject += add_support(index, (0, 0), lift, wood="oak")
    frame(subject, azimuth=-13, elevation=5, lens=120, margin=1.08, fstop=11.0,
          target=(0.5, 0.5, 0.54))
    render(f"{OUT}/hero-studio.png")


def shot_bench_makerspace(index):
    """On the bench, looking down, with offcuts and a loose storey to hand."""
    reset(*size(1600, 1200, 96))
    env_makerspace()
    subject, _ = build(index, ["A", "B", "C", "M"], ["oak", "larch", "oak"],
                       origin=(-0.08, 0.02), lift=0.0, yaw=math.radians(14))
    props = []

    # Offcuts: the strips a sheet leaves behind, dropped in a loose fan rather
    # than laid out — a tidy row reads as a diagram, not a bench.
    rng = random.Random(21)
    cut_mat = wood_material("offcut", WOODS["birch"], roughness=0.70, scale=6.0)
    for i in range(6):
        angle = rng.uniform(-0.7, 0.7)
        x = 0.235 + rng.uniform(-0.03, 0.10)
        y = -0.16 + i * 0.048 + rng.uniform(-0.015, 0.015)
        off = slab(rng.uniform(0.10, 0.24), rng.uniform(0.024, 0.046), 0.012,
                   (x, y, 0.012 + i * 0.0004))
        off.rotation_euler = (0, 0, angle)
        off.data.materials.append(cut_mat)
        props.append(off)

    # A storey lying flat and one propped on its edge, waiting to go on.
    loose, _, z_min = load_part(os.path.join(MODELS, "P_a.glb"))
    for obj in loose:
        place(obj, 0.175, 0.175, 0.0, z_min, yaw=math.radians(-34))
    props += paint(loose, "larch")

    standing, _, s_zmin = load_part(os.path.join(MODELS, "C_a.glb"))
    for obj in standing:
        place(obj, -0.235, 0.155, 0.0, s_zmin, yaw=math.radians(24))
    props += paint(standing, "oak")

    frame(subject + props, azimuth=-26, elevation=22, lens=44, margin=1.06, fstop=3.6,
          target=(0.46, 0.46, 0.40), focus=(0.40, 0.40, 0.55))
    render(f"{OUT}/bench-makerspace.png")


def shot_detail_cavity(index):
    """Macro straight onto the tunnel mouths, everything else gone soft."""
    reset(*size(1600, 1200, 110))
    env_garden()
    # A macro is nearly all timber, so it meters far hotter than a wide shot.
    bpy.context.scene.view_settings.exposure = -0.95
    lift = 0.30
    block, _ = build(index, ["N", "O", "P", "M"], ["oak", "larch", "oak"], lift=lift)
    add_support(index, (0, 0), lift, wood="oak")
    # Framed off the storeys alone: include the legs and the auto-fit pulls back
    # to hold them, which is how a "macro" ends up being a picture of a stool.
    frame(block, azimuth=-27, elevation=4, lens=135, margin=1.00, fstop=2.6,
          target=(0.68, 0.40, 0.46), pull=0.62, focus=(0.68, 0.0, 0.46))
    render(f"{OUT}/detail-cavity.png")


def shot_detail_joint(index):
    """Macro on a corner: the storey seam and the spine key, raking window light."""
    reset(*size(1600, 1200, 110))
    env_makerspace()
    bpy.context.scene.view_settings.exposure = -1.15
    subject, _ = build(index, ["D", "F", "G", "H"], ["oak", "birch", "walnut"], lift=0.02)
    frame(subject, azimuth=-54, elevation=11, lens=135, margin=1.00, fstop=5.6,
          target=(0.22, 0.24, 0.50), pull=0.60, focus=(0.22, 0.20, 0.50))
    render(f"{OUT}/detail-joint.png")


def shot_stack_trio(index):
    """Three configurations, three timbers, three ways of standing it up."""
    reset(*size(1600, 1100, 110), look="AgX - Base Contrast")
    env_studio()
    subject = []

    # Left: short stack on the ground spike, larch.
    left = (-0.44, 0.03)
    placed, _ = build(index, ["I", "J", "C"], ["larch"], origin=left, lift=0.34)
    subject += placed + add_spike(index, left, 0.34, wood="larch")

    # Middle: the tall one on legs, oak with a walnut band.
    mid = (-0.02, -0.02)
    placed, _ = build(index, ["A", "B", "C", "M"], ["oak", "oak", "walnut"],
                      origin=mid, lift=0.20)
    subject += placed + add_support(index, mid, 0.20)

    # Right: fixed to a board, oak, and a different set of storeys again.
    right = (0.42, 0.05)
    placed, _ = build(index, ["N", "O", "P"], ["oak"], origin=right, lift=0.16)
    subject += placed + add_wall_mount(index, right, 0.16, wood="oak")

    frame(subject, azimuth=-22, elevation=14, lens=90, margin=1.10, fstop=9.0,
          target=(0.5, 0.5, 0.50))
    render(f"{OUT}/stack-trio.png")


def shot_assembly(index):
    """Four build states, one camera, held. Repetition is the point here."""
    letters = ["A", "P", "P", "M"]
    lift = 0.16
    for step in range(1, 5):
        reset(*size(1600, 1200, 96))
        env_makerspace()
        subject = add_support(index, (0, 0), lift, wood="oak")
        shown = letters[:step]
        placed, stack_top = build(index, shown, ["oak", "larch", "oak"],
                                  lift=lift, roof=(step == 4))
        subject += placed

        # The next part to go on hovers above the stack — except on the last
        # frame, which is the finished object with its roof on.
        if step < 4:
            nxt = letters[step]
            parts, _, z_min = load_part(os.path.join(MODELS, f"{nxt}_a.glb"))
            for obj in parts:
                place(obj, 0, 0, stack_top + 0.075, z_min)
            subject += paint(parts, "oak")

        # The camera is placed from the *finished* object every time, so it
        # cannot drift as the stack grows.
        anchor = frame_anchor(index, letters, lift)
        frame(anchor, azimuth=-42, elevation=18, lens=66, margin=1.30, fstop=5.0,
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
    "hero-garden": shot_hero_garden,
    "hero-studio": shot_hero_studio,
    "bench-makerspace": shot_bench_makerspace,
    "detail-cavity": shot_detail_cavity,
    "detail-joint": shot_detail_joint,
    "stack-trio": shot_stack_trio,
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
