"""
Detailed landmark buildings for SupplyShock AI (imported by build_assets.py).

Every landmark has its own silhouette, palette and props so the network reads
at a glance: three different hubs, two different hospitals, a clinic, a
pharmacy, a care home, the backup factory, the port tower and a lighthouse.
Front of every building faces -Y (towards the road in the app).
"""

import math

import bmesh
import bpy
from mathutils import Matrix, Vector

from build_assets import (
    Builder, mat, CONCRETE, ROOF, ROOF_LIGHT, GLASS, GLASS_DARK, DOOR, DARK, METAL, BRAND, WHITE,
    WALL, WALL_SAND, ROOF_SAND,
)


# --------------------------------------------------------------------------- #
# Extra geometry helpers
# --------------------------------------------------------------------------- #

def obox(b, m, cx, cy, cz, sx, sy, sz, rx=0.0, ry=0.0, rz=0.0):
    """Oriented box centred at (cx, cy, cz) with size (sx, sy, sz) and Euler rotation."""
    tmp = bmesh.new()
    rot = (Matrix.Rotation(rz, 4, "Z") @ Matrix.Rotation(ry, 4, "Y") @ Matrix.Rotation(rx, 4, "X"))
    mtx = Matrix.Translation((cx, cy, cz)) @ rot @ Matrix.Diagonal((sx, sy, sz, 1.0))
    bmesh.ops.create_cube(tmp, size=1.0, matrix=mtx)
    b._merge(tmp, m)


def barrel(b, m, x0, x1, half_w, z0, rise, seg=14, yc=0.0):
    """Curved (barrel) roof along X: elliptical arch from -half_w to +half_w."""
    tmp = bmesh.new()
    prof = [(yc + half_w * math.cos(math.pi * i / seg), z0 + rise * math.sin(math.pi * i / seg)) for i in range(seg + 1)]
    a = [tmp.verts.new((x0, y, z)) for y, z in prof]
    c = [tmp.verts.new((x1, y, z)) for y, z in prof]
    for i in range(seg):
        tmp.faces.new((a[i], a[i + 1], c[i + 1], c[i]))
    tmp.faces.new(a[::-1])
    tmp.faces.new(c)
    bmesh.ops.recalc_face_normals(tmp, faces=tmp.faces)
    b._merge(tmp, m)


def window_grid_y(b, m, y, x0, x1, z0, z1, cols, rows, w, h, depth=0.07):
    """Windows on a wall facing +/-Y located at `y` (outer surface)."""
    sgn = -1 if y < 0 else 1
    for c in range(cols):
        cx = x0 + (x1 - x0) * (c + 0.5) / cols
        for r in range(rows):
            cz = z0 + (z1 - z0) * (r + 0.5) / rows
            lo, hi = (y - depth, y + 0.02) if sgn < 0 else (y - 0.02, y + depth)
            b.box(m, cx - w / 2, cx + w / 2, lo, hi, cz - h / 2, cz + h / 2)


def window_grid_x(b, m, x, y0, y1, z0, z1, cols, rows, w, h, depth=0.07):
    """Windows on a wall facing +/-X located at `x` (outer surface)."""
    for c in range(cols):
        cy = y0 + (y1 - y0) * (c + 0.5) / cols
        for r in range(rows):
            cz = z0 + (z1 - z0) * (r + 0.5) / rows
            lo, hi = (x - depth, x + 0.02) if x < 0 else (x - 0.02, x + depth)
            b.box(m, lo, hi, cy - w / 2, cy + w / 2, cz - h / 2, cz + h / 2)


CAR_COLORS = ["#E5E7EB", "#475569", "#93C5FD", "#F1F5F9", "#1E293B", "#A7F3D0", "#FDE68A", "#CBD5E1"]


def car(b, cx, cy, heading=0.0, color="#E5E7EB", z=0.0):
    """Small parked car; heading 0 = facing +X."""
    body = mat(f"Car{color}", color, 0.35, 0.25)
    rot = Matrix.Rotation(heading, 4, "Z")

    def at(lx, ly, lz):
        v = rot @ Vector((lx, ly, lz))
        return cx + v.x, cy + v.y, z + v.z

    for (lx, ly, lz, sx, sy, sz, m) in (
        (0.0, 0.0, 0.32, 1.9, 0.86, 0.4, body),
        (-0.08, 0.0, 0.68, 1.05, 0.78, 0.36, body),
        (-0.08, 0.0, 0.69, 1.07, 0.8, 0.24, GLASS_DARK()),
    ):
        x, y, zz = at(lx, ly, lz)
        obox(b, m, x, y, zz, sx, sy, sz, rz=heading)
    for wx in (-0.6, 0.6):
        for wy in (-0.42, 0.42):
            x, y, zz = at(wx, wy, 0.17)
            obox(b, DARK(), x, y, zz, 0.36, 0.12, 0.34, rz=heading)


