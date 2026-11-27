"""Shared helpers for the model scripts: pixel-art textures, a low-poly mesh
builder that maps them, rigid-skinned armatures with baked clips, and the glTF
export. Written for Blender 5.3, run headless.

Units are metres. Blender is Z-up; the exporter converts to glTF's Y-up, which
turns Blender (x, y, z) into (x, z, -y): exactly the page's mapping from data
axes to scene axes (viz/js/coords.js).
"""
import json
import struct
import tempfile
from pathlib import Path

import bmesh
import bpy
import numpy as np
from mathutils import Matrix, Vector

FPS = 30
PANELS = ("front", "back", "side", "cap")
_materials = {}  # texture name -> material, for the scene being built


def reset():
    """Empties the file. Preferences and add-ons are left alone, so the build
    also runs inside a live Blender."""
    for blocks in (bpy.data.objects, bpy.data.meshes, bpy.data.armatures, bpy.data.materials, bpy.data.images, bpy.data.actions):
        for block in list(blocks):
            blocks.remove(block)
    bpy.context.scene.render.fps = FPS
    _materials.clear()


def link(obj, parent=None):
    bpy.context.scene.collection.objects.link(obj)
    obj.rotation_mode = "QUATERNION"
    if parent is not None:
        obj.parent = parent
    return obj


def empty(name, parent=None):
    return link(bpy.data.objects.new(name, None), parent)


# Textures -------------------------------------------------------------------------

def _material(name, pixels):
    """An unlit-looking material whose base colour is `pixels` (rows from the top,
    sRGB bytes), sampled without filtering. Colours are cut to five bits a channel,
    as on a PlayStation."""
    if name in _materials:
        return _materials[name]
    height, width = pixels.shape[:2]
    rgba = np.ones((height, width, 4), np.float32)
    rgba[..., :3] = (np.clip(pixels, 0, 255).astype(np.uint8)[::-1] >> 3 << 3) / 255  # Blender stores rows from the bottom
    image = bpy.data.images.new(name, width, height, alpha=False)
    image.pixels.foreach_set(rgba.ravel())
    image.filepath_raw = str(Path(tempfile.gettempdir()) / f"fourth_stump_{name}.png")
    image.file_format = "PNG"
    image.save()  # the exporter embeds the saved file

    mat = bpy.data.materials.new(name)
    if mat.node_tree is None:  # Blender 5 gives every material a node tree already
        mat.use_nodes = True
    bsdf = next(n for n in mat.node_tree.nodes if n.bl_idname == "ShaderNodeBsdfPrincipled")
    bsdf.inputs["Roughness"].default_value = 1
    bsdf.inputs["Metallic"].default_value = 0
    texture = mat.node_tree.nodes.new("ShaderNodeTexImage")
    texture.image = image
    texture.interpolation = "Closest"
    mat.node_tree.links.new(texture.outputs["Color"], bsdf.inputs["Base Color"])
    _materials[name] = mat
    return mat


