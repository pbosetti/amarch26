"""Convert a USDZ mesh to a compact JavaScript asset for the slide viewer.

Run with Blender, for example:

  /Applications/Blender.app/Contents/MacOS/Blender --background --python \
    scripts/usdz_to_webgl_model.py -- \
    slides/_Mask.usdz slides/mask-model.js _Mask.usdz slides/mask-texture.png
"""

from __future__ import annotations

import base64
import json
import math
import struct
import sys
import zipfile
from pathlib import Path

import bpy


def normalize(value: tuple[float, float, float]) -> tuple[float, float, float]:
  length = math.sqrt(value[0] * value[0] + value[1] * value[1] + value[2] * value[2])
  if length <= 1e-12:
    return (0.0, 1.0, 0.0)
  return (value[0] / length, value[1] / length, value[2] / length)


def pack_float32(values: list[float]) -> str:
  return base64.b64encode(struct.pack("<%sf" % len(values), *values)).decode("ascii")


def pack_uint16(values: list[int]) -> str:
  return base64.b64encode(struct.pack("<%sH" % len(values), *values)).decode("ascii")


def pack_uint32(values: list[int]) -> str:
  return base64.b64encode(struct.pack("<%sI" % len(values), *values)).decode("ascii")


def to_webgl_axes(value: tuple[float, float, float]) -> tuple[float, float, float]:
  # Blender imports USDZ into a Z-up scene. The slide viewer is Y-up, so this
  # rotates the model 90 degrees about X and keeps the mask standing upright.
  return (value[0], value[2], -value[1])


def extract_diffuse_texture(input_path: Path, texture_path: Path) -> str | None:
  with zipfile.ZipFile(input_path) as archive:
    texture_names = [
      name
      for name in archive.namelist()
      if name.lower().endswith(".png") and "_tex" in Path(name).name.lower()
    ]
    if not texture_names:
      return None
    texture_name = texture_names[0]
    texture_path.parent.mkdir(parents=True, exist_ok=True)
    texture_path.write_bytes(archive.read(texture_name))
    return texture_path.name


def export_model(input_path: Path, output_path: Path, model_key: str, texture_path: Path) -> None:
  bpy.ops.object.select_all(action="SELECT")
  bpy.ops.object.delete()
  bpy.ops.wm.usd_import(filepath=str(input_path))

  positions: list[float] = []
  normals: list[float] = []
  texcoords: list[float] = []
  indices: list[int] = []
  vertex_lookup: dict[tuple[int, int, int, int, int, int], int] = {}
  bounds_min = [float("inf"), float("inf"), float("inf")]
  bounds_max = [float("-inf"), float("-inf"), float("-inf")]
  texture_name = extract_diffuse_texture(input_path, texture_path)

  depsgraph = bpy.context.evaluated_depsgraph_get()
  mesh_objects = [obj for obj in bpy.context.scene.objects if obj.type == "MESH"]
  if not mesh_objects:
    raise RuntimeError(f"No mesh objects found in {input_path}")

  for obj in mesh_objects:
    evaluated = obj.evaluated_get(depsgraph)
    mesh = evaluated.to_mesh()
    mesh.calc_loop_triangles()
    if hasattr(mesh, "calc_normals"):
      mesh.calc_normals()
    normal_matrix = obj.matrix_world.to_3x3().inverted().transposed()
    uv_layer = mesh.uv_layers.active.data if mesh.uv_layers.active else None

    for triangle in mesh.loop_triangles:
      for loop_index in triangle.loops:
        loop = mesh.loops[loop_index]
        vertex = mesh.vertices[loop.vertex_index]
        uv = uv_layer[loop_index].uv if uv_layer else (0.0, 0.0)
        normal = normalize(to_webgl_axes(tuple(normal_matrix @ loop.normal)))
        key = (
          loop.vertex_index,
          round(uv[0] * 65535),
          round(uv[1] * 65535),
          round(normal[0] * 32767),
          round(normal[1] * 32767),
          round(normal[2] * 32767),
        )
        index = vertex_lookup.get(key)
        if index is None:
          world_position = obj.matrix_world @ vertex.co
          position = to_webgl_axes((world_position.x, world_position.y, world_position.z))
          index = len(positions) // 3
          vertex_lookup[key] = index
          positions.extend(position)
          normals.extend(normal)
          texcoords.extend((uv[0], uv[1]))
          bounds_min[0] = min(bounds_min[0], position[0])
          bounds_min[1] = min(bounds_min[1], position[1])
          bounds_min[2] = min(bounds_min[2], position[2])
          bounds_max[0] = max(bounds_max[0], position[0])
          bounds_max[1] = max(bounds_max[1], position[1])
          bounds_max[2] = max(bounds_max[2], position[2])
        indices.append(index)

    evaluated.to_mesh_clear()

  index_type = "Uint16Array" if max(indices) <= 65535 else "Uint32Array"
  packed_indices = pack_uint16(indices) if index_type == "Uint16Array" else pack_uint32(indices)

  model = {
    "format": "amarch-webgl-model-v1",
    "source": input_path.name,
    "vertexCount": len(positions) // 3,
    "triangleCount": len(indices) // 3,
    "bounds": {
      "min": bounds_min,
      "max": bounds_max,
    },
    "attributes": {
      "position": {
        "type": "Float32Array",
        "itemSize": 3,
        "data": pack_float32(positions),
      },
      "normal": {
        "type": "Float32Array",
        "itemSize": 3,
        "data": pack_float32(normals),
      },
      "texcoord": {
        "type": "Float32Array",
        "itemSize": 2,
        "data": pack_float32(texcoords),
      },
    },
    "indices": {
      "type": index_type,
      "itemSize": 1,
      "data": packed_indices,
    },
    "texture": texture_name,
  }

  output_path.parent.mkdir(parents=True, exist_ok=True)
  with output_path.open("w", encoding="utf-8") as file:
    file.write("window.AmarchReconstructionModels = window.AmarchReconstructionModels || {};\n")
    file.write(f"window.AmarchReconstructionModels[{json.dumps(model_key)}] = ")
    json.dump(model, file, separators=(",", ":"))
    file.write(";\n")

  print(f"Wrote {output_path} from {input_path}: {model['vertexCount']} vertices, "
        f"{model['triangleCount']} triangles, texture={texture_name}")


def main() -> int:
  args = sys.argv
  if "--" in args:
    args = args[args.index("--") + 1 :]
  else:
    args = args[1:]

  if len(args) not in (3, 4):
    print("usage: usdz_to_webgl_model.py -- input.usdz output.js model-key [texture.png]",
          file=sys.stderr)
    return 2

  output_path = Path(args[1])
  texture_path = Path(args[3]) if len(args) == 4 else output_path.with_suffix(".png")
  export_model(Path(args[0]), output_path, args[2], texture_path)
  return 0


if __name__ == "__main__":
  raise SystemExit(main())
