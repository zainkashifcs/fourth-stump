"""The ground round the field: tiered stands on both sides and behind the
batter's end, a white boundary rope, and one set of perimeter boards per venue.
The sector behind the bowler's end is left open for the venue's backdrop
(backdrops.py), which the page stands 66 m behind the bowler's stumps.

Authored in the page's data axes, which are Blender's own: +x the off side of a
right-hander, +y up the pitch towards the bowler, +z up, origin at the base of
the batter's middle stump. Everything is laid out in rings round the middle of
the pitch; an angle is measured from straight up the pitch towards +x.
"""
from math import ceil, cos, radians, sin

import numpy as np
from mathutils import Matrix, Vector

from lib import Shape, Tiled
from textures import fill, rgb

PITCH_LENGTH = 20.12
MIDDLE = Vector((0, PITCH_LENGTH / 2, 0))
ROPE = 65.0  # boundary radius from the middle of the pitch
BOARDS = 67.0
BOARD_HEIGHT = 2.5  # taller than life: the 7-texel letters must cover 7 screen pixels in a side-on venue panel, about 97 m away
BOARD_COUNT = 34
OPEN = 19.0  # degrees either side of straight behind the bowler's end, kept clear for the backdrop
STEP = 8.0  # degrees per stand segment
SIDE_ON = 264.0  # where the side-on camera's line of sight meets the boards

RNG = np.random.default_rng(1884)  # fixed, so a rebuild paints the same crowd

# Stand profiles, as (radius, height) -> (radius, height) strips round the ring. Each
# strip faces the side its direction turns towards the field (bottom to top, or back to front).
GRANDSTAND = (
    ((72.0, 0.0), (72.0, 1.8), "front"),
    ((72.0, 1.8), (81.0, 6.3), "crowd_lower"),
    ((81.0, 6.3), (81.0, 7.8), "balcony"),
    ((81.0, 7.8), (90.0, 13.2), "crowd_upper"),
    ((90.0, 13.2), (90.0, 16.5), "boxes"),
    ((90.0, 16.5), (82.0, 18.2), "roof"),  # seen from underneath
    ((82.0, 17.3), (82.0, 18.2), "fascia"),
)
TERRACE = (
    ((72.0, 0.0), (72.0, 1.5), "front"),
    ((72.0, 1.5), (84.0, 7.5), "crowd_terrace"),
    ((84.0, 7.5), (84.0, 10.0), "back_wall"),
)
# (from, to) in degrees, and the profile: open terraces beside the backdrop, covered stands round the rest
BLOCKS = (
    (OPEN, 62.0, TERRACE),
    (62.0, 132.0, GRANDSTAND),
    (132.0, 228.0, GRANDSTAND),
    (228.0, 298.0, GRANDSTAND),
    (298.0, 360.0 - OPEN, TERRACE),
)

# The venue boards: background, lettering, frame.
TEST = ("TEST CRICKET", 0xF2EAD0, 0xB8242E, 0x1C2A55)
VENUES = {
    "lords": ("LORD'S", 0x1D4A32, 0xE8B93A, 0xF2EAD0),
    "perth": ("WACA", 0xF2C230, 0x16261F, 0x16261F),
    "newlands": ("NEWLANDS", 0x2C5C8A, 0xFAF5E4, 0xFAF5E4),
}


class Sheet(Tiled):
    """One texture stretched exactly once over each face, whatever its size."""

    def map(self, tile, panel, u, v, _size):
        height, width = self.pixels.shape[:2]
        return super().map(tile, panel, u, v, (width / self.density, height / self.density))


# Pixel art ----------------------------------------------------------------------------

SKIN = (0xE9B48C, 0xD8A47E, 0xB07A58, 0x8A5A3C)
HATS = (0xF4F0E6, 0xF4F0E6, 0xD9C27A, 0x3A2A1E, 0x5A4030, 0xC9A66B, 0x8A8A90, 0x1C2A55, 0xB8242E)
SHIRTS = (0xF4F0E6, 0xF4F0E6, 0xF4F0E6, 0x9CC4E4, 0xD43A2F, 0xF2C230, 0x2C5C8A, 0x3F8F47, 0xE58FA8, 0x1C2A55)


