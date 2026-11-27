"""One low-poly backdrop per venue, to stand behind the bowler's end: the Lord's
Pavilion, the old WACA scoreboard, and Table Mountain with Devil's Peak.
Stylised silhouettes in repeating pixel textures, not scale models.

Authored in the page's data axes, which are Blender's own: +x across (the off
side of a right-hander), +y away from the batter, +z up. The origin is the
middle of the building line at ground level; the page puts it behind the bowler.
"""
from math import pi

from mathutils import Matrix, Vector

from lib import Shape, scaled
from textures import tiled

TOWARDS_PITCH = Vector((0, -1, 0))


def block(shape, size, base, tile):
    """A box `size` = (across, high, deep) standing on `base` = (x, y, z)."""
    width, height, depth = size
    x, y, z = base
    shape.cube(scaled(Matrix.Translation((x, y, z + height / 2)), width, depth, height), tile)


def pyramid(shape, radius, height, base, tile, deep=1.0):
    """A four-sided roof, square to the axes, `deep` squashing it front to back."""
    x, y, z = base
    matrix = Matrix.Translation((x, y, z + height / 2)) @ Matrix.Diagonal((1, deep, 1, 1)) @ Matrix.Rotation(pi / 4, 4, "Z")
    shape.cone(radius, 0, height, 4, matrix, tile)


def build_lords():
    """A long terracotta Victorian pavilion: two end towers, white balconies, members in their seats."""
    shape = Shape()
    brick, tower = tiled("brick", 0xB5573A), tiled("brick", 0xA94E34)
    slate, cream, window = tiled("courses", 0x5D6470), tiled("plain", 0xFAF7EE), tiled("window", 0x3B2A26, density=8)
    block(shape, (32, 8, 7), (0, 0, 0), brick)
    block(shape, (33.5, 1, 8), (0, 0, 8), slate)  # roof line
    block(shape, (14, 2, 5), (0, 0, 9), brick)  # central upper storey
    block(shape, (15, 0.7, 6), (0, 0, 11), slate)
    for x in (-18, 18):
        block(shape, (6.5, 11.5, 8), (x, 0, 0), tower)
        pyramid(shape, 5.2, 3, (x, 0, 11.5), slate)
        block(shape, (0.2, 2.6, 0.2), (x, 0, 14.2), cream)  # flagpole
        block(shape, (1.8, 1.1, 0.1), (x + 1, 0, 15.7), tiled("stripes", 0xD43A2F, density=8))  # egg and bacon
        block(shape, (1.6, 2.2, 0.3), (x, -4, 6.5), window)
    for z in (2.7, 5.4):
        block(shape, (30, 0.7, 1.4), (0, -4, z), tiled("rail", 0xFAF7EE, density=8))  # balconies
    block(shape, (30, 1.9, 4), (0, -5, 0), tiled("crowd", 0xE9E4D6))  # seating in front
    for i in range(6):
        x = -11.5 + 4.6 * i
        block(shape, (2, 1.6, 0.3), (x, -3.6, 3.5), window)  # long-room windows
        block(shape, (1.7, 1.4, 0.3), (x, -3.6, 6.2), window)
    shape.finish("lords_pavilion")


def build_perth():
    """The WACA's white heritage scoreboard with its dark manual board, between grass banks."""
    shape = Shape()
    white, board = tiled("boards", 0xF7F5EC), tiled("plain", 0x16261F)
    block(shape, (90, 4, 14), (0, 4, 0), tiled("crowd", 0x4F9A4A, density=2))  # the hill, with its crowd
    block(shape, (21, 10.5, 5), (0, 0, 0), white)
    block(shape, (18.4, 7, 0.4), (0, -2.6, 2.8), board)
    for row, z in enumerate((8.4, 6.9, 5.4, 3.9)):  # name and number slots
        block(shape, (7, 0.9, 0.2), (-4.7, -2.9, z), tiled("slots", 0xF2C230 if row == 0 else 0xF7F5EC, density=6))
        for column, x in enumerate((1.2, 3.5, 5.8, 7.8)):
            if (row + column) % 4 != 3:
                block(shape, (1.5, 0.9, 0.2), (x, -2.9, z), tiled("slots", 0xF7F5EC, density=6))
    pyramid(shape, 15.5, 3.2, (0, 0, 10.5), tiled("courses", 0x9A3B2C), deep=0.3)
    block(shape, (0.25, 2.2, 0.25), (0, 0, 13.4), white)
    block(shape, (1.8, 1.1, 0.1), (1, 0, 14.5), tiled("plain", 0x1C2A55))
    shape.finish("waca_scoreboard")


def build_newlands():
    """Table Mountain's long flat top with the pointed Devil's Peak beside it, over the oaks."""
    shape = Shape()

    def ridge(points, color, y, pattern="rock"):
        shape.polygon([(x, y, z) for x, z in points], tiled(pattern, color, density=0.2, size=64), TOWARDS_PITCH)

    far = 550
    # Table Mountain: the long flat top
    ridge([(-230, 0), (-200, 30), (-170, 52), (-140, 61), (-20, 62), (5, 58), (30, 44), (50, 36), (80, 0)], 0x6F8198, far + 30)
    ridge([(-200, 0), (-165, 44), (-150, 26), (-115, 46), (-95, 24), (-60, 46), (-35, 22), (-5, 44), (25, 20), (60, 0)], 0x5D6F86, far + 20)  # buttresses below the rim
    # Devil's Peak: the pointed summit beside it
    ridge([(30, 0), (60, 34), (95, 66), (112, 78), (128, 64), (160, 34), (215, 0)], 0x55657C, far)
    ridge([(60, 0), (95, 66), (112, 78), (116, 40), (140, 0)], 0x47566B, far - 10)
    ridge([(-230, 0), (-150, 22), (-40, 16), (60, 26), (150, 18), (230, 0)], 0x3F6B4A, far - 60, "leaves")  # wooded lower slopes
    for i in range(13):  # the oaks
        x = -42 + 7 * i
        y = 8 + i % 3
        shape.ico(2.8, scaled(Matrix.Translation((x, y, 4)), 1, 1, 1.2), tiled("leaves", 0x2F6B3C if i % 2 else 0x3A7A45))
        block(shape, (0.5, 2, 0.5), (x, y, 0), tiled("plain", 0x5A4030))
    block(shape, (44, 2.6, 6), (0, 0, 0), tiled("crowd", 0xE9E4D6))  # a low stand
    block(shape, (46, 0.5, 7.5), (0, 0, 2.6), tiled("courses", 0x2C5C8A))
    shape.finish("table_mountain")
