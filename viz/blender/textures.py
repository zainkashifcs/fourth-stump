"""Pixel art, painted with numpy: the kit atlas worn by the cricketers and the
stumps, and small repeating textures for the backdrops. Images are float arrays
of sRGB bytes, row 0 at the top. Shading is painted in, because the page lights
nothing.
"""
import numpy as np

from lib import Atlas, Tiled

RNG = np.random.default_rng(1877)  # fixed, so a rebuild paints the same pixels

CREAM, FLANNEL, NAVY, BURGUNDY = 0xF2EAD0, 0xFAF5E4, 0x1C2A55, 0x7C1F2E
CAP_GREEN, GOLD, SKIN, HAIR, WHITE = 0x1D4A32, 0xE8B93A, 0xD8A47E, 0x3A2A1E, 0xFFFFFF
WILLOW, GRIP, ASH, BAIL, BUFF, SOLE = 0xE6D29C, 0x8E1B2A, 0xE8D8A8, 0xCF9F52, 0xC9A66B, 0x3C3C40


def rgb(color):
    return np.array([(color >> 16) & 255, (color >> 8) & 255, color & 255], np.float32)


def fill(width, height, color, grain=3.0, top=1.03, bottom=0.84):
    """A flat colour with pixel grain, shaded darker towards the bottom."""
    image = np.empty((height, width, 3), np.float32)
    image[:] = rgb(color)
    image *= np.linspace(top, bottom, height)[:, None, None]
    return image + RNG.normal(0, grain, (height, width, 1))


def plain(color):
    return lambda panel, width, height: fill(width, height, color) if panel == "front" else None


# The kit ----------------------------------------------------------------------------

def knit(panel, width, height):
    """Cream cable-knit: ribs, with a twisted cable every eight pixels."""
    image = fill(width, height, CREAM)
    image[:, ::4] *= 0.94
    rows = np.arange(height)
    twist = np.rint(1.5 * np.sin(rows * np.pi / 4)).astype(int)
    for centre in range(5, width, 8):
        image[rows, centre + twist] *= 0.8
        image[rows, centre - twist] *= 0.8
        image[rows, np.clip(centre + twist + 1, 0, width - 1)] *= 1.05
    image[:, :2] *= 0.9
    image[:, -2:] *= 0.9
    return image