def crowd(seat, empty, width=60, rows=8):
    """Rows of spectators, six pixels a row, a figure every three pixels: hat or
    hair, face, shirt, then the seat and the concrete step below them."""
    image = fill(width, rows * 6, 0x9A968A, grain=2.0, top=1.0, bottom=1.0)
    for row in range(rows):
        y = row * 6
        image[y + 4] = rgb(seat) * 0.7
        image[y + 5] = rgb(0x6E6A60)  # the riser in shadow
        offset = row % 3
        for x in range(offset, width - 1, 3):
            if RNG.random() < empty:
                image[y + 2:y + 4, x:x + 2] = rgb(seat)  # an empty seat
                continue
            image[y, x:x + 2] = rgb(HATS[RNG.integers(len(HATS))])
            image[y + 1, x:x + 2] = rgb(SKIN[RNG.integers(len(SKIN))])
            shirt = rgb(SHIRTS[RNG.integers(len(SHIRTS))])
            image[y + 2:y + 4, x:x + 2] = shirt
            image[y + 3, x:x + 2] = shirt * 0.82
            image[y + 4, x + RNG.integers(2)] = rgb(0x3C3C40)  # legs
    return Tiled(f"crowd_{seat:06x}_{int(empty * 100)}", image, 6.0)


def boxes():
    """The back wall of a covered stand: a band of dark glazed boxes under a cream cornice."""
    image = fill(16, 12, 0xE9E4D6, grain=2.0)
    image[3:9, 1:15] = rgb(0x2B3440)
    image[3, 1:15] = rgb(0x4A5868)  # glare along the top of the glass
    image[3:9, 8] = rgb(0xE9E4D6)  # mullion
    image[10:] *= 0.8
    return Tiled("stand_boxes", image, 4.0)