class Atlas:
    """One square texture packed from named tiles. A tile has up to four panels
    (front, back, side, cap); a primitive stretches each of its faces over the
    panel its normal picks."""

    GUTTER = 0  # edge pixels repeated round each panel; the page samples unfiltered, so none are needed

    def __init__(self, name, size=256):
        self.name, self.size = name, size
        self.pixels = np.zeros((size, size, 3), np.float32)
        self.rects = {}
        self.pending = []  # (tile, panel, image | alias), packed on the first map()

    def add(self, tile, painter, width=32, height=32):
        """`painter(panel, width, height)` returns an image (of any size), None to
        reuse the front panel, or a (tile, panel) key to reuse a panel already added."""
        assert not self.rects, f"atlas {self.name} is already packed"
        for panel in PANELS:
            image = painter(panel, width, height)
            self.pending.append((tile, panel, (tile, "front") if image is None else image))

    def _pack(self):
        """Skyline packing, tallest panels first: each goes where it sits highest up."""
        images = [(key, image) for *key, image in self.pending if not isinstance(image, tuple)]
        images.sort(key=lambda item: (-item[1].shape[0], -item[1].shape[1]))
        sky = np.zeros(self.size, int)  # the lowest free row of each column
        g = self.GUTTER
        for (tile, panel), image in images:
            height, width = image.shape[0] + 2 * g, image.shape[1] + 2 * g
            tops = [sky[x:x + width].max() for x in range(self.size - width + 1)]
            x = int(np.argmin(tops))
            y = int(tops[x])
            assert y + height <= self.size, f"atlas {self.name} is full at {tile} {panel}"
            self.pixels[y:y + height, x:x + width] = np.pad(image, ((g, g), (g, g), (0, 0)), mode="edge")
            self.rects[tile, panel] = (x + g, y + g, width - 2 * g, height - 2 * g)
            sky[x:x + width] = y + height
        for tile, panel, image in self.pending:
            if isinstance(image, tuple):
                self.rects[tile, panel] = self.rects[image]

    def map(self, tile, panel, u, v, _size):
        if not self.rects:
            self._pack()
        x, y, width, height = self.rects[tile, panel]
        inset = 0.25  # keeps unfiltered sampling off the neighbouring panel
        px = x + inset + u * (width - 2 * inset)
        py = y + inset + (1 - v) * (height - 2 * inset)
        return _material(self.name, self.pixels), (px / self.size, 1 - py / self.size)


class Tiled:
    """A small texture repeated at `density` pixels per metre, for buildings and hills."""

    def __init__(self, name, pixels, density):
        self.name, self.pixels, self.density = name, pixels, density

    def map(self, _tile, _panel, u, v, size):
        height, width = self.pixels.shape[:2]
        return _material(self.name, self.pixels), (u * size[0] * self.density / width, v * size[1] * self.density / height)


# Meshes -----------------------------------------------------------------------------

