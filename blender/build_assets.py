"""
SupplyShock AI - procedural asset pack.

Builds every 3D model used by the web app (trucks, hubs, port cranes, the
container ship, hospitals, trees ...) from code and exports them into a single
GLB that Three.js loads at runtime.

Run headless:
    blender --background --factory-startup --python blender/build_assets.py -- \
        --out public/models/supplyshock.glb [--preview preview.png]

Conventions (Blender space, Z up; the glTF exporter converts to Y up):
  * 1 Blender unit = 1 world unit in the app.
  * Every asset has its origin at ground level (z = 0), centred on its footprint.
  * Vehicles face +X. Buildings face -Y (their doors/docks), which is +Z in Three.js.
  * Materials whose name starts with "Tint" are recoloured per instance in the app.
"""

import math
import os
import sys

import bmesh
import bpy
from mathutils import Matrix, Vector

# --------------------------------------------------------------------------- #
# Materials
# --------------------------------------------------------------------------- #

def srgb_to_linear(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def hex_rgba(h):
    h = h.lstrip("#")
    r, g, b = (int(h[i:i + 2], 16) / 255 for i in (0, 2, 4))
    return (srgb_to_linear(r), srgb_to_linear(g), srgb_to_linear(b), 1.0)


_MATS = {}


def mat(name, color, rough=0.75, metal=0.0, emit=0.0):
    if name in _MATS:
        return _MATS[name]
    existing = bpy.data.materials.get(name)
    if existing is not None:
        _MATS[name] = existing
        return existing
    m = bpy.data.materials.new(name)
    if m.node_tree is None:  # Blender 4.x; materials always have nodes in 5.x
        m.use_nodes = True
    rgba = hex_rgba(color)
    m.diffuse_color = rgba
    nt = m.node_tree
    if nt is not None:
        bsdf = next((n for n in nt.nodes if n.type == "BSDF_PRINCIPLED"), None)
        if bsdf is not None:
            bsdf.inputs["Base Color"].default_value = rgba
            bsdf.inputs["Roughness"].default_value = rough
            bsdf.inputs["Metallic"].default_value = metal
            if emit > 0:
                for key in ("Emission Color", "Emission"):
                    if key in bsdf.inputs:
                        bsdf.inputs[key].default_value = rgba
                        break
                if "Emission Strength" in bsdf.inputs:
                    bsdf.inputs["Emission Strength"].default_value = emit
    _MATS[name] = m
    return m


# Shared palette - calm, light "architectural model" look.
WALL = lambda: mat("Wall", "#F5F7FA", 0.85)
WALL_ALT = lambda: mat("WallAlt", "#E8EDF3", 0.85)
WALL_WARM = lambda: mat("WallWarm", "#FBF4EC", 0.85)
WALL_SAND = lambda: mat("WallSand", "#F0EADF", 0.85)
CONCRETE = lambda: mat("Concrete", "#D7DDE5", 0.95)
ROOF = lambda: mat("Roof", "#C3CEDE", 0.7)
ROOF_LIGHT = lambda: mat("RoofLight", "#E3E8EF", 0.8)
ROOF_SAND = lambda: mat("RoofSand", "#D9CFBF", 0.8)
ROOF_CLAY = lambda: mat("RoofClay", "#D49A86", 0.8)
GLASS = lambda: mat("Glass", "#9DB9DA", 0.15, 0.1)
GLASS_DARK = lambda: mat("GlassDark", "#2B3950", 0.2, 0.1)
DOOR = lambda: mat("Door", "#6B7A90", 0.6)
DARK = lambda: mat("Dark", "#2F3746", 0.6)
METAL = lambda: mat("Metal", "#CDD4DE", 0.35, 0.4)
BRAND = lambda: mat("Brand", "#4F46E5", 0.5)
WHITE = lambda: mat("White", "#FFFFFF", 0.6)


# --------------------------------------------------------------------------- #
# Geometry builder: everything for one asset goes into one bmesh so the app
# gets a single mesh (one draw call per material).
# --------------------------------------------------------------------------- #

# Every hard edge gets a small chamfer. At model scale it is invisible as a
# shape, but it catches the key light as a bright line and the sky as a soft
# one, which is most of what separates a rendered model from flat-shaded boxes.
AUTO_BEVEL = 0.022


def _auto(bevel, *dims):
    """Chamfer width for a shape with these dimensions (None = the default)."""
    if bevel is None:
        bevel = AUTO_BEVEL
    if bevel <= 0:
        return 0.0
    return max(0.0, min(bevel, *(abs(d) / 6.0 for d in dims if d)))


class Builder:
    def __init__(self, name):
        self.name = name
        self.bm = bmesh.new()
        self.mats = []

    def _mi(self, m):
        if m not in self.mats:
            self.mats.append(m)
        return self.mats.index(m)

    def _merge(self, tmp, m, bevel=0.0, segments=1):
        if bevel > 0:
            bmesh.ops.bevel(tmp, geom=list(tmp.edges), offset=bevel, segments=segments,
                            profile=0.5, affect="EDGES", clamp_overlap=True)
        idx = self._mi(m)
        for f in tmp.faces:
            f.material_index = idx
        me = bpy.data.meshes.new("_tmp")
        tmp.to_mesh(me)
        tmp.free()
        self.bm.from_mesh(me)
        bpy.data.meshes.remove(me)

    # Axis-aligned box from bounds.
    def box(self, m, x0, x1, y0, y1, z0, z1, bevel=None, segments=1):
        tmp = bmesh.new()
        sx, sy, sz = x1 - x0, y1 - y0, z1 - z0
        mtx = Matrix.Translation(((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2)) @ \
            Matrix.Diagonal((sx, sy, sz, 1.0))
        bmesh.ops.create_cube(tmp, size=1.0, matrix=mtx)
        self._merge(tmp, m, _auto(bevel, sx, sy, sz), segments)

    # Square-section beam between two points.
    def beam(self, m, p0, p1, w=0.3, h=None, bevel=None):
        h = h or w
        p0, p1 = Vector(p0), Vector(p1)
        d = p1 - p0
        length = d.length
        rot = Vector((1, 0, 0)).rotation_difference(d.normalized()).to_matrix().to_4x4()
        mtx = Matrix.Translation((p0 + p1) / 2) @ rot @ Matrix.Diagonal((length, w, h, 1.0))
        tmp = bmesh.new()
        bmesh.ops.create_cube(tmp, size=1.0, matrix=mtx)
        self._merge(tmp, m, _auto(bevel, length, w, h))

    def cylinder(self, m, cx, cy, z0, z1, r, r_top=None, seg=24, axis="Z", bevel=None):
        r_top = r if r_top is None else r_top
        depth = z1 - z0
        tmp = bmesh.new()
        if axis == "Z":
            mtx = Matrix.Translation((cx, cy, (z0 + z1) / 2))
        elif axis == "Y":  # cx = x, cy = z, z0/z1 = y range
            mtx = Matrix.Translation((cx, (z0 + z1) / 2, cy)) @ Matrix.Rotation(math.pi / 2, 4, "X")
        else:  # X axis: cx = y, cy = z, z0/z1 = x range
            mtx = Matrix.Translation(((z0 + z1) / 2, cx, cy)) @ Matrix.Rotation(math.pi / 2, 4, "Y")
        bmesh.ops.create_cone(tmp, cap_ends=True, cap_tris=False, segments=seg,
                              radius1=r, radius2=r_top, depth=depth, matrix=mtx)
        self._merge(tmp, m, _auto(bevel, depth, r * 2, (r_top or r) * 2))

    def sphere(self, m, cx, cy, cz, r, sub=2, squash=1.0):
        tmp = bmesh.new()
        mtx = Matrix.Translation((cx, cy, cz)) @ Matrix.Diagonal((1.0, 1.0, squash, 1.0))
        bmesh.ops.create_icosphere(tmp, subdivisions=sub, radius=r, matrix=mtx)
        self._merge(tmp, m)

    # Triangular prism along X (gable roofs). Eaves at +/-half_w, ridge height h.
    def gable(self, m, x0, x1, half_w, z0, h, yc=0.0, bevel=None):
        tmp = bmesh.new()
        prof = [(yc - half_w, z0), (yc + half_w, z0), (yc, z0 + h)]
        a = [tmp.verts.new((x0, y, z)) for y, z in prof]
        b = [tmp.verts.new((x1, y, z)) for y, z in prof]
        tmp.faces.new(a[::-1])
        tmp.faces.new(b)
        for i in range(3):
            j = (i + 1) % 3
            tmp.faces.new((a[i], a[j], b[j], b[i]))
        bmesh.ops.recalc_face_normals(tmp, faces=tmp.faces)
        self._merge(tmp, m, _auto(bevel, x1 - x0, half_w * 2, h))

    # Extrude a closed XY polygon between two heights, optionally tapering:
    # bottom outline and top outline must have the same vertex count.
    def loft(self, m_side, bottom, z0, top, z1, m_top=None, m_bottom=None):
        tmp = bmesh.new()
        vb = [tmp.verts.new((x, y, z0)) for x, y in bottom]
        vt = [tmp.verts.new((x, y, z1)) for x, y in top]
        n = len(vb)
        f_bot = tmp.faces.new(vb[::-1])
        f_top = tmp.faces.new(vt)
        sides = [tmp.faces.new((vb[i], vb[(i + 1) % n], vt[(i + 1) % n], vt[i])) for i in range(n)]
        bmesh.ops.recalc_face_normals(tmp, faces=tmp.faces)
        ids = {}
        for f, mm in ((f_bot, m_bottom or m_side), (f_top, m_top or m_side)):
            ids[f] = self._mi(mm)
        side_idx = self._mi(m_side)
        for f in tmp.faces:
            f.material_index = ids.get(f, side_idx)
        me = bpy.data.meshes.new("_tmp")
        tmp.to_mesh(me)
        tmp.free()
        self.bm.from_mesh(me)
        bpy.data.meshes.remove(me)
        del sides

    def finish(self, parent=None):
        bmesh.ops.remove_doubles(self.bm, verts=self.bm.verts, dist=1e-5)
        me = bpy.data.meshes.new(self.name)
        self.bm.to_mesh(me)
        self.bm.free()
        for m in self.mats:
            me.materials.append(m)
        ob = bpy.data.objects.new(self.name, me)
        bpy.context.scene.collection.objects.link(ob)
        if parent is not None:
            ob.parent = parent
        return ob


def empty(name):
    ob = bpy.data.objects.new(name, None)
    bpy.context.scene.collection.objects.link(ob)
    return ob


# --------------------------------------------------------------------------- #
# Vehicles
# --------------------------------------------------------------------------- #

def build_truck():
    b = Builder("truck")
    body = mat("TruckBody", "#FBFCFD", 0.45)
    cab = mat("TruckCab", "#F2F4F8", 0.45)
    tint = mat("TintTruck", "#4F46E5", 0.45)  # recoloured per shipment type
    tire = mat("Tire", "#262B34", 0.9)
    hub = mat("Hub", "#C3CAD4", 0.4, 0.3)
    lamp = mat("Lamp", "#FFF3C4", 0.3, 0.0, emit=2.0)
    # chassis + bumper
    b.box(DARK(), -1.62, 1.55, -0.5, 0.5, 0.30, 0.52)
    b.box(DARK(), 1.55, 1.72, -0.6, 0.6, 0.34, 0.58, bevel=0.04)
    # cargo box with a tinted band
    b.box(tint, -1.70, 0.60, -0.66, 0.66, 0.52, 1.80, bevel=0.07, segments=2)
    b.box(body, -1.712, 0.612, -0.672, 0.672, 1.46, 1.56)
    b.box(body, -1.72, -1.69, -0.5, 0.5, 0.62, 1.66)  # rear door panel
    # cab
    b.box(cab, 0.66, 1.62, -0.62, 0.62, 0.50, 1.50, bevel=0.12, segments=2)
    b.box(tint, 0.66, 1.63, -0.63, 0.63, 0.50, 0.70)  # cab skirt
    b.box(GLASS_DARK(), 1.585, 1.66, -0.52, 0.52, 0.98, 1.38, bevel=0.03)
    b.box(GLASS_DARK(), 0.95, 1.42, -0.635, 0.635, 1.0, 1.36)
    b.box(lamp, 1.70, 1.735, 0.36, 0.54, 0.62, 0.74)
    b.box(lamp, 1.70, 1.735, -0.54, -0.36, 0.62, 0.74)
    # wheels
    for x in (1.12, -0.72, -1.22):
        for y in (-0.53, 0.53):
            b.cylinder(tire, x, 0.30, y - 0.12, y + 0.12, 0.30, seg=14, axis="Y")
            side = 0.125 if y > 0 else -0.125
            b.cylinder(hub, x, 0.30, y + side - 0.01, y + side + 0.01, 0.15, seg=10, axis="Y")
    return b.finish()


def build_ship():
    root = empty("ship")
    hull = Builder("ship_hull")
    hull_low = mat("HullLow", "#3F6E8C", 0.6)
    hull_top = mat("HullTop", "#24324D", 0.55)
    deck = mat("Deck", "#A9B3C2", 0.8)
    funnel = mat("Funnel", "#4F46E5", 0.5)
    top = [(-12.0, -2.6), (7.0, -2.6), (10.6, -1.5), (12.2, 0.0), (10.6, 1.5), (7.0, 2.6), (-12.0, 2.6)]
    mid = [(-11.8, -2.45), (6.8, -2.45), (10.2, -1.35), (11.6, 0.0), (10.2, 1.35), (6.8, 2.45), (-11.8, 2.45)]
    bot = [(-11.3, -1.9), (6.2, -1.9), (9.3, -0.9), (10.5, 0.0), (9.3, 0.9), (6.2, 1.9), (-11.3, 1.9)]
    hull.loft(hull_low, bot, -1.2, mid, 0.15)
    hull.loft(hull_top, mid, 0.15, top, 1.55, m_top=deck)
    # bridge / accommodation block at the stern
    hull.box(WHITE(), -11.2, -7.6, -2.2, 2.2, 1.55, 5.9, bevel=0.06)
    hull.box(WHITE(), -9.8, -8.1, -2.95, 2.95, 5.2, 5.85)
    hull.box(GLASS_DARK(), -7.62, -7.55, -2.0, 2.0, 5.25, 5.7)
    hull.box(GLASS_DARK(), -11.25, -7.55, -2.23, 2.23, 3.4, 3.75)
    hull.box(funnel, -11.7, -10.2, -0.85, 0.85, 5.9, 7.5, bevel=0.08)
    hull.box(DARK(), -11.75, -10.15, -0.9, 0.9, 7.3, 7.55)
    hull.beam(DARK(), (-9.0, 0.0, 5.9), (-9.0, 0.0, 8.0), w=0.12)
    hull.box(mat("Bow", "#F5F7FA", 0.6), 9.0, 11.4, -0.4, 0.4, 1.55, 1.9)
    hull.finish(parent=root)

    palette = ["#5B7DB1", "#7FB0D6", "#E2B46F", "#97C3A3", "#C2C9D3", "#8D8AD6", "#E59F7E", "#6FA7A0"]
    pmats = [mat(f"Box{i}", c, 0.7) for i, c in enumerate(palette)]
    rows = (-1.65, -0.55, 0.55, 1.65)
    bays = {
        "ship_cargo_a": (-6.95, -4.45),
        "ship_cargo_b": (-4.3, -1.8),
        "ship_cargo_c": (-1.55, 0.95),
        "ship_cargo_d": (1.2, 3.7),
        "ship_cargo_e": (3.95, 6.45),
    }
    k = 0
    for bi, (name, (x0, x1)) in enumerate(bays.items()):
        c = Builder(name)
        tiers = 3 if bi in (1, 2, 3) else 2
        for t in range(tiers):
            for r in rows:
                k = (k * 7 + 3 + t) % len(pmats)
                c.box(pmats[k], x0, x1, r - 0.52, r + 0.52, 1.55 + t * 1.02, 2.55 + t * 1.02, bevel=0.03)
        c.finish(parent=root)
    return root


# --------------------------------------------------------------------------- #
# Buildings
# --------------------------------------------------------------------------- #

def build_crane():
    b = Builder("port_crane")
    blue = mat("CraneBlue", "#2F6FED", 0.5)
    white = mat("CraneWhite", "#F8FAFC", 0.6)
    # portal legs + sill beams
    for y in (-2.2, 2.2):
        for x in (-2.0, 2.0):
            b.box(blue, x - 0.28, x + 0.28, y - 0.28, y + 0.28, 0.35, 9.0)
            b.box(DARK(), x - 0.45, x + 0.45, y - 0.4, y + 0.4, 0.0, 0.4)
        b.box(blue, -2.3, 2.3, y - 0.3, y + 0.3, 8.6, 9.25)
        b.beam(blue, (-2.0, y, 1.2), (2.0, y, 7.8), w=0.18)
    for x in (-2.0, 2.0):
        b.box(blue, x - 0.3, x + 0.3, -2.5, 2.5, 8.6, 9.25)
    # boom over the water (-X) and backreach (+X)
    for y in (-1.0, 1.0):
        b.box(blue, -15.5, 6.5, y - 0.25, y + 0.25, 9.25, 9.95)
    for x in range(-15, 7, 3):
        b.box(blue, x - 0.12, x + 0.12, -1.25, 1.25, 9.35, 9.85)
    # A-frame + stays
    for y in (-1.0, 1.0):
        b.beam(blue, (-0.8, y, 9.9), (0.0, y, 14.2), w=0.24)
        b.beam(blue, (0.8, y, 9.9), (0.0, y, 14.2), w=0.24)
        b.beam(white, (0.0, y, 14.2), (-15.0, y, 9.95), w=0.09)
        b.beam(white, (0.0, y, 14.2), (6.3, y, 9.95), w=0.09)
    b.box(blue, -0.25, 0.25, -1.25, 1.25, 13.9, 14.4)
    # machinery house, trolley and spreader
    b.box(white, 2.2, 6.2, -1.6, 1.6, 9.95, 11.7, bevel=0.06)
    b.box(GLASS_DARK(), 2.15, 2.25, -1.2, 1.2, 10.6, 11.2)
    b.box(white, -10.0, -8.4, -1.05, 1.05, 9.0, 9.55)
    b.box(GLASS_DARK(), -10.05, -9.6, -0.5, 0.5, 9.05, 9.45)
    for y in (-0.5, 0.5):
        b.beam(DARK(), (-9.2, y, 9.0), (-9.2, y, 5.2), w=0.05)
    b.box(DARK(), -10.4, -8.0, -0.65, 0.65, 4.9, 5.2)
    return b.finish()


def build_house():
    b = Builder("house")
    b.box(WALL(), -1.6, 1.6, -1.3, 1.3, 0.0, 2.0)
    b.gable(mat("TintRoof", "#B8C4D6", 0.8), -1.8, 1.8, 1.55, 1.95, 1.1)
    b.box(GLASS(), -1.0, -0.3, -1.36, -1.28, 0.9, 1.5)
    b.box(GLASS(), 0.3, 1.0, -1.36, -1.28, 0.9, 1.5)
    return b.finish()


# --------------------------------------------------------------------------- #
# Props (instanced in the app)
# --------------------------------------------------------------------------- #

def build_container():
    b = Builder("container")
    m = mat("TintContainer", "#FFFFFF", 0.65)
    b.box(m, -1.2, 1.2, -0.5, 0.5, 0.0, 1.0, bevel=0.02)
    for x in (-0.8, -0.4, 0.0, 0.4, 0.8):
        b.box(m, x - 0.06, x + 0.06, -0.53, 0.53, 0.06, 0.94)
    b.box(m, 1.17, 1.24, -0.46, 0.46, 0.05, 0.95)
    return b.finish()


def build_crate():
    b = Builder("crate")
    m = mat("TintCrate", "#FFFFFF", 0.8)
    b.box(m, -0.44, 0.44, -0.44, 0.44, 0.14, 0.92, bevel=0.04)
    b.box(m, -0.46, 0.46, -0.07, 0.07, 0.90, 0.95)
    return b.finish()


def build_pallet():
    b = Builder("pallet")
    wood = mat("Pallet", "#CDAE8A", 0.9)
    b.box(wood, -0.5, 0.5, -0.5, 0.5, 0.09, 0.14)
    for y in (-0.42, 0.0, 0.42):
        b.box(wood, -0.5, 0.5, y - 0.07, y + 0.07, 0.0, 0.09)
    return b.finish()


def build_trees():
    t1 = Builder("tree_round")
    trunk = mat("Trunk", "#A88B6E", 0.9)
    t1.cylinder(trunk, 0, 0, 0.0, 1.2, 0.17, 0.12, seg=7)
    t1.sphere(mat("Leaf", "#9CCB90", 0.9), 0, 0, 2.05, 1.15, squash=0.92)
    t1.finish()
    t2 = Builder("tree_cone")
    t2.cylinder(trunk, 0, 0, 0.0, 0.8, 0.15, 0.1, seg=7)
    leaf2 = mat("LeafDark", "#77B58A", 0.9)
    t2.cylinder(leaf2, 0, 0, 0.6, 2.4, 1.05, 0.45, seg=8)
    t2.cylinder(leaf2, 0, 0, 2.0, 3.6, 0.75, 0.0, seg=8)
    t2.finish()


def build_barrier():
    b = Builder("barrier")
    red = mat("Hazard", "#E5484D", 0.55)
    for i in range(6):
        x0 = -1.5 + i * 0.5
        b.box(red if i % 2 == 0 else WHITE(), x0, x0 + 0.5, -0.1, 0.1, 0.62, 1.02)
    for x in (-1.25, 1.25):
        b.box(WHITE(), x - 0.07, x + 0.07, -0.07, 0.07, 0.0, 1.05)
        b.box(DARK(), x - 0.25, x + 0.25, -0.2, 0.2, 0.0, 0.08)
    cone = mat("Cone", "#F97316", 0.6)
    for x in (-2.1, 2.1):
        b.box(cone, x - 0.3, x + 0.3, -0.3, 0.3, 0.0, 0.07)
        b.cylinder(cone, x, 0.0, 0.07, 0.8, 0.24, 0.05, seg=10)
        b.cylinder(WHITE(), x, 0.0, 0.38, 0.5, 0.17, 0.14, seg=10)
    return b.finish()


# --------------------------------------------------------------------------- #
# Preview render (optional) - lays the assets out in a row and renders them.
# --------------------------------------------------------------------------- #

def render_preview(path, roots):
    cols = 4
    cell = 24.0
    for i, ob in enumerate(roots):
        ob.location = ((i % cols) * cell, -(i // cols) * cell, 0)
    rows = (len(roots) + cols - 1) // cols
    cx = (cols - 1) * cell / 2
    cy = -(rows - 1) * cell / 2
    scene = bpy.context.scene
    world = bpy.data.worlds.new("PreviewWorld")
    scene.world = world
    if world.node_tree is None:
        world.use_nodes = True
    bg = next((n for n in world.node_tree.nodes if n.type == "BACKGROUND"), None)
    if bg:
        bg.inputs[0].default_value = (0.86, 0.89, 0.93, 1)
        bg.inputs[1].default_value = 0.8
    sun_data = bpy.data.lights.new("Sun", "SUN")
    sun_data.energy = 2.2
    sun = bpy.data.objects.new("Sun", sun_data)
    sun.rotation_euler = (math.radians(45), math.radians(15), math.radians(-30))
    scene.collection.objects.link(sun)
    ground = Builder("_ground")
    ground.box(mat("_Ground", "#EEF1F5", 1.0), -cell, cols * cell, -rows * cell, cell, -0.1, 0.0)
    ground.finish()
    cam_data = bpy.data.cameras.new("Cam")
    cam_data.type = "ORTHO"
    cam_data.ortho_scale = cols * cell * 1.02
    cam = bpy.data.objects.new("Cam", cam_data)
    cam.location = (cx, cy - 78, 44)
    cam.rotation_euler = (math.radians(62), 0, 0)
    scene.collection.objects.link(cam)
    scene.camera = cam
    scene.render.resolution_x = 1800
    scene.render.resolution_y = int(1800 * rows / cols * 0.9)
    scene.render.filepath = path
    for engine in ("BLENDER_EEVEE", "BLENDER_EEVEE_NEXT", "BLENDER_WORKBENCH"):
        try:
            scene.render.engine = engine
            break
        except TypeError:
            continue
    scene.view_settings.view_transform = "AgX"
    bpy.ops.render.render(write_still=True)
    print("preview written:", path, "engine:", scene.render.engine)


# --------------------------------------------------------------------------- #

def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    out = argv[argv.index("--out") + 1] if "--out" in argv else "supplyshock.glb"
    preview = argv[argv.index("--preview") + 1] if "--preview" in argv else None

    bpy.ops.wm.read_factory_settings(use_empty=True)

    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    import landmarks  # noqa: E402  (detailed buildings live in landmarks.py)

    roots = [
        build_truck(), build_ship(), build_crane(), build_house(), build_container(),
        build_crate(), build_pallet(), build_barrier(),
    ]
    build_trees()
    roots += [bpy.data.objects["tree_round"], bpy.data.objects["tree_cone"]]
    landmark_roots = landmarks.build_all()
    roots += landmark_roots

    bpy.ops.export_scene.gltf(filepath=out, export_format="GLB", export_apply=True, export_yup=True)
    tris = sum(sum(len(p.vertices) - 2 for p in o.data.polygons) for o in bpy.data.objects if o.type == "MESH")
    print(f"exported {len(roots)} assets, {tris} triangles -> {out}")

    if preview:
        render_preview(preview, landmark_roots + [bpy.data.objects["port_crane"], bpy.data.objects["truck"]])


if __name__ == "__main__":
    main()