def flannel(panel, width, height):
    """White flannels with a pressed crease and a couple of folds."""
    if panel != "front":
        return None
    image = fill(width, height, FLANNEL)
    image[:, width // 2] *= 0.9
    image[:, width // 2 - 1] *= 1.03
    for start in (6, 19):
        for i in range(8):
            image[start + i // 2, 4 + i * 3:6 + i * 3] *= 0.9
    return image


def face(moustache=False, zinc=False):
    def paint(panel, width, height):
        image = fill(width, height, SKIN, top=1.02, bottom=0.9)
        hair = rgb(HAIR)
        if panel == "front":
            image[:5] = hair
            image[5, 2:-2:3] = hair  # a ragged fringe
            for x in (7, 19):
                image[10, x:x + 6] = hair  # brow
                image[12, x:x + 5] = rgb(0x2A1C14)  # upper lid
                image[13:15, x:x + 5] = rgb(0xF4F0E6)
                image[13:15, x + 2:x + 4] = rgb(0x22303A)  # pupil
            image[14:20, 16] *= 0.86  # nose shadow
            image[19, 14:18] *= 0.88
            image[18:20, 6:9] += (16, -4, -4)  # cheeks
            image[18:20, 23:26] += (16, -4, -4)
            image[24, 12:20] = rgb(0x8A4A40)  # mouth
            image[25, 13:19] *= 1.06
            image[28:, :] *= 0.92
            if moustache:
                image[21:23, 10:22] = hair
                image[23, 9:11] = hair
                image[23, 21:23] = hair
            if zinc:
                image[16:18, 12:21] = rgb(0xF6F6F0)  # a stripe of zinc cream across the nose
        elif panel == "side":
            image[:, 20:] = hair
            image[:8] = hair
            image[8:20, 15:20] = hair  # sideburn
            image[12:19, 10:14] *= 0.82  # ear
            image[13:18, 11:13] *= 1.18
        else:
            image[:] = hair
            image[::3, ::2] *= 1.25  # strands
            if panel == "back":
                image[26:] = fill(width, 6, SKIN, top=0.9, bottom=0.82)
        return image
    return paint


def cap(panel, width, height):
    """A baggy green cap: seams between the panels, a gold crest on the front."""
    image = fill(width, height, CAP_GREEN, grain=2.0)
    image[:, ::8] *= 1.3
    if panel == "front":
        image[12:19, 13:19] = rgb(GOLD)
        image[14:17, 15:17] = rgb(CAP_GREEN)
    if panel == "cap":
        image[14:18, 14:18] = rgb(GOLD)  # the button
    return image


def sunhat(panel, width, height):
    image = fill(width, height, WHITE, bottom=0.8)
    if panel == "cap":
        image[10:22, 10:22] *= 0.94
    else:
        image[-7:] = fill(width, 7, NAVY)  # the band
    return image


def pad(panel, width, height):
    """Batting pad: cane ribs down the front, buff straps round the back."""
    if panel == "front":
        image = fill(width, height, WHITE, bottom=0.82)
        image[:, 3::4] *= 0.82
        image[:, 4::4] *= 1.03
        image[::10] *= 0.9
        return image
    image = fill(width, height, FLANNEL if panel == "back" else WHITE, bottom=0.8)
    for row in (7, 19):
        image[row:row + 3] = fill(width, 3, BUFF)
    return image


def glove(panel, width, height):
    image = fill(width, height, WHITE, bottom=0.8)
    image[:6] = fill(width, 6, NAVY)  # wristband
    if panel in ("front", "back"):
        image[6:, 7::8] *= 0.7  # fingers
        image[14::7] *= 0.85  # padded segments
    return image


def boot(panel, width, height):
    image = fill(width, height, WHITE, bottom=0.88)
    if panel == "cap":
        image[4:28:4, 14:18] = rgb(0x8A8A90)  # laces
    else:
        image[-6:] = fill(width, 6, SOLE)
        image[10:20, 8:20:4] = rgb(NAVY)  # three stripes
    return image


def blade(panel, width, height):
    """Willow: grain down the face, a maker's label near the splice."""
    image = fill(width, height, WILLOW, top=1.04, bottom=0.9)
    image[:, RNG.choice(width, 7, replace=False)] *= 0.93
    if panel == "front":
        image[3:9, 9:23] = rgb(0xB8242E)
        image[5, 11:21] = rgb(0xF4F0E6)
        image[7, 13:19] = rgb(0xF4F0E6)
        image[:, :2] *= 0.88
        image[:, -2:] *= 0.88
    elif panel == "back":
        image[:, 13:19] *= 1.06  # the spine catches the light
        image[:, :6] *= 0.86
        image[:, -6:] *= 0.86
    else:
        image *= 0.88
    return image


def grip(panel, width, height):
    if panel != "front":
        return None
    image = fill(width, height, GRIP)
    image[::4] *= 0.7  # rubber grip rings
    return image


def grain(color):
    def paint(panel, width, height):
        if panel not in ("front", "cap"):
            return None
        image = fill(width, height, color, top=1.04, bottom=0.9)
        if panel == "cap":
            image[12:20, 12:20] *= 0.9  # end grain
        else:
            image[:, RNG.choice(width, 8, replace=False)] *= 0.9
        return image
    return paint


def kit_atlas():
    atlas = Atlas("kit")
    for tile, painter in (
        ("knit", knit), ("face_batter", face()), ("face_bowler", face(moustache=True)), ("face_slip", face(zinc=True)),
        ("cap", cap), ("sunhat", sunhat), ("pad", pad), ("glove", glove), ("boot", boot), ("blade", blade),
        ("flannel", flannel), ("skin", plain(SKIN)), ("hair", plain(HAIR)), ("navy", plain(NAVY)),
        ("burgundy", plain(BURGUNDY)), ("grip", grip), ("ash", grain(ASH)), ("bail", grain(BAIL)),
    ):
        atlas.add(tile, painter)
    return atlas


# Backdrops --------------------------------------------------------------------------

def _brick(image):
    image[3::4] *= 0.8  # mortar courses
    for row in range(0, image.shape[0], 4):
        image[row:row + 3, (row // 4 % 2) * 4::8] *= 0.85


def _courses(image):
    image[2::3] *= 0.8


def _rail(image):
    image[:2] *= 1.05
    image[4:, ::2] *= 0.72  # balusters


def _crowd(image):
    height, width = image.shape[:2]
    palette = [rgb(c) for c in (0xF4F0E6, 0xF4F0E6, 0xD43A2F, 0x2C5C8A, 0xF2C230, 0x3B2A26, 0xE9B48C)]
    for row in range(1, height - 1, 3):
        for column in range(row % 2, width, 2):
            if RNG.random() < 0.8:
                image[row, column] = palette[RNG.integers(len(palette))]
                image[row + 1, column] = rgb(0xE9B48C if RNG.random() < 0.5 else 0xF4F0E6)


def _window(image):
    image[:, image.shape[1] // 2] *= 2.4  # glazing bars
    image[image.shape[0] // 2] *= 2.4
    image[:2] *= 2.0


def _stripes(image):
    image[:, ::4] = rgb(0xF2C230)
    image[:, 1::4] = rgb(0xF2C230)


def _boards(image):
    image[3::4] *= 0.88


def _slots(image):
    """Dark marks standing for painted names and numbers."""
    height, width = image.shape[:2]
    for column in range(2, width - 3, 5):
        mark = RNG.random((height - 6, 3)) < 0.6
        image[3:height - 3, column:column + 3][mark] = rgb(0x16261F)


def _rock(image):
    height, width = image.shape[:2]
    image *= np.linspace(1.18, 0.86, height)[:, None, None]  # light on the rim
    image[RNG.choice(height, height // 5, replace=False)] *= 0.9  # strata
    for column in RNG.choice(width, width // 6, replace=False):
        start = RNG.integers(height // 2)
        image[start:start + RNG.integers(6, height // 2), column] *= 0.8  # gullies


def _leaves(image):
    image *= 0.85 + 0.3 * (RNG.random(image.shape[:2]) < 0.5)[..., None]


PATTERNS = {
    "plain": lambda image: None, "brick": _brick, "courses": _courses, "rail": _rail, "crowd": _crowd,
    "window": _window, "stripes": _stripes, "boards": _boards, "slots": _slots, "rock": _rock, "leaves": _leaves,
}
_tiled = {}


def tiled(pattern, color, density=4.0, size=32):
    """The repeating texture for `pattern` in `color`, at `density` pixels per metre."""
    key = (pattern, color, density, size)
    if key not in _tiled:
        image = fill(size, size, color, top=1.0, bottom=1.0)
        PATTERNS[pattern](image)
        _tiled[key] = Tiled(f"{pattern}_{color:06x}_{size}", image, density)
    return _tiled[key]