class Shape:
    """Collects flat-shaded primitives into one mesh. Each primitive is textured by
    box projection in its own frame, and belongs to the vertex group of the part
    being drawn, so one bone carries it rigidly."""

    def __init__(self, atlas=None):
        self.bm = bmesh.new()
        self.atlas = atlas
        self.uv = self.bm.loops.layers.uv.new("UVMap")
        self.deform = self.bm.verts.layers.deform.verify()
        self.materials, self.groups = [], []
        self.origin, self.group = Matrix.Identity(4), None

    def part(self, origin, group=None):
        """Everything drawn from here on sits in the frame `origin` and moves with `group`."""
        self.origin, self.group = origin, group
        if group is not None and group not in self.groups:
            self.groups.append(group)

    def _texture(self, made, matrix, tile, extent, low=None):
        """`low` is the corner of the primitive's box (centred on its origin if None)."""
        source = tile if isinstance(tile, Tiled) else self.atlas
        inverse = matrix.inverted()
        scale = matrix.to_scale()
        metres = [extent[i] * scale[i] for i in range(3)]
        low = [-e / 2 for e in extent] if low is None else low
        for vert in made["verts"]:
            if self.group is not None:
                vert[self.deform][self.groups.index(self.group)] = 1.0
        for face in {face for vert in made["verts"] for face in vert.link_faces}:
            face.smooth = False
            local = [inverse @ loop.vert.co for loop in face.loops]
            normal = Vector((0, 0, 0))
            for a, b in zip(local, local[1:] + local[:1]):  # Newell's method, in the primitive's frame
                normal += Vector(((a.y - b.y) * (a.z + b.z), (a.z - b.z) * (a.x + b.x), (a.x - b.x) * (a.y + b.y)))
            axis = max(range(3), key=lambda i: abs(normal[i]))
            for loop, point in zip(face.loops, local):
                p = [(point[i] - low[i]) / extent[i] for i in range(3)]
                if axis == 2:
                    panel, u, v, size = "cap", p[0], p[1], (metres[0], metres[1])
                elif axis == 1:  # a figure's front is Blender -Y
                    panel, u, v, size = ("front", p[0], p[2], (metres[0], metres[2])) if normal.y < 0 else ("back", 1 - p[0], p[2], (metres[0], metres[2]))
                else:  # u runs from the front edge to the back on both sides
                    panel, u, v, size = "side", p[1], p[2], (metres[1], metres[2])
                material, loop[self.uv].uv = source.map(tile, panel, u, v, size)
            if material not in self.materials:
                self.materials.append(material)
            face.material_index = self.materials.index(material)

    def cube(self, matrix, tile):
        """A unit cube carried to its place and size by `matrix`."""
        full = self.origin @ matrix
        self._texture(bmesh.ops.create_cube(self.bm, size=1, matrix=full), full, tile, (1, 1, 1))

    def cone(self, bottom, top, depth, sides, matrix, tile):
        """A prism or pyramid along local Z, `sides` faces round."""
        full = self.origin @ matrix
        made = bmesh.ops.create_cone(
            self.bm, cap_ends=True, cap_tris=False, segments=sides,
            radius1=bottom, radius2=top, depth=depth, matrix=full,
        )
        width = 2 * max(bottom, top)
        self._texture(made, full, tile, (width, width, depth))

    def ico(self, radius, matrix, tile):
        full = self.origin @ matrix
        made = bmesh.ops.create_icosphere(self.bm, subdivisions=1, radius=radius, matrix=full)
        self._texture(made, full, tile, (2 * radius, 2 * radius, 2 * radius))

    def solid(self, points, faces, matrix, tile, uvs=None):
        """A closed mesh: `points` in its own frame, `faces` as lists of point indices
        (any winding; normals are made to point out). `uvs`, one per face, is
        (panel, {point index: (u, v)}); without it panels are box-projected."""
        full = self.origin @ matrix
        verts = [self.bm.verts.new(full @ Vector(p)) for p in points]
        made = [self.bm.faces.new([verts[i] for i in face]) for face in faces]
        bmesh.ops.recalc_face_normals(self.bm, faces=made)
        if uvs is None:
            low = [min(p[i] for p in points) for i in range(3)]
            extent = [max(max(p[i] for p in points) - low[i], 1e-6) for i in range(3)]
            self._texture({"verts": verts}, full, tile, extent, low)
            return
        index = {vert: i for i, vert in enumerate(verts)}
        if self.group is not None:
            for vert in verts:
                vert[self.deform][self.groups.index(self.group)] = 1.0
        for face, (panel, corners) in zip(made, uvs):
            face.smooth = False
            for loop in face.loops:
                material, loop[self.uv].uv = self.atlas.map(tile, panel, *corners[index[loop.vert]], None)
            if material not in self.materials:
                self.materials.append(material)
            face.material_index = self.materials.index(material)

    def polygon(self, points, tile, facing):
        """A flat upright polygon through `points`, wound so its normal agrees with `facing`."""
        verts = [self.bm.verts.new(p) for p in points]
        face = self.bm.faces.new(verts)
        face.normal_update()
        if face.normal.dot(facing) < 0:
            face.normal_flip()
        xs, zs = [p[0] for p in points], [p[2] for p in points]
        middle = Vector(((min(xs) + max(xs)) / 2, points[0][1], (min(zs) + max(zs)) / 2))
        extent = (max(xs) - min(xs), 1, max(zs) - min(zs))
        self._texture({"verts": verts}, Matrix.Translation(middle), tile, extent)

    def finish(self, name, parent=None):
        mesh = bpy.data.meshes.new(name)
        self.bm.to_mesh(mesh)
        self.bm.free()
        for material in self.materials:
            mesh.materials.append(material)
        obj = link(bpy.data.objects.new(name, mesh), parent)
        for group in self.groups:
            obj.vertex_groups.new(name=group)
        return obj


def scaled(matrix, x, y, z):
    return matrix @ Matrix.Diagonal((x, y, z, 1))


# Rigs and clips -----------------------------------------------------------------