def parking(b, x0, x1, y, n, heading, seed=0, z=0.3):
    """A row of parking bays with a few cars."""
    paint = mat("Paint", "#FFFFFF", 0.6)
    for i in range(n + 1):
        x = x0 + (x1 - x0) * i / n
        b.box(paint, x - 0.04, x + 0.04, y - 1.1, y + 1.1, z, z + 0.012)
    for i in range(n):
        if (i * 7 + seed) % 5 == 3:
            continue
        cx = x0 + (x1 - x0) * (i + 0.5) / n
        car(b, cx, y, heading, CAR_COLORS[(i * 3 + seed) % len(CAR_COLORS)], z=z)


def bush(b, x, y, r=0.45, color="#93C58B", z=0.0):
    b.sphere(mat(f"Bush{color}", color, 0.9), x, y, z + r * 0.75, r, sub=1, squash=0.85)


def rooftop_unit(b, x, y, z, w=1.2, d=0.9, h=0.6):
    b.box(mat("Hvac", "#C8D0DA", 0.5, 0.2), x - w / 2, x + w / 2, y - d / 2, y + d / 2, z, z + h)
    b.cylinder(DARK(), x, y, z + h, z + h + 0.05, min(w, d) * 0.32, seg=12)


# --------------------------------------------------------------------------- #
# Hubs - three distinct warehouses (all keep the tintable "Brand" sign band)
# --------------------------------------------------------------------------- #

def build_hub_central():
    """Big cross-dock: ribbed blue-grey panels, solar roof, glass office tower."""
    b = Builder("hub_central")
    wall = mat("HubCWall", "#E7EEF7", 0.8)
    rib = mat("HubCRib", "#CFD9E6", 0.7)
    solar = mat("Solar", "#2A4778", 0.25, 0.35)
    frame = mat("SolarFrame", "#E2E8F0", 0.5, 0.3)
    b.box(CONCRETE(), -7.6, 10.4, -5.6, 5.2, 0.0, 0.3)
    b.box(wall, -7.0, 7.0, -4.5, 4.5, 0.3, 4.6)
    for i in range(14):
        x = -6.5 + i
        b.box(rib, x - 0.06, x + 0.06, 4.5, 4.56, 0.3, 4.6)
        b.box(rib, x - 0.06, x + 0.06, -4.56, -4.5, 3.05, 4.6)
    for i in range(9):
        y = -4.0 + i
        b.box(rib, -7.06, -7.0, y - 0.06, y + 0.06, 0.3, 4.6)
    b.box(ROOF(), -7.12, 7.12, -4.62, 4.62, 4.6, 4.95)
    b.box(mat("RoofFlat", "#DDE3EB", 0.9), -6.9, 6.9, -4.4, 4.4, 4.6, 4.78)
    for r in range(3):
        for c in range(5):
            x = -5.4 + c * 2.3
            y = -2.8 + r * 2.4
            obox(b, solar, x, y, 5.15, 1.9, 1.15, 0.06, rx=0.32)
            obox(b, frame, x, y + 0.35, 4.95, 1.7, 0.08, 0.32)
    rooftop_unit(b, 5.6, 3.2, 4.78)
    rooftop_unit(b, 5.6, -3.0, 4.78)
    for x in (-5.75, -3.45, -1.15, 1.15, 3.45, 5.75):
        b.box(DOOR(), x - 0.8, x + 0.8, -4.6, -4.48, 0.3, 2.6)
        b.box(mat("Bumper", "#F3C969", 0.6), x - 0.8, x + 0.8, -4.8, -4.48, 0.3, 0.42)
    b.box(mat("Canopy", "#F8FAFC", 0.6), -7.0, 7.0, -5.6, -4.5, 2.78, 2.98)
    b.box(DARK(), -7.0, 7.0, -5.62, -5.56, 2.78, 2.98)
    b.box(BRAND(), -3.2, 3.2, -4.62, -4.5, 3.3, 4.15)
    for x in (-2.2, -0.7, 0.8, 2.2):
        b.box(WHITE(), x - 0.45, x + 0.45, -4.66, -4.6, 3.55, 3.9)
    # three-storey glass office at +X
    off = mat("OfficeWall", "#F8FAFC", 0.7)
    b.box(off, 7.0, 10.0, -3.9, 2.2, 0.3, 6.3)
    blue = mat("GlassBlue", "#7EA6D6", 0.1, 0.25)
    b.box(blue, 7.2, 9.8, -3.97, -3.89, 0.7, 6.0)
    b.box(blue, 9.99, 10.06, -3.6, 1.9, 0.7, 6.0)
    for i in range(5):
        x = 7.2 + i * 0.65
        b.box(off, x - 0.04, x + 0.04, -4.0, -3.95, 0.7, 6.0)
    for z in (2.1, 3.5, 4.9):
        b.box(off, 7.2, 9.8, -4.0, -3.95, z - 0.06, z + 0.06)
        b.box(off, 10.04, 10.09, -3.6, 1.9, z - 0.06, z + 0.06)
    b.box(ROOF_LIGHT(), 6.9, 10.1, -4.0, 2.3, 6.3, 6.55)
    b.beam(DARK(), (9.2, 1.4, 6.55), (9.2, 1.4, 8.4), w=0.08)
    return b.finish()


