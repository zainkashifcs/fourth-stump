"""Shared helpers for the model scripts: flat-colour materials, a low-poly mesh
builder, and the glTF export. Written for Blender 5.3, run headless.

Units are metres. Blender is Z-up; the exporter converts to glTF's Y-up, which
turns Blender (x, y, z) into (x, z, -y): exactly the page's mapping from data
axes to scene axes (viz/js/coords.js).
"""
import json
import struct

import bmesh
import bpy
from mathutils import Matrix


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def link(obj, parent=None):
    bpy.context.scene.collection.objects.link(obj)
    obj.rotation_mode = "QUATERNION"
    if parent is not None:
        obj.parent = parent
    return obj


def empty(name, parent=None):
    return link(bpy.data.objects.new(name, None), parent)


def _linear(channel):
    c = channel / 255
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def material(color):
    """A Principled BSDF with a flat base colour, from an sRGB 0xRRGGBB value."""
    name = f"flat_{color:06x}"
    mat = bpy.data.materials.get(name)
    if mat is None:
        mat = bpy.data.materials.new(name)
        if mat.node_tree is None:  # Blender 5 gives every material a node tree already
            mat.use_nodes = True
        bsdf = next(n for n in mat.node_tree.nodes if n.bl_idname == "ShaderNodeBsdfPrincipled")
        rgb = [_linear((color >> shift) & 255) for shift in (16, 8, 0)]
        bsdf.inputs["Base Color"].default_value = (*rgb, 1)
        bsdf.inputs["Roughness"].default_value = 1
        bsdf.inputs["Metallic"].default_value = 0
    return mat


class Shape:
    """Collects flat-shaded primitives into one mesh with a material slot per colour."""

    def __init__(self):
        self.bm = bmesh.new()
        self.colors = []

    def _paint(self, faces, color):
        if color not in self.colors:
            self.colors.append(color)
        for face in faces:
            face.material_index = self.colors.index(color)
            face.smooth = False

    def _paint_new(self, made, color):
        """Paints the faces of the vertices an operator has just made."""
        self._paint({face for vert in made["verts"] for face in vert.link_faces}, color)

    def cube(self, matrix, color):
        """A unit cube carried to its place and size by `matrix`."""
        self._paint_new(bmesh.ops.create_cube(self.bm, size=1, matrix=matrix), color)

    def cone(self, bottom, top, depth, sides, matrix, color):
        """A prism or pyramid along local Z, `sides` faces round."""
        self._paint_new(bmesh.ops.create_cone(
            self.bm, cap_ends=True, cap_tris=False, segments=sides,
            radius1=bottom, radius2=top, depth=depth, matrix=matrix,
        ), color)

    def ico(self, radius, matrix, color):
        self._paint_new(bmesh.ops.create_icosphere(self.bm, subdivisions=1, radius=radius, matrix=matrix), color)

    def polygon(self, points, color, facing):
        """A flat polygon through `points`, wound so its normal agrees with `facing`."""
        face = self.bm.faces.new([self.bm.verts.new(p) for p in points])
        face.normal_update()
        if face.normal.dot(facing) < 0:
            face.normal_flip()
        self._paint([face], color)

    def finish(self, name, parent=None):
        mesh = bpy.data.meshes.new(name)
        self.bm.to_mesh(mesh)
        self.bm.free()
        for color in self.colors:
            mesh.materials.append(material(color))
        return link(bpy.data.objects.new(name, mesh), parent)


def scaled(matrix, x, y, z):
    return matrix @ Matrix.Diagonal((x, y, z, 1))


def export(path, animations=False):
    """Writes the whole scene as one .glb. Normals and UVs are left out: the
    page shades every face flat, so the file only needs positions."""
    bpy.ops.export_scene.gltf(
        filepath=str(path),
        export_format="GLB",
        export_yup=True,
        export_normals=False,
        export_texcoords=False,
        export_tangents=False,
        export_materials="EXPORT",
        export_animations=animations,
        export_animation_mode="NLA_TRACKS",  # one clip per NLA track name, across all objects
        export_force_sampling=True,
        export_frame_range=False,
        export_optimize_animation_size=False,
        export_optimize_animation_keep_anim_object=True,
    )


def stats(path):
    """Size, triangle count and clip names of a .glb, read from its JSON chunk."""
    data = path.read_bytes()
    length = struct.unpack_from("<I", data, 12)[0]
    gltf = json.loads(data[20:20 + length])
    triangles = 0
    for mesh in gltf.get("meshes", []):
        for primitive in mesh["primitives"]:
            accessor = primitive.get("indices", primitive["attributes"]["POSITION"])
            triangles += gltf["accessors"][accessor]["count"] // 3
    return {
        "bytes": len(data),
        "triangles": triangles,
        "nodes": len(gltf.get("nodes", [])),
        "clips": [a.get("name") for a in gltf.get("animations", [])],
    }