def back_wall():
    """A terrace's back wall: red brick with a white coping."""
    image = fill(16, 12, 0xA94E34, grain=3.0)
    for row in range(2, 12, 3):
        image[row] *= 0.8
        image[row - 2:row, (row // 3 % 2) * 4::8] *= 0.85
    image[:2] = rgb(0xF4F0E6)
    return Tiled("stand_back_wall", image, 4.0)


def front_wall():
    image = fill(16, 8, 0x234A33, grain=2.0)
    image[0] = rgb(0xF4F0E6)
    image[:, ::8] *= 0.8
    return Tiled("stand_front", image, 4.0)


def balcony():
    image = fill(16, 6, 0xF4F0E6, grain=2.0)
    image[2:, ::2] *= 0.75  # railings
    image[-1] *= 0.8
    return Tiled("stand_balcony", image, 6.0)


def roof():
    image = fill(16, 16, 0x6A707A, grain=2.0, top=0.9, bottom=1.05)
    image[:, ::4] = rgb(0x3E434B)  # rafters
    return Tiled("stand_roof", image, 2.0)


def fascia():
    image = fill(16, 4, 0xF4F0E6, grain=1.5)
    image[2] = rgb(0x1D4A32)
    return Tiled("stand_fascia", image, 4.0)


def concrete():
    image = fill(16, 16, 0xB9B4A6, grain=3.0)
    image[::4] *= 0.85
    return Tiled("stand_concrete", image, 2.0)


def rope():
    image = fill(4, 4, 0xFFFFFF, grain=1.0, top=1.0, bottom=0.9)
    return Tiled("boundary_rope", image, 8.0)


GLYPHS = {
    "A": ("01110", "10001", "10001", "11111", "10001", "10001", "10001"),
    "C": ("01110", "10001", "10000", "10000", "10000", "10001", "01110"),
    "D": ("11110", "10001", "10001", "10001", "10001", "10001", "11110"),
    "E": ("11111", "10000", "10000", "11110", "10000", "10000", "11111"),
    "I": ("111", "010", "010", "010", "010", "010", "111"),
    "K": ("10001", "10010", "10100", "11000", "10100", "10010", "10001"),
    "L": ("10000", "10000", "10000", "10000", "10000", "10000", "11111"),
    "N": ("10001", "11001", "10101", "10011", "10001", "10001", "10001"),
    "O": ("01110", "10001", "10001", "10001", "10001", "10001", "01110"),
    "R": ("11110", "10001", "10001", "11110", "10100", "10010", "10001"),
    "S": ("01111", "10000", "10000", "01110", "00001", "00001", "11110"),
    "T": ("11111", "00100", "00100", "00100", "00100", "00100", "00100"),
    "W": ("10001", "10001", "10001", "10101", "10101", "10101", "01010"),
    "'": ("1", "1", "0", "0", "0", "0", "0"),
    " ": ("000",) * 7,
}


def lettering(text):
    """`text` in the 5x7 font, one pixel between letters, as a boolean mask."""
    columns = []
    for i, char in enumerate(text):
        if i:
            columns.append(np.zeros(7, bool))
        glyph = np.array([[c == "1" for c in row] for row in GLYPHS[char]])
        columns.extend(glyph.T)
    return np.array(columns).T


def board(text, background, letters, frame, width=76):
    """One perimeter board: centred lettering on a painted panel inside a frame."""
    image = fill(width, 11, background, grain=2.0, top=1.02, bottom=0.92)
    mask = lettering(text)
    left = (width - mask.shape[1]) // 2
    assert left >= 2, f"{text!r} does not fit on a board"
    image[2:9, left:left + mask.shape[1]][mask] = rgb(letters)
    image[[0, -1]] = rgb(frame)
    image[:, [0, -1]] = rgb(frame)
    return Sheet(f"board_{text.lower().replace(' ', '_').replace(chr(39), '')}", image, 1.0)


# Geometry -----------------------------------------------------------------------------

def face(shape, points, tile, across, rise):
    """A flat face through `points`, textured in its own plane: `across` and `rise`
    span the texture frame and set its size, and the face looks along across x rise."""
    across, rise = Vector(across), Vector(rise)
    rise = rise - rise.project(across)
    front = across.cross(rise)
    centre = sum((Vector(p) for p in points), Vector()) / len(points)
    back = -front.normalized()  # a face's front is its frame's -Y, as on the figures
    matrix = Matrix((
        (across.x, back.x, rise.x, centre.x),
        (across.y, back.y, rise.y, centre.y),
        (across.z, back.z, rise.z, centre.z),
        (0, 0, 0, 1),
    ))
    verts = [shape.bm.verts.new(p) for p in points]
    made = shape.bm.faces.new(verts)
    made.normal_update()
    if made.normal.dot(front) < 0:
        made.normal_flip()
    shape._texture({"verts": verts}, matrix, tile, (1, 1, 1))


def at(angle, radius, height):
    return MIDDLE + Vector((radius * sin(angle), radius * cos(angle), height))


def outward(angle):
    return Vector((sin(angle), cos(angle), 0))


def band(shape, a0, a1, profile, tiles):
    """One straight segment of a ring between angles a0 < a1 (radians), every strip of `profile`."""
    middle = (a0 + a1) / 2
    out, right = outward(middle), Vector((cos(middle), -sin(middle), 0))
    chord = 2 * sin((a1 - a0) / 2)
    for (r0, z0), (r1, z1), name in profile:
        points = [at(a0, r0, z0), at(a1, r0, z0), at(a1, r1, z1), at(a0, r1, z1)]
        rise = out * (r1 - r0) + Vector((0, 0, z1 - z0))
        face(shape, points, tiles[name], right * chord * (r0 + r1) / 2, rise)


def outline(profile):
    """The stand's cross-section: its strips up to the first break, closed down to the ground."""
    points = [profile[0][0]]
    for start, end, _ in profile:
        if start != points[-1]:
            break
        points.append(end)
    return points + [(points[-1][0], 0.0)]


def stand(shape, start, end, profile, tiles):
    count = ceil((end - start) / STEP)
    angles = [radians(start + (end - start) * i / count) for i in range(count + 1)]
    for a0, a1 in zip(angles, angles[1:]):
        band(shape, a0, a1, profile, tiles)
    section = outline(profile)
    for angle, facing in ((angles[0], -1), (angles[-1], 1)):  # end walls, facing away from the stand
        face(shape, [at(angle, r, z) for r, z in section], tiles["cap"], outward(angle) * facing, (0, 0, 1))


def build_stands():
    shape = Shape()
    tiles = {
        "front": front_wall(), "balcony": balcony(), "boxes": boxes(), "roof": roof(),
        "fascia": fascia(), "back_wall": back_wall(), "cap": concrete(),
        "crowd_lower": crowd(0x2F6B4A, 0.08), "crowd_upper": crowd(0x2F6B4A, 0.18),
        "crowd_terrace": crowd(0x2C5C8A, 0.12),
    }
    for start, end, profile in BLOCKS:
        stand(shape, start, end, profile, tiles)
    return shape.finish("stands")


def build_rope():
    shape = Shape()
    profile = (
        ((ROPE - 0.15, 0.01), (ROPE, 0.18), "rope"),
        ((ROPE, 0.18), (ROPE + 0.15, 0.01), "rope"),
    )
    tiles = {"rope": rope()}
    angles = [radians(7.5 * i) for i in range(49)]
    for a0, a1 in zip(angles, angles[1:]):
        band(shape, a0, a1, profile, tiles)
    return shape.finish("rope")


def build_boards(venue):
    """A ring of boards just outside the rope, the venue's name and TEST CRICKET in turn."""
    text, background, letters, frame = VENUES[venue]
    tiles = (board(text, background, letters, frame), board(*TEST))
    shape = Shape()
    step = radians(360 / BOARD_COUNT)
    for i in range(BOARD_COUNT):
        a0 = radians(SIDE_ON) + (i - 0.5) * step  # board 0 is centred where the side-on camera looks
        profile = (((BOARDS, 0.0), (BOARDS, BOARD_HEIGHT), "board"),)
        band(shape, a0, a0 + step, profile, {"board": tiles[i % 2]})
    return shape.finish(f"boards_{venue}")


def build_stadium():
    build_stands()
    build_rope()
    for venue in VENUES:
        build_boards(venue)