def build_hub_north():
    """Cold-chain store: white insulated panels, barrel roof, teal stripe, refrigeration units."""
    b = Builder("hub_north")
    wall = mat("ColdWall", "#F7FAFC", 0.75)
    line = mat("PanelLine", "#DCE3EB", 0.8)
    teal = mat("Teal", "#14B8A6", 0.5)
    b.box(CONCRETE(), -9.6, 10.2, -5.6, 5.2, 0.0, 0.3)
    b.box(wall, -7.0, 7.0, -4.5, 4.5, 0.3, 3.9)
    for z in (1.4, 2.5):
        b.box(line, -7.02, 7.02, -4.53, 4.53, z - 0.04, z + 0.04)
    b.box(teal, -7.03, 7.03, -4.54, 4.54, 3.3, 3.62)
    barrel(b, mat("RoofSilver", "#D5DDE7", 0.4, 0.35), -7.2, 7.2, 4.75, 3.85, 1.7)
    for x in (-4.5, -1.5, 1.5, 4.5):
        b.box(mat("Seal", "#334155", 0.8), x - 1.05, x + 1.05, -4.82, -4.5, 0.3, 2.95)
        b.box(mat("DoorLight", "#E2E8F0", 0.6), x - 0.85, x + 0.85, -4.88, -4.8, 0.35, 2.65)
        b.box(mat("Bumper", "#F3C969", 0.6), x - 0.85, x + 0.85, -5.0, -4.82, 0.3, 0.42)
    b.box(BRAND(), -2.4, 2.4, -4.6, -4.5, 3.0, 3.25)
    # snowflake sign
    b.box(teal, 5.4, 6.8, -4.6, -4.52, 1.5, 2.9)
    for ang in (0, math.pi / 3, -math.pi / 3):
        obox(b, WHITE(), 6.1, -4.63, 2.2, 1.0, 0.03, 0.12, ry=ang)
    # refrigeration plant on the +X side
    for i, y in enumerate((-3.2, -1.2, 0.8)):
        b.box(mat("Condenser", "#CBD5E1", 0.45, 0.3), 7.3, 9.1, y - 0.8, y + 0.8, 0.3, 1.5)
        b.cylinder(DARK(), 8.2, y, 1.5, 1.56, 0.55, seg=16)
        b.cylinder(METAL(), 8.2, y, 1.56, 1.6, 0.12, seg=8)
        b.beam(METAL(), (7.3, y, 1.0), (7.0, y, 1.0), w=0.16)
    b.beam(METAL(), (7.05, -3.6, 1.0), (7.05, 1.2, 1.0), w=0.12)
    # small office on the -X side
    b.box(mat("GlassTeal", "#9FD3D3", 0.1, 0.2), -9.2, -7.0, -3.6, 0.2, 0.3, 2.9)
    b.box(WHITE(), -9.35, -6.9, -3.75, 0.35, 2.9, 3.15)
    return b.finish()


