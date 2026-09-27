"""Build the museum's alligator from the WildMesh 3D download (Blender script).

Usage:
    blender --background --factory-startup --python tools/export_gator.py

Reads models/alligator/source/source/ALLIGATOR_DEMO.fbx (unzip the Sketchfab
download, and the source.zip inside it, into models/alligator/; models/ is
gitignored) and writes models/alligator/alligator.glb: both animation clips
(Idle, Trot_F), the skin, textures as WebP with the body texture at 1024 px.
tools/build_assets.py then copies it into content/ and the manifest.

The model is "ALLIGATOR - Realistic 3D Model (DEMO FREE)" by WildMesh 3D,
CC BY-NC 4.0: credit it (the museum's credits panel does) and keep it
non-commercial.
"""
from pathlib import Path

import bpy

ROOT = Path(__file__).resolve().parent.parent
FBX = ROOT / "models" / "alligator" / "source" / "source" / "ALLIGATOR_DEMO.fbx"
OUT = ROOT / "models" / "alligator" / "alligator.glb"

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.fbx(filepath=str(FBX), automatic_bone_orientation=True)
for img in bpy.data.images:
    if img.size[0] > 1024:
        img.scale(1024, 1024)
bpy.ops.export_scene.gltf(
    filepath=str(OUT),
    export_format="GLB",
    export_image_format="WEBP",
    export_image_quality=82,
    export_animations=True,
    export_animation_mode="ACTIONS",
    export_force_sampling=True,
    export_optimize_animation_size=True,
    export_yup=True,
    export_apply=False,
    export_skins=True,
    export_morph=False,
    export_lights=False,
    export_cameras=False,
)
print("Wrote", OUT)
