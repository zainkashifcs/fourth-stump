"""Pixel art, painted with numpy: the kit atlas worn by the cricketers and the
stumps, and small repeating textures for the backdrops. Images are float arrays
of sRGB bytes, row 0 at the top. Shading is painted in, because the page lights
nothing.

The kit is painted the way a late-90s console texture was: flat colour blocks,
each moved one or two shade steps lighter or darker where the form turns, with
no per-pixel noise. Light comes from the front and the viewer's upper left.
"""
import numpy as np

from lib import Atlas, Tiled

RNG = np.random.default_rng(1877)  # fixed, so a rebuild paints the same pixels (backdrops only)

CREAM, FLANNEL, NAVY, CRIMSON, SHIRT = 0xF1E2BC, 0xF4F0E2, 0x1F2F66, 0xA81E34, 0xFBFAF2
CAP_GREEN, GOLD, HAT_WHITE, UNDER_BRIM = 0x1E4F35, 0xE8B634, 0xEEEADA, 0x2F6B3C
WILLOW, GRIP, ASH, BAIL = 0xEDD59C, 0xA01C2E, 0xE4D1A2, 0xD9A75A
PAD_WHITE, BUFF, SOLE, STEEL, LEATHER, SAUSAGE = 0xF1F1EB, 0xC99F64, 0x3A3A42, 0xB8BCC6, 0xF3F2EC, 0x3C8C58
PALM = 0xB5814E
LASH, EYE_WHITE, LIP = 0x2A1A14, 0xF6F2EA, 0x9A4A44
SKINS = {"fair": 0xEDB894, "tan": 0xD49B6C, "brown": 0x9A6342}
HAIRS = {"brown": 0x4C3322, "black": 0x24211F, "blond": 0xD3A85C, "auburn": 0x8C4624}
EYES = {"brown": 0x5C3A20, "blue": 0x3C6CAC, "green": 0x4C7C48}

WARM, COOL = np.array([255, 248, 228], np.float32), np.array([44, 30, 78], np.float32)


def rgb(color):
    return np.array([(color >> 16) & 255, (color >> 8) & 255, color & 255], np.float32)


def fill(width, height, color, grain=3.0, top=1.03, bottom=0.84):
    """A flat colour with pixel grain, shaded darker towards the bottom (backdrops)."""
    image = np.empty((height, width, 3), np.float32)
    image[:] = rgb(color)
    image *= np.linspace(top, bottom, height)[:, None, None]
    return image + RNG.normal(0, grain, (height, width, 1))


# Painting ---------------------------------------------------------------------------

def stepped(colors, step):
    """`colors` moved `step` shade steps: lighter towards a warm white, darker towards a cool purple."""
    if step >= 0:
        return colors + (WARM - colors) * 0.3 * step
    return colors * (1 + 0.17 * step) + COOL * (-0.07 * step)


def tone(color, step=0):
    return stepped(rgb(color), step)


def canvas(width, height, color, step=0):
    image = np.empty((height, width, 3), np.float32)
    image[:] = tone(color, step)
    return image


def shade(image, where, step):
    """Moves a region (a slice or a mask) `step` shade steps, keeping its pattern."""
    image[where] = stepped(image[where], step)


S = np.s_


def grid(image):
    height, width = image.shape[:2]
    return np.mgrid[0:height, 0:width]