def build_hub_south():
    """Regional distribution centre: twin sage roofs, slate base band, guard house."""
    b = Builder("hub_south")
    wall = mat("SouthWall", "#F2F4F1", 0.8)
    band = mat("SlateBand", "#6B7A8F", 0.7)
    sage = mat("RoofSage", "#A7C6B3", 0.75)
    b.box(CONCRETE(), -10.0, 9.6, -6.8, 5.2, 0.0, 0.3)
    b.box(wall, -7.0, 7.0, -4.5, 4.5, 0.3, 4.0)
    b.box(band, -7.03, 7.03, -4.53, 4.53, 0.3, 1.0)
    b.gable(sage, -7.25, 7.25, 2.45, 3.9, 1.15, yc=-2.25)
    b.gable(sage, -7.25, 7.25, 2.45, 3.9, 1.15, yc=2.25)
    window_grid_x(b, GLASS(), 7.0, -3.8, 3.8, 2.4, 3.4, 5, 1, 0.9, 0.55)
    window_grid_x(b, GLASS(), -7.0, -3.8, 3.8, 2.4, 3.4, 5, 1, 0.9, 0.55)
    for x in (-5.4, -2.7, 0.0, 2.7, 5.4):
        b.box(DOOR(), x - 0.85, x + 0.85, -4.6, -4.48, 0.3, 2.55)
        b.box(mat("Bumper", "#F3C969", 0.6), x - 0.85, x + 0.85, -4.8, -4.48, 0.3, 0.42)
    b.box(sage, -6.8, 6.8, -5.5, -4.5, 2.75, 2.95)
    b.box(BRAND(), -3.0, 3.0, -4.62, -4.5, 3.1, 3.7)
    # guard house + barrier arm at the gate
    b.box(WHITE(), -9.6, -8.2, -6.6, -5.2, 0.3, 2.4)
    b.box(GLASS(), -9.66, -8.14, -6.66, -5.14, 1.3, 2.0)
    b.box(band, -9.75, -8.05, -6.75, -5.05, 2.4, 2.6)
    b.box(mat("ArmYellow", "#FACC15", 0.5), -8.1, -6.9, -6.2, -6.05, 1.0, 1.12)
    # side office
    b.box(WHITE(), 7.0, 9.4, -3.0, 2.0, 0.3, 3.0)
    window_grid_y(b, GLASS(), -3.0, 7.2, 9.2, 1.0, 2.6, 3, 2, 0.5, 0.55)
    b.box(sage, 6.9, 9.5, -3.1, 2.1, 3.0, 3.2)
    return b.finish()


# --------------------------------------------------------------------------- #
# Hospitals - a modern tower and a warm low-rise campus
# --------------------------------------------------------------------------- #

def build_hospital_tower():
    """St. Clara: podium + five-storey glass-grid tower, helipad, ambulance bay."""
    b = Builder("hospital_tower")
    white = mat("HospWhite", "#FAFBFC", 0.75)
    glass = mat("GlassSky", "#86AEDB", 0.12, 0.2)
    sign = mat("SignBlue", "#2563EB", 0.5)
    b.box(CONCRETE(), -6.0, 6.0, -6.4, 4.6, 0.0, 0.3)
    b.box(white, -5.6, 5.6, -4.2, 4.2, 0.3, 2.7)
    b.box(glass, -5.0, 5.0, -4.27, -4.19, 0.5, 1.9)
    window_grid_x(b, glass, 5.6, -3.6, 3.6, 0.6, 2.4, 6, 2, 0.8, 0.6)
    window_grid_x(b, glass, -5.6, -3.6, 3.6, 0.6, 2.4, 6, 2, 0.8, 0.6)
    b.box(ROOF_LIGHT(), -5.7, 5.7, -4.3, 4.3, 2.7, 2.9)
    b.box(white, -3.6, 3.6, -3.0, 3.0, 2.9, 10.3)
    window_grid_y(b, glass, -3.0, -3.3, 3.3, 3.2, 9.9, 6, 5, 0.75, 0.8)
    window_grid_y(b, glass, 3.0, -3.3, 3.3, 3.2, 9.9, 6, 5, 0.75, 0.8)
    window_grid_x(b, glass, 3.6, -2.7, 2.7, 3.2, 9.9, 5, 5, 0.75, 0.8)
    window_grid_x(b, glass, -3.6, -2.7, 2.7, 3.2, 9.9, 5, 5, 0.75, 0.8)
    b.box(ROOF_LIGHT(), -3.7, 3.7, -3.1, 3.1, 10.3, 10.6)
    b.cylinder(DARK(), 0.0, 0.3, 10.6, 10.72, 2.4, seg=28)
    b.cylinder(mat("PadRing", "#FACC15", 0.5), 0.0, 0.3, 10.72, 10.74, 2.2, seg=28)
    b.cylinder(DARK(), 0.0, 0.3, 10.74, 10.76, 2.0, seg=28)
    for x0, x1, y0, y1 in ((-0.65, -0.4, -0.5, 1.1), (0.4, 0.65, -0.5, 1.1), (-0.4, 0.4, 0.17, 0.43)):
        b.box(WHITE(), x0, x1, y0, y1, 10.76, 10.8)
    # blue H sign high on the tower front
    b.box(sign, -1.0, 1.0, -3.12, -3.0, 8.0, 9.6)
    for x0, x1, z0, z1 in ((-0.6, -0.38, 8.3, 9.3), (0.38, 0.6, 8.3, 9.3), (-0.38, 0.38, 8.68, 8.92)):
        b.box(WHITE(), x0, x1, -3.16, -3.1, z0, z1)
    # entrance canopy on columns
    b.box(sign, -2.6, 2.6, -5.8, -4.2, 2.1, 2.3)
    for x in (-2.3, 2.3):
        b.cylinder(WHITE(), x, -5.5, 0.3, 2.1, 0.1, seg=10)
    rooftop_unit(b, -4.4, 2.8, 2.9)
    rooftop_unit(b, 4.4, 2.8, 2.9)
    # ambulance
    amb = mat("Ambulance", "#FFFFFF", 0.35, 0.1)
    b.box(amb, -5.7, -3.8, -6.1, -5.2, 0.45, 1.45, bevel=0.06)
    b.box(sign, -5.71, -3.79, -6.11, -5.19, 0.8, 0.95)
    b.box(GLASS_DARK(), -3.85, -3.78, -6.0, -5.3, 1.0, 1.35)
    b.box(mat("Beacon", "#60A5FA", 0.3, 0.0, emit=1.5), -4.6, -4.2, -5.8, -5.5, 1.45, 1.6)
    for x in (-5.3, -4.2):
        for y in (-6.1, -5.2):
            b.cylinder(DARK(), x, 0.48, y - 0.06, y + 0.06, 0.18, seg=10, axis="Y")
    return b.finish()