def armature(name, bones, mesh):
    """An armature called `name` that carries `mesh`. `bones` is
    { bone: (parent, head, tail) } in armature space, parents first. Each bone's
    joint frame is a plain translation to its head."""
    data = bpy.data.armatures.new(name)
    rig = link(bpy.data.objects.new(name, data))
    bpy.context.view_layer.objects.active = rig
    bpy.ops.object.mode_set(mode="EDIT")
    for bone, (parent, head, tail) in bones.items():
        edit = data.edit_bones.new(bone)
        edit.head, edit.tail = head, tail
        if parent:
            edit.parent = data.edit_bones[parent]
    bpy.ops.object.mode_set(mode="OBJECT")
    mesh.parent = rig
    mesh.modifiers.new("Armature", "ARMATURE").object = rig
    return rig


def pose(rig, joints):
    """Poses the rig so every bone's vertices are carried from their rest place by
    joints[bone]: the bone's joint frame in armature space."""
    posed = {}
    for bone in rig.pose.bones:  # parents come first
        rest = bone.bone.matrix_local
        posed[bone.name] = joints[bone.name] @ Matrix.Translation(-bone.bone.head_local) @ rest
        parent = bone.bone.parent
        if parent is None:
            bone.matrix_basis = rest.inverted() @ posed[bone.name]
        else:
            bone.matrix_basis = (parent.matrix_local.inverted() @ rest).inverted() @ posed[parent.name].inverted() @ posed[bone.name]


def bake(rig, clip, frames):
    """Keys one pose per frame (`frames` is a list of joint-frame dicts) as an action
    on an NLA track called `clip`; the exporter writes one clip per track name."""
    data = rig.animation_data or rig.animation_data_create()
    data.action = bpy.data.actions.new(clip)
    for frame, joints in enumerate(frames):
        pose(rig, joints)
        for bone in rig.pose.bones:
            bone.keyframe_insert("location", frame=frame)
            bone.keyframe_insert("rotation_quaternion", frame=frame)
    action = data.action
    track = data.nla_tracks.new()
    track.name = clip
    track.strips.new(clip, 0, action)
    data.action = None


def export(path, animations=False):
    """Writes the whole scene as one .glb with its textures embedded."""
    bpy.ops.export_scene.gltf(
        filepath=str(path),
        export_format="GLB",
        export_yup=True,
        export_normals=True,
        export_texcoords=True,
        export_tangents=False,
        export_materials="EXPORT",
        export_extras=True,  # custom properties such as release_time reach the page as userData
        export_skins=True,
        export_animations=animations,
        export_animation_mode="NLA_TRACKS",  # one clip per NLA track name
        export_force_sampling=True,
        export_frame_range=False,
        export_optimize_animation_size=True,  # drops repeated keys (the never-changing scales), keeping every channel
        export_optimize_animation_keep_anim_armature=True,  # so a clip still holds every bone when the page blends clips
    )


def stats(path):
    """Size, triangle count, clips (with their lengths) and extras of a .glb, from its JSON chunk."""
    data = path.read_bytes()
    length = struct.unpack_from("<I", data, 12)[0]
    gltf = json.loads(data[20:20 + length])
    triangles = 0
    for mesh in gltf.get("meshes", []):
        for primitive in mesh["primitives"]:
            accessor = primitive.get("indices", primitive["attributes"]["POSITION"])
            triangles += gltf["accessors"][accessor]["count"] // 3
    clips = []
    for animation in gltf.get("animations", []):
        times = [gltf["accessors"][sampler["input"]] for sampler in animation["samplers"]]
        clips.append(f"{animation.get('name')} {min(t['min'][0] for t in times):.2f}-{max(t['max'][0] for t in times):.2f}s")
    return {
        "bytes": len(data),
        "triangles": triangles,
        "nodes": len(gltf.get("nodes", [])),
        "textures": len(gltf.get("images", [])),
        "clips": clips,
        "extras": {node["name"]: node["extras"] for node in gltf.get("nodes", []) if node.get("extras")},
    }