def knit(image, period=10, offset=0):
    """Cable-knit: a purl groove every `period` columns and a twisted rope cable
    between, the twist turning the other way on alternate cables."""
    rows, cols = grid(image)
    c = cols + offset
    m = c % period
    cable = (m >= period // 2 - 1) & (m <= period // 2 + 1)
    twist = np.where((c // period) % 2 == 0, c - rows, c + rows) % 4
    shade(image, cable & (twist == 0), 1)
    shade(image, (cable & (twist == 2)) | (m == 0), -1)


def rib_band(image, row, colors):
    """A ribbed band of one row per entry in `colors` (None keeps the knit)."""
    for i, color in enumerate(colors):
        if color is not None:
            image[row + i] = tone(color)
        image[row + i, ::2] = stepped(image[row + i, ::2], -1)  # the ribs
    return image


SWEATER_BAND = [None, NAVY, NAVY, CRIMSON, CRIMSON, NAVY, None, None]
CUFF_BAND = [NAVY, CRIMSON, CRIMSON, NAVY, None, None]


def tile(**panels):
    """A painter from panel images (or (tile, panel) aliases); a missing panel reuses the front."""
    return lambda panel, _w, _h: panels.get(panel)


# The kit ----------------------------------------------------------------------------

def sweater():
    """The body of a cream cable-knit V-neck: navy and crimson V trim, a striped waist band
    (rows 48-55 match the hem of the torso), an open white shirt collar in the V."""
    front = canvas(40, 56, CREAM)
    knit(front, offset=5)
    rib_band(front, 48, SWEATER_BAND)
    shade(front, S[3:16, 3:12], 1)  # upper chest catching the light
    shade(front, S[24:26, 4:17], -1)  # under the chest
    shade(front, S[24:26, 23:36], -1)
    shade(front, S[:, 0:3], -1)
    shade(front, S[:, 36:40], -1)
    shade(front, S[:, 38:40], -1)
    shade(front, S[38:48, 0:6], -1)  # the waist tapers away
    shade(front, S[38:48, 34:40], -1)
    for r in range(25):
        left = int(round(5 + r * 14 / 22))
        right = 40 - left
        inner_l, inner_r = left + 4, right - 4
        front[r, max(left, 0):left + 2] = tone(NAVY)
        front[r, right - 2:right] = tone(NAVY)
        front[r, left + 2:min(left + 4, 20)] = tone(CRIMSON)
        front[r, max(right - 4, 20):right - 2] = tone(CRIMSON)
        if inner_l < inner_r:
            front[r, inner_l:inner_r] = tone(SHIRT, -1 if r > 14 else 0)
            if r < 8:  # the open neck of the shirt, the collar folded over it
                open_l, open_r = 15 + r // 2, 25 - r // 2
                front[r, open_l:open_r] = tone(0xC9906A, -1)
                front[r, inner_l:open_l] = tone(SHIRT)
                front[r, open_r:inner_r] = tone(SHIRT, -1)
                if open_l - 1 >= inner_l:
                    front[r, open_l - 1] = tone(SHIRT, -1)
            elif inner_r - inner_l >= 2:
                front[r, 19:21] = tone(SHIRT, -2)  # the placket
    front[22:25, 18:22] = tone(NAVY)
    front[22, 19:21] = tone(CRIMSON)
    back = canvas(32, 56, CREAM, -1)
    knit(back, offset=1)
    rib_band(back, 48, SWEATER_BAND)
    shade(back, S[0:5, 6:26], 1)
    shade(back, S[10:46, 15:17], -1)  # the spine
    shade(back, S[:, 0:2], -1)
    shade(back, S[:, 30:32], -1)
    side = canvas(16, 56, CREAM, -1)
    knit(side, offset=3)
    rib_band(side, 48, SWEATER_BAND)
    shade(side, S[5:12, :], -1)  # the armpit
    top = canvas(24, 12, CREAM, 1)
    knit(top)
    return tile(front=front, back=back, side=side, cap=top)


def sleeve(cuff):
    """A knitted sleeve, one cable down the middle; the forearm ends in the striped cuff."""
    front = canvas(24, 40, CREAM)
    knit(front, period=12, offset=6)
    shade(front, S[:, 0:2], -1)
    shade(front, S[:, 21:24], -1)
    back = canvas(24, 40, CREAM, -1)
    knit(back, period=12, offset=6)
    if cuff:
        rib_band(front, 32, [None] + CUFF_BAND + [None])
        rib_band(back, 32, [None] + CUFF_BAND + [None])
    else:
        shade(front, S[0:5, 2:20], 1)  # the shoulder catches the light
    end = canvas(12, 12, CREAM, -1)
    return tile(front=front, back=back, cap=end)


def skin(color):
    """Bare skin for necks, hands and noses, shadowed under the jaw (the top rows)."""
    front = canvas(16, 24, color)
    shade(front, S[0:5, :], -1)
    shade(front, S[:, 12:16], -1)
    back = canvas(16, 24, color, -1)
    shade(back, S[0:5, :], -1)
    return tile(front=front, back=back, cap=canvas(8, 8, color))


def hair(color):
    """Chunky locks: a zigzag sheen across the top, a few strand partings below, darker tips."""
    def locks(width, height, sheen, step):
        image = canvas(width, height, color, step)
        rows, cols = grid(image)
        zig = sheen + (cols // 2) % 2
        shade(image, (rows >= zig) & (rows < zig + 3) & (cols % 4 != 3), 1)
        shade(image, (rows > sheen + 4) & (cols % 5 == 2), -1)
        shade(image, S[height - 4:, :], -1)
        return image
    crown = canvas(24, 24, color)
    rows, cols = grid(crown)
    shade(crown, (rows - cols) % 8 == 0, -1)
    return tile(front=locks(16, 24, 3, 0), back=locks(24, 32, 4, -1), cap=crown)


def face(skin_color, hair_color, eye_color, hair_name, moustache=False, zinc=False, stubble=False, long_hair=False,
         share=None):
    """A head: a big painted face on the front (40x48, rows run from the crown at
    y 0.36 to the chin at y 0.05 in the head's frame), an ear and sideburn on each
    side, the back of the head with the nape, and the crown from the hair tile.
    With `share`, only the front is painted and the sides and back are that figure's."""
    hair_tone = tone(hair_color)
    front = canvas(40, 48, skin_color)
    shade(front, S[:, 0:4], -1)
    shade(front, S[:, 35:40], -1)
    shade(front, S[:, 38:40], -1)
    shade(front, S[17:22, 9:28], 1)  # forehead
    # hair, with a ragged fringe
    rows, cols = grid(front)
    fringe = 16 + np.array([0, 2, 3, 1, 0, 2, 4, 1])[np.arange(40) % 8]
    mask = rows < fringe[None, :]
    front[mask] = hair_tone
    shade(front, mask & (rows >= 4) & (rows < 7) & (cols % 4 != 3), 1)
    shade(front, mask & (rows > 9) & (cols % 5 == 2), -1)
    front[16:27, 0:2] = tone(hair_color, -1)  # temples
    front[16:27, 38:40] = tone(hair_color, -1)
    # brows: thick, the inner ends pulled down
    brow = tone(hair_color, -1) if hair_name != "black" else tone(hair_color)
    if hair_name == "blond":
        brow = tone(hair_color, -2)
    shade(front, S[20:22, 10:30], -1)  # the brow ridge
    front[21:24, 10:16] = brow
    front[22:25, 16:18] = brow
    front[21:24, 24:30] = brow
    front[22:25, 22:24] = brow
    shade(front, S[21, 10:16], 1)
    shade(front, S[21, 24:30], 1)
    # eyes: lid, white, a tall iris with a highlight and pupil, a shadow under
    for x in (11, 22):
        front[24, x + 1:x + 7] = tone(skin_color, -1)
        front[25, x:x + 7] = tone(LASH)
        front[26:29, x:x + 7] = tone(EYE_WHITE)
        front[26:29, x + 2:x + 5] = tone(eye_color)
        front[28, x + 2:x + 5] = tone(eye_color, -1)
        front[27, x + 3] = tone(LASH)
        front[26, x + 2] = tone(0xFFFFFF)
        front[26:29, x] = tone(EYE_WHITE, -1)
        front[29, x + 1:x + 6] = tone(skin_color, -1)
    # nose: lit bridge, shadow side, nostrils
    shade(front, S[25:33, 19], 1)
    shade(front, S[27:34, 21], -1)
    shade(front, S[33:35, 18:23], -1)
    front[34, 18] = tone(skin_color, -3)
    front[34, 22] = tone(skin_color, -3)
    shade(front, S[35, 18:23], -1)
    # cheekbones and the hollows under them
    shade(front, S[29:31, 8:12], 1)
    shade(front, S[29:31, 28:31], 1)
    shade(front, S[33:39, 5:10], -1)
    shade(front, S[33:39, 30:35], -1)
    if stubble:
        shade(front, S[36:48, 4:36], -1)
    # mouth
    front[39, 16:24] = tone(LIP)
    front[40, 17:23] = tone(LIP, 1)
    front[39, 15] = tone(skin_color, -2)
    front[39, 24] = tone(skin_color, -2)
    shade(front, S[41, 18:22], -1)
    # a square chin and jaw
    shade(front, S[43:46, 17:23], 1)
    front[45, 20] = tone(skin_color, -1)
    shade(front, S[42:48, 0:12], -1)
    shade(front, S[42:48, 28:40], -1)
    shade(front, S[45:48, 0:7], -1)
    shade(front, S[45:48, 33:40], -1)
    shade(front, S[47, :], -1)
    if moustache:
        front[36:39, 14:26] = hair_tone
        shade(front, S[36, 14:26], 1)
        front[39:41, 14:16] = hair_tone
        front[39:41, 24:26] = hair_tone
    if zinc:
        front[29:32, 9:31] = tone(0xF8F8F2)
        shade(front, S[31, 9:31], -1)
    side = canvas(24, 48, skin_color, -1)
    side[0:17] = hair_tone
    shade(side, S[4:7, 0::4], 1)
    shade(side, S[4:7, 1::4], 1)
    side[17:30, 4:8] = tone(hair_color, -1)  # sideburn
    back_end = 40 if long_hair else 36
    side[0:back_end, 16:24] = hair_tone
    shade(side, S[8:back_end, 18::5], -1)
    side[24:35, 10:15] = tone(skin_color)  # the ear
    side[26:33, 12:14] = tone(skin_color, -2)
    side[24:35, 15] = tone(skin_color, -3)
    shade(side, S[24:35, 10], 1)
    for r in range(38, 48):
        shade(side, S[r, 0:r - 34], -1)  # under the jaw
    back = canvas(24, 40, skin_color, -1)
    nape = 34 if long_hair else 30
    back[0:nape] = hair_tone
    rows, cols = grid(back)
    tips = (rows >= nape) & (rows < nape + 2) & (cols % 4 < 2)
    back[tips] = hair_tone
    zig = 4 + (cols // 2) % 2
    shade(back, (rows >= zig) & (rows < zig + 3) & (cols % 4 != 3), 1)
    shade(back, (rows > 9) & (rows < nape + 2) & (cols % 5 == 2), -1)
    shade(back, S[nape + 2:, :], -1)
    if share:
        side, back = (f"face_{share}", "side"), (f"face_{share}", "back")
    return tile(front=front, side=side, back=back, cap=(f"hair_{hair_name}", "cap"))


def test_cap():
    """A baggy green: panel seams, a gold-edged crest, a sweatband, a button on top."""
    front = canvas(40, 24, CAP_GREEN)
    shade(front, S[0:5, 0:30], 1)
    for c in (0, 13, 26, 39):
        shade(front, S[:, c], -1)
        if c + 1 < 40:
            shade(front, S[:, c + 1], 1)
    shade(front, S[20:24, :], -1)
    shade(front, S[21, ::2], -1)  # stitching
    for r in range(11):
        half = 5 if r < 6 else 5 - (r - 5)
        front[6 + r, 20 - half:20 + half] = tone(GOLD)
        if half > 1 and 0 < r < 10:
            front[6 + r, 21 - half:19 + half] = tone(CAP_GREEN, -1)
    for r, row in enumerate(("..X..", "XXXXX", ".XXX.", ".X.X.")):  # a star in the shield
        for c, mark in enumerate(row):
            if mark == "X":
                front[9 + r, 18 + c] = tone(GOLD, 1)
    back = canvas(32, 24, CAP_GREEN, -1)
    for c in (0, 10, 21, 31):
        shade(back, S[:, c], -1)
    shade(back, S[20:24, :], -1)
    side = canvas(16, 24, CAP_GREEN, -1)
    shade(side, S[:, 8], -1)
    shade(side, S[20:24, :], -1)
    top = canvas(16, 16, CAP_GREEN, 1)
    rows, cols = grid(top)
    shade(top, (rows == cols) | (rows == 15 - cols), -1)
    top[7:9, 7:9] = tone(CAP_GREEN, -2)
    return tile(front=front, back=back, side=side, cap=top)


def cap_peak():
    """The peak: stitched rows across the top, dark green under and round the edge."""
    top = canvas(32, 16, CAP_GREEN)
    shade(top, S[0:3, :], -2)  # in the crown's shadow
    shade(top, S[4:7, 2:30], 1)
    shade(top, S[9, 1::2], -1)
    shade(top, S[12, 1::2], -1)
    shade(top, S[15, :], -1)
    return tile(front=canvas(8, 4, CAP_GREEN, -2), cap=top)


def sun_hat():
    """The crown of a white sun hat with a navy band."""
    front = canvas(32, 24, HAT_WHITE)
    shade(front, S[0:3, 0:24], 1)
    for r in (4, 8, 12):
        shade(front, S[r, ::2], -1)
    front[15:21] = tone(NAVY)
    shade(front, S[15, :], 1)
    shade(front, S[21:24, :], -1)
    back = front.copy()
    shade(back, S[:, :], -1)
    side = canvas(16, 24, HAT_WHITE, -1)
    side[15:21] = tone(NAVY, -1)
    for r in (4, 8, 12):
        shade(side, S[r, ::2], -1)
    top = canvas(16, 16, HAT_WHITE, 1)
    shade(top, S[3, 3:13], -1)
    shade(top, S[12, 3:13], -1)
    shade(top, S[3:13, 3], -1)
    shade(top, S[3:13, 12], -1)
    return tile(front=front, back=back, side=side, cap=top)


def brim():
    """The brim, painted round from the crown out (rows 0-13 the top, 14-15 the
    bound edge) and back in underneath (16-23, green against the glare)."""
    front = canvas(40, 24, HAT_WHITE)
    shade(front, S[0:2, :], -1)
    for r in (5, 9, 12):
        shade(front, S[r, ::2], -1)
    front[14:16] = tone(HAT_WHITE, -1)
    shade(front, S[15, :], -1)
    front[16:24] = tone(UNDER_BRIM, -1)
    shade(front, S[20:24, :], -1)
    back = front.copy()
    shade(back, S[0:14, :], -1)
    side = front[:, 0:16].copy()
    shade(side, S[0:14, :], -1)
    return tile(front=front, back=back, side=side)


def pad():
    """A batting pad: five vertical cane rolls down the front (rows 0-55), the
    instep flap below; buff straps with steel buckles round the side."""
    front = canvas(32, 64, PAD_WHITE)
    rows, cols = grid(front)
    m = (cols + 3) % 6
    body = rows < 56
    shade(front, body & (m == 0), -2)
    shade(front, body & ((m == 1) | (m == 2)), 1)
    shade(front, body & (m == 5), -1)
    shade(front, S[0:2, :], -1)
    shade(front, S[56, :], -2)
    shade(front, S[60:64, :], -1)
    shade(front, S[:, 0:2], -1)
    shade(front, S[:, 30:32], -1)
    side = canvas(16, 64, PAD_WHITE, -1)
    back = canvas(8, 64, BUFF, -1)
    for r in (9, 27, 45):
        for image in (side, back):
            image[r:r + 4] = tone(BUFF)
            shade(image, S[r + 3, :], -1)
        side[r:r + 4, 5:9] = tone(STEEL, 1)
        side[r + 1:r + 3, 6:8] = tone(SOLE)
    return tile(front=front, back=back, side=side, cap=canvas(16, 8, PAD_WHITE, -1))


def knee_roll():
    """Two stitched bolsters across the knee."""
    front = canvas(32, 16, PAD_WHITE)
    for top in (0, 8):
        shade(front, S[top, :], -1)
        shade(front, S[top + 1:top + 3, :], 1)
        shade(front, S[top + 6, :], -1)
        shade(front, S[top + 7, :], -2)
    shade(front, S[:, 3::6], -1)
    side = front[:, 0:16].copy()
    shade(side, S[:, :], -1)
    return tile(front=front, back=canvas(16, 16, BUFF, -1), side=side, cap=canvas(16, 8, PAD_WHITE, -1))


def glove():
    """A batting glove: striped wristband, white back, green sausage fingers."""
    front = canvas(24, 32, LEATHER)
    front[1:5] = tone(NAVY)
    shade(front, S[0, :], -1)
    shade(front, S[5:7, :], -1)
    shade(front, S[7:13, 0:3], -1)
    shade(front, S[7:13, 21:24], -1)
    rows, cols = grid(front)
    fingers = rows >= 13
    front[fingers] = tone(SAUSAGE)
    m = cols % 6
    shade(front, fingers & (m == 0), -2)
    shade(front, fingers & ((m == 1) | (m == 2)), 1)
    shade(front, fingers & (m == 5), -1)
    shade(front, S[19, :], -1)
    shade(front, S[25, :], -1)
    shade(front, S[30:32, :], -1)
    back = canvas(24, 32, LEATHER, -1)
    back[1:5] = tone(NAVY, -1)
    shade(back, S[13:32, 5::6], -1)
    return tile(front=front, back=back, cap=canvas(8, 8, LEATHER, -1))


def keeper_glove():
    """A wicketkeeper's mitt: white backs with a navy band, tan leather palms dimpled
    with rubber pips, the web between thumb and finger darker."""
    front = canvas(16, 24, LEATHER)
    front[1:4] = tone(NAVY)
    shade(front, S[0, :], -1)
    shade(front, S[:, 0], -1)
    shade(front, S[:, 15], -1)
    shade(front, S[9:22, 5::5], -1)  # stitched finger stalls
    shade(front, S[21:24, :], -1)
    back = canvas(16, 24, PALM)
    back[1:4] = tone(NAVY, -1)
    back[6:23:3, 1:15:3] = tone(PALM, -2)  # the pips
    back[6:12, 12:16] = tone(PALM, -2)  # the web
    shade(back, S[22:24, :], -1)
    return tile(front=front, back=back, cap=canvas(4, 4, LEATHER, -1))


def keeper_pad():
    """A keeper's lighter pad: three broad canes, buff straps round the side."""
    front = canvas(16, 40, PAD_WHITE)
    rows, cols = grid(front)
    m = (cols + 1) % 6
    body = rows < 35
    shade(front, body & (m == 0), -2)
    shade(front, body & ((m == 1) | (m == 2)), 1)
    shade(front, body & (m == 5), -1)
    shade(front, S[35, :], -2)
    shade(front, S[0, :], -1)
    side = canvas(8, 40, PAD_WHITE, -1)
    for r in (8, 25):
        side[r:r + 4] = tone(BUFF)
        side[r + 1:r + 3, 3:5] = tone(STEEL, 1)
    return tile(front=front, side=side, back=("kpad", "side"))


def boot():
    """White spiked boots: laces over the instep (rows 0-10), the toe box, a welt and a dark sole."""
    front = canvas(32, 24, LEATHER)
    front[0:11, 12:20] = tone(LEATHER, -1)  # the tongue
    for r in range(1, 11, 2):
        front[r, 12:20] = tone(0xFFFFFF)
        front[r, 11] = tone(SOLE)
        front[r, 20] = tone(SOLE)
    shade(front, S[11:13, 4:28], 1)
    shade(front, S[:, 0:3], -1)
    shade(front, S[:, 29:32], -1)
    shade(front, S[18:20, :], -1)
    front[20:24] = tone(SOLE)
    shade(front, S[20, :], 1)
    side = canvas(32, 24, LEATHER, -1)
    for k in range(3):
        for r in range(3, 17):
            c = 9 + 4 * k + (r - 3) // 3
            side[r, c:c + 2] = tone(NAVY)
    shade(side, S[8:20, 24:32], -1)
    shade(side, S[18:20, :], -1)
    side[20:24] = tone(SOLE)
    side[23, 3::8] = tone(STEEL)
    back = canvas(24, 24, LEATHER, -1)
    back[2:18, 9:15] = tone(NAVY, -1)  # heel tab
    back[20:24] = tone(SOLE)
    sole = canvas(16, 16, SOLE)
    sole[2::5, 3::5] = tone(STEEL)
    return tile(front=front, back=back, side=side, cap=sole)


def blade():
    """Willow: straight grain down the face, a maker's sticker under the shoulder,
    a lit spine down the back."""
    front = canvas(16, 64, WILLOW)
    for c in (3, 7, 12):
        shade(front, S[:, c], -1)
    shade(front, S[:, 5], 1)
    shade(front, S[:, 0], -1)
    shade(front, S[:, 15], -1)
    front[5:14, 2:14] = tone(NAVY)
    front[6:13, 3:13] = tone(CRIMSON)
    front[8, 4:12] = tone(SHIRT)
    front[10, 5:11] = tone(GOLD)
    shade(front, S[58:64, :], -1)
    shade(front, S[62:64, :], -1)
    back = canvas(16, 64, WILLOW, -1)
    shade(back, S[:, 6:10], 2)
    shade(back, S[:, 0:3], -1)
    shade(back, S[:, 13:16], -1)
    back[8:18, 6:10] = tone(CRIMSON)
    back[10:16, 7:9] = tone(SHIRT)
    side = canvas(8, 64, WILLOW, -1)
    shade(side, S[:, 3], -1)
    end = canvas(16, 8, WILLOW, -2)
    shade(end, S[3:5, 4:12], 1)
    return tile(front=front, back=back, side=side, cap=end)


def bat_grip():
    """A crimson rubber grip, ribbed in a spiral."""
    front = canvas(12, 32, GRIP)
    rows, cols = grid(front)
    shade(front, (rows + cols) % 4 == 0, -1)
    shade(front, (rows + cols) % 4 == 1, 1)
    shade(front, S[0:2, :], -1)
    return tile(front=front, cap=canvas(4, 4, GRIP, -1))


def flannels():
    """White flannel legs: a pressed crease (lit on the left), folds at both ends."""
    front = canvas(32, 48, FLANNEL)
    shade(front, S[:, 15], -1)
    shade(front, S[:, 16], 1)
    shade(front, S[:, 0:3], -1)
    shade(front, S[:, 28:32], -1)
    shade(front, S[:, 30:32], -1)
    for i in range(6):
        shade(front, S[3 + i, 4 + i], -1)
        shade(front, S[3 + i, 5 + i], 1)
        shade(front, S[4 + i, 27 - i], -1)
    shade(front, S[40, 5:13], -1)
    shade(front, S[41, 5:13], 1)
    shade(front, S[43, 18:26], -1)
    shade(front, S[44, 18:26], 1)
    back = canvas(32, 48, FLANNEL, -1)
    shade(back, S[:, 16], -1)
    for r in (37, 41, 45):
        shade(back, S[r, 6:26], -1)
    return tile(front=front, back=back, cap=canvas(8, 8, FLANNEL, -1))


def trousers_seat():
    """The flannels round the hips (mostly under the sweater): the fly, folds into the crotch."""
    front = canvas(32, 16, FLANNEL)
    shade(front, S[4:16, 16], -1)
    shade(front, S[4:16, 17], 1)
    for i in range(5):
        shade(front, S[11 + i, 10 + i], -1)
        shade(front, S[11 + i, 22 - i], -1)
    shade(front, S[:, 0:3], -1)
    shade(front, S[:, 28:32], -1)
    back = canvas(32, 16, FLANNEL, -1)
    shade(back, S[2:16, 16], -1)
    side = canvas(8, 16, FLANNEL, -1)
    return tile(front=front, back=back, side=side, cap=canvas(8, 8, FLANNEL, -1))


def wood(color):
    """Stumps and bails: straight grain and darker end grain."""
    front = canvas(16, 48, color)
    for c in (3, 8, 12):
        shade(front, S[:, c], -1)
    shade(front, S[:, 5], 1)
    shade(front, S[0:2, :], 1)
    end = canvas(8, 8, color, -1)
    shade(end, S[3:5, 3:5], 1)
    return tile(front=front, cap=end)


def bail_wood():
    front = canvas(16, 8, BAIL)
    shade(front, S[0, :], 1)
    shade(front, S[6:8, :], -1)
    shade(front, S[:, 7:9], -1)
    return tile(front=front, cap=canvas(8, 8, BAIL, -1))


# The figures wear these; build_figure picks a face, skin and hair by name.
FACES = {
    "batter": dict(skin="fair", hair="brown", eyes="blue"),
    "bowler": dict(skin="tan", hair="black", eyes="brown", moustache=True, stubble=True, long_hair=True),
    "slip": dict(skin="fair", hair="blond", eyes="green", zinc=True),
    "fielder": dict(skin="brown", hair="black", eyes="brown"),
    "keeper": dict(skin="fair", hair="brown", eyes="green", moustache=True, stubble=True, share="batter"),
}


def kit_atlas():
    atlas = Atlas("kit")
    painters = [
        ("sweater", sweater()), ("sleeve", sleeve(False)), ("cuff", sleeve(True)),
        ("cap", test_cap()), ("peak", cap_peak()), ("sunhat", sun_hat()), ("brim", brim()),
        ("pad", pad()), ("kneeroll", knee_roll()), ("glove", glove()), ("boot", boot()),
        ("blade", blade()), ("grip", bat_grip()), ("flannel", flannels()), ("seat", trousers_seat()),
        ("ash", wood(ASH)), ("bail", bail_wood()), ("kglove", keeper_glove()), ("kpad", keeper_pad()),
    ]
    painters += [(f"skin_{name}", skin(color)) for name, color in SKINS.items()]
    used_hair = sorted({spec["hair"] for spec in FACES.values()})
    painters += [(f"hair_{name}", hair(HAIRS[name])) for name in used_hair]
    for figure, spec in FACES.items():
        extras = {k: v for k, v in spec.items() if k not in ("skin", "hair", "eyes")}
        painters.append((f"face_{figure}", face(SKINS[spec["skin"]], HAIRS[spec["hair"]], EYES[spec["eyes"]], spec["hair"], **extras)))
    for name, painter in painters:
        atlas.add(name, painter)
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