def build_hospital_campus():
    """Riverside: two warm sandstone wings, glass sky-bridge, green roofs, parking."""
    b = Builder("hospital_campus")
    sand = mat("Sandstone", "#EFE2CF", 0.85)
    sand2 = mat("Sandstone2", "#E6D3B8", 0.85)
    glass = mat("GlassWarm", "#9FC1DE", 0.12, 0.2)
    green = mat("GreenRoof", "#A9D4A2", 0.95)
    teal = mat("SignTeal", "#0D9488", 0.5)
    b.box(CONCRETE(), -6.0, 6.0, -6.4, 4.6, 0.0, 0.3)
    b.box(sand, -5.8, -0.6, -3.6, 3.8, 0.3, 5.2)
    for z in (1.0, 2.4, 3.8):
        b.box(glass, -5.86, -0.54, -3.66, 3.86, z, z + 0.75)
    b.box(sand, -5.9, -0.5, -3.7, 3.9, 5.2, 5.45)
    b.box(green, -5.6, -0.8, -3.4, 3.6, 5.45, 5.55)
    for x, y in ((-4.6, 2.2), (-2.0, -2.0), (-3.4, 0.4)):
        bush(b, x, y, 0.4, "#7FBF7A", z=5.55)
    b.box(sand2, 0.6, 5.8, -0.8, 4.2, 0.3, 3.9)
    for z in (0.9, 2.3):
        b.box(glass, 0.54, 5.86, -0.86, 4.26, z, z + 0.7)
    b.box(sand2, 0.5, 5.9, -0.9, 4.3, 3.9, 4.1)
    b.box(green, 0.8, 5.6, -0.6, 4.0, 4.1, 4.2)
    bush(b, 3.2, 1.6, 0.4, "#7FBF7A", z=4.2)
    b.box(glass, -0.6, 0.6, 0.6, 2.2, 2.4, 3.6)
    b.box(WHITE(), -0.62, 0.62, 0.55, 2.25, 3.6, 3.72)
    # entrance pavilion + canopy
    b.box(glass, -4.2, -1.4, -5.0, -3.6, 0.3, 2.3)
    b.box(WHITE(), -4.5, -1.1, -5.6, -3.6, 2.3, 2.5)
    for x in (-4.3, -1.3):
        b.cylinder(WHITE(), x, -5.4, 0.3, 2.3, 0.09, seg=10)
    # teal plus sign on the main wing
    b.box(teal, -4.0, -2.4, -3.72, -3.6, 4.0, 5.0)
    b.box(WHITE(), -3.3, -3.1, -3.76, -3.7, 4.15, 4.85)
    b.box(WHITE(), -3.55, -2.85, -3.76, -3.7, 4.4, 4.6)
    parking(b, 0.8, 5.8, -3.4, 5, math.pi / 2, seed=2)
    b.box(mat("Asphalt", "#C3CAD4", 0.95), 0.6, 6.0, -4.7, -2.1, 0.3, 0.31)
    return b.finish()


# --------------------------------------------------------------------------- #
# Smaller customers
# --------------------------------------------------------------------------- #

