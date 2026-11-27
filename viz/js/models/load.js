// Loads the Blender-built models (viz/blender/ writes them to viz/assets/).
// A model that fails to load comes back as null and the caller draws a
// placeholder, so the page still works.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { flat } from './materials.js';

const loader = new GLTFLoader();
const unlit = new Map(); // one shared material per texture

// Pixel art: no smoothing, no mipmaps, and marked sRGB so its colours are converted once.
// The wrap mode the file asked for is left alone (the backdrops tile their textures).
function pixelArt(texture) {
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

// The textures are painted with their own shading, so they are drawn unlit.
// A mesh without a texture keeps the flat-shaded colour material.
function materialFor(exported) {
  if (!exported.map) return flat(exported.color.getHex());
  if (!unlit.has(exported.map.uuid)) {
    unlit.set(exported.map.uuid, new THREE.MeshBasicMaterial({ map: pixelArt(exported.map), side: exported.side }));
  }
  return unlit.get(exported.map.uuid);
}

function prepare(gltf, shadows) {
  gltf.scene.traverse((object) => {
    if (!object.isMesh) return;
    const exported = object.material;
    object.material = materialFor(exported);
    exported.dispose();
    object.castShadow = shadows;
    object.receiveShadow = shadows;
  });
  return gltf;
}

async function loadModel(name, shadows) {
  try {
    return prepare(await loader.loadAsync(`./assets/${name}.glb`), shadows);
  } catch (error) {
    console.warn(`assets/${name}.glb did not load, so a placeholder is drawn instead.`, error);
    return null;
  }
}

// figures: names of the cricketers and the stumps; backdrops: venue keys. Resolves to { name: gltf | null }.
export async function loadModels(figures, backdrops) {
  const names = [...figures.map((name) => [name, true]), ...backdrops.map((name) => [name, false])];
  const loaded = await Promise.all(names.map(([name, shadows]) => loadModel(name, shadows)));
  return Object.fromEntries(names.map(([name], index) => [name, loaded[index]]));
}

// What the textures in use are set to, read back from the live materials.
export function textureReport() {
  return [...unlit.values()].map(({ map }) => ({
    name: map.name || map.source?.data?.src?.slice(0, 24) || map.uuid,
    nearest: map.magFilter === THREE.NearestFilter && map.minFilter === THREE.NearestFilter,
    mipmaps: map.generateMipmaps,
    colorSpace: map.colorSpace,
    repeats: map.wrapS === THREE.RepeatWrapping,
  }));
}