def build_clinic():
    """Modern clinic: glass ground floor, timber-clad cantilevered upper floor, teal sign."""
    b = Builder("clinic")
    timber = mat("Timber", "#C79C6B", 0.8)
    slat = mat("TimberDark", "#A77E52", 0.8)
    teal = mat("SignTeal", "#0D9488", 0.5)
    b.box(CONCRETE(), -4.2, 4.2, -4.2, 3.4, 0.0, 0.25)
    b.box(GLASS(), -3.0, 3.0, -2.4, 2.4, 0.25, 2.1)
    for x in (-3.0, -1.0, 1.0, 3.0):
        b.box(WHITE(), x - 0.07, x + 0.07, -2.46, -2.36, 0.25, 2.1)
    b.box(timber, -3.4, 3.4, -2.9, 2.5, 2.1, 4.1)
    for z in (2.5, 2.9, 3.3, 3.7):
        b.box(slat, -3.42, 3.42, -2.93, 2.53, z - 0.03, z + 0.03)
    window_grid_y(b, GLASS_DARK(), -2.9, -2.8, 2.8, 2.5, 3.7, 3, 1, 1.2, 0.8)
    b.box(WHITE(), -3.5, 3.5, -3.0, 2.6, 4.1, 4.3)
    b.box(teal, -1.4, 1.4, -3.5, -2.4, 2.0, 2.15)
    b.box(teal, 2.0, 3.0, -2.98, -2.9, 2.9, 3.9)
    b.box(WHITE(), 2.42, 2.58, -3.02, -2.98, 3.05, 3.75)
    b.box(WHITE(), 2.15, 2.85, -3.02, -2.98, 3.32, 3.48)
    bush(b, -3.4, -3.4, 0.45)
    bush(b, 3.5, -3.4, 0.45)
    b.box(mat("Bench", "#8B6B4E", 0.8), -2.6, -1.6, -3.7, -3.4, 0.25, 0.65)
    return b.finish()


def build_pharmacy():
    """Corner pharmacy: mint facade, green/white striped awning, big lit cross."""
    b = Builder("pharmacy")
    mint = mat("Mint", "#DDF2E6", 0.8)
    green = mat("Awning", "#16A34A", 0.55)
    b.box(CONCRETE(), -3.6, 3.6, -3.6, 3.0, 0.0, 0.25)
    b.box(mint, -2.6, 2.6, -2.2, 2.2, 0.25, 3.3)
    b.box(GLASS(), -2.2, 2.2, -2.27, -2.19, 0.4, 2.0)
    b.box(WHITE(), -0.08, 0.08, -2.3, -2.2, 0.4, 2.0)
    for i in range(8):
        x0 = -2.5 + i * 0.625
        obox(b, green if i % 2 == 0 else WHITE(), x0 + 0.3125, -2.6, 2.3, 0.625, 0.9, 0.06, rx=-0.45)
    b.box(WHITE(), -2.0, 2.0, -2.26, -2.2, 2.55, 3.05)
    b.box(green, -0.18, 0.18, -2.3, -2.25, 2.6, 3.0)
    b.box(green, -0.38, 0.38, -2.3, -2.25, 2.72, 2.88)
    b.box(ROOF_LIGHT(), -2.7, 2.7, -2.3, 2.3, 3.3, 3.5)
    b.cylinder(METAL(), 2.9, -2.9, 0.25, 3.6, 0.07, seg=8)
    lit = mat("CrossLit", "#22C55E", 0.4, 0.0, emit=0.6)
    b.box(lit, 2.6, 3.2, -2.98, -2.82, 3.25, 4.25)
    b.box(lit, 2.4, 3.4, -2.98, -2.82, 3.45, 4.05)
    for x in (-2.0, 2.0):
        b.box(mat("Planter", "#94A3B8", 0.8), x - 0.4, x + 0.4, -2.9, -2.4, 0.25, 0.6)
        bush(b, x, -2.65, 0.32, "#86C27E", z=0.45)
    return b.finish()


def build_carehome():
    """Cosy care home: cream walls, clay roof with dormers and chimney, porch, garden fence."""
    b = Builder("carehome")
    cream = mat("Cream", "#FBF4EC", 0.85)
    clay = mat("RoofClay", "#D49A86", 0.8)
    shutter = mat("Shutter", "#9DB8A0", 0.8)
    b.box(mat("Lawn", "#CFE6C6", 1.0), -4.6, 4.6, -4.0, 3.4, 0.0, 0.2)
    b.box(cream, -3.8, 3.8, -2.6, 2.6, 0.2, 3.4)
    b.gable(clay, -4.1, 4.1, 3.0, 3.3, 1.8)
    for x in (-2.2, 2.2):
        b.box(cream, x - 0.55, x + 0.55, -2.4, -1.4, 3.4, 4.3)
        b.gable(clay, x - 0.7, x + 0.7, 0.62, 4.25, 0.45, yc=-1.9)
        b.box(GLASS(), x - 0.32, x + 0.32, -2.46, -2.38, 3.55, 4.1)
    b.box(mat("Brick", "#B9776A", 0.9), 2.6, 3.2, 0.6, 1.2, 3.6, 5.4)
    for x in (-2.9, -1.6, 1.6, 2.9):
        b.box(GLASS(), x - 0.38, x + 0.38, -2.66, -2.58, 1.3, 2.35)
        b.box(shutter, x - 0.6, x - 0.4, -2.68, -2.6, 1.3, 2.35)
        b.box(shutter, x + 0.4, x + 0.6, -2.68, -2.6, 1.3, 2.35)
    b.box(mat("Wood", "#9B7B62", 0.8), -0.5, 0.5, -2.66, -2.58, 0.2, 2.0)
    b.box(clay, -1.4, 1.4, -3.5, -2.6, 2.2, 2.38)
    for x in (-1.2, 1.2):
        b.cylinder(WHITE(), x, -3.35, 0.2, 2.2, 0.08, seg=8)
    picket = mat("Picket", "#FFFFFF", 0.7)
    for x0, x1 in ((-4.4, -1.0), (1.0, 4.4)):
        b.box(picket, x0, x1, -3.84, -3.78, 0.45, 0.52)
        n = int((x1 - x0) / 0.35)
        for i in range(n + 1):
            x = x0 + i * (x1 - x0) / n
            b.box(picket, x - 0.04, x + 0.04, -3.85, -3.77, 0.2, 0.75)
    for x, y, c in ((-3.2, -3.2, "#F9A8D4"), (-2.4, -3.3, "#FDE68A"), (2.6, -3.25, "#F9A8D4"), (3.4, -3.2, "#C4B5FD")):
        bush(b, x, y, 0.3, c, z=0.2)
    bush(b, -4.0, 2.6, 0.6, "#86C27E", z=0.2)
    b.box(mat("Bench", "#8B6B4E", 0.8), 1.6, 2.6, -3.3, -3.0, 0.2, 0.6)
    return b.finish()


# --------------------------------------------------------------------------- #
# Factory + port landmarks
# --------------------------------------------------------------------------- #

def build_factory():
    """Ridgeway Labs: saw-tooth hall, lab wing, tanks with pipes, chimney, loading canopy."""
    b = Builder("factory")
    accent = mat("Violet", "#7C3AED", 0.5)
    sand = WALL_SAND()
    b.box(CONCRETE(), -7.6, 8.4, -5.6, 5.0, 0.0, 0.3)
    b.box(sand, -6.0, 4.0, -4.0, 4.0, 0.3, 4.0)
    glass = GLASS()
    roof = ROOF_SAND()
    for i in range(4):
        x0 = -6.0 + 2.5 * i
        x1 = x0 + 2.5
        bt = bmesh.new()
        pts = [(x0, 4.0), (x1, 4.0), (x1, 5.4)]
        a = [bt.verts.new((x, -4.0, z)) for x, z in pts]
        c = [bt.verts.new((x, 4.0, z)) for x, z in pts]
        caps = [bt.faces.new((a[0], a[1], a[2])), bt.faces.new((c[2], c[1], c[0]))]
        bottom = bt.faces.new((a[0], c[0], c[1], a[1]))
        vertical = bt.faces.new((a[1], c[1], c[2], a[2]))
        slope = bt.faces.new((a[2], c[2], c[0], a[0]))
        bmesh.ops.recalc_face_normals(bt, faces=bt.faces)
        gi, ri, wi = b._mi(glass), b._mi(roof), b._mi(sand)
        for f in caps + [bottom]:
            f.material_index = wi
        vertical.material_index = gi
        slope.material_index = ri
        me = bpy.data.meshes.new("_tmp")
        bt.to_mesh(me)
        bt.free()
        b.bm.from_mesh(me)
        bpy.data.meshes.remove(me)
    # lab wing with violet glass
    b.box(WHITE(), -7.4, -6.0, -3.5, 3.5, 0.3, 3.2)
    b.box(mat("GlassViolet", "#B7A6F0", 0.1, 0.2), -7.46, -7.38, -3.0, 3.0, 1.0, 2.7)
    # office front + sign with lettering
    b.box(sand, -6.0, -1.0, -4.7, -4.0, 0.3, 2.8)
    b.box(glass, -5.6, -1.4, -4.76, -4.68, 1.3, 2.3)
    b.box(accent, -5.6, -1.4, -4.06, -4.0, 3.05, 3.65)
    for x in (-5.0, -4.2, -3.4, -2.6, -1.9):
        b.box(WHITE(), x - 0.28, x + 0.28, -4.09, -4.05, 3.2, 3.5)
    # loading door + canopy
    b.box(DOOR(), 0.5, 3.0, -4.08, -4.0, 0.3, 2.9)
    b.box(mat("Canopy", "#F8FAFC", 0.6), 0.2, 3.3, -5.2, -4.0, 3.0, 3.15)
    # chimney
    b.cylinder(mat("Chimney", "#ECE7DE", 0.8), 5.6, 2.6, 0.3, 9.2, 0.55, 0.45, seg=14)
    b.cylinder(accent, 5.6, 2.6, 7.4, 7.8, 0.53, seg=14)
    b.cylinder(accent, 5.6, 2.6, 8.3, 8.7, 0.5, seg=14)
    # tanks + pipes into the hall
    for y in (-2.4, 0.2):
        b.cylinder(METAL(), 6.0, y, 0.3, 3.4, 1.05, seg=18)
        b.cylinder(METAL(), 6.0, y, 3.4, 3.9, 1.05, 0.35, seg=18)
        b.cylinder(DARK(), y, 2.3, 4.0, 5.0, 0.12, seg=8, axis="X")
        b.cylinder(DARK(), y + 0.3, 2.9, 4.0, 5.0, 0.09, seg=8, axis="X")
    for x in (-3.5, 1.5):
        b.cylinder(METAL(), x, 2.0, 5.0, 5.7, 0.22, seg=10)
    return b.finish()


def build_port_tower():
    """Port control tower on a two-storey terminal building."""
    b = Builder("port_tower")
    port = mat("PortBlue", "#0E7490", 0.5)
    b.box(CONCRETE(), -3.4, 3.4, -2.4, 2.4, 0.0, 0.2)
    b.box(WHITE(), -3.0, 3.0, -2.0, 2.0, 0.2, 3.4)
    b.box(GLASS(), -3.06, 3.06, -2.06, 2.06, 0.9, 1.5)
    b.box(GLASS(), -3.06, 3.06, -2.06, 2.06, 2.2, 2.8)
    b.box(port, -3.1, 3.1, -2.1, 2.1, 3.4, 3.65)
    b.cylinder(WHITE(), 1.6, 0.0, 3.65, 9.2, 0.75, 0.65, seg=16)
    b.cylinder(port, 1.6, 0.0, 9.2, 9.5, 1.25, seg=8)
    b.cylinder(mat("GlassCab", "#2F4E6E", 0.1, 0.3), 1.6, 0.0, 9.5, 10.6, 1.35, 1.5, seg=8)
    b.cylinder(WHITE(), 1.6, 0.0, 10.6, 10.9, 1.65, seg=8)
    b.beam(DARK(), (1.6, 0.0, 10.9), (1.6, 0.0, 12.4), w=0.07)
    b.sphere(mat("Radar", "#FFFFFF", 0.5), 1.6, 0.0, 12.5, 0.25, sub=1)
    return b.finish()


def build_lighthouse():
    """Harbour lighthouse with navy bands and a glowing lantern."""
    b = Builder("lighthouse")
    navy = mat("Navy", "#1E3A5F", 0.5)
    b.cylinder(CONCRETE(), 0.0, 0.0, 0.0, 0.6, 1.6, 1.8, seg=16)
    b.cylinder(WHITE(), 0.0, 0.0, 0.6, 7.4, 0.9, 0.62, seg=16)
    b.cylinder(navy, 0.0, 0.0, 2.6, 3.4, 0.83, 0.79, seg=16)
    b.cylinder(navy, 0.0, 0.0, 4.9, 5.7, 0.74, 0.7, seg=16)
    b.box(navy, -0.25, 0.25, -0.86, -0.78, 0.6, 1.8)
    b.cylinder(DARK(), 0.0, 0.0, 7.4, 7.6, 1.0, seg=16)
    b.cylinder(mat("Lantern", "#FDE68A", 0.2, 0.0, emit=2.0), 0.0, 0.0, 7.6, 8.6, 0.55, seg=12)
    b.cylinder(navy, 0.0, 0.0, 8.6, 9.3, 0.68, 0.0, seg=12)
    return b.finish()


def build_all():
    return [
        build_hub_central(), build_hub_north(), build_hub_south(),
        build_hospital_tower(), build_hospital_campus(),
        build_clinic(), build_pharmacy(), build_carehome(), build_factory(),
        build_port_tower(), build_lighthouse(),
    ]
