// Loads the Blender-built models (viz/blender/ writes them to viz/assets/).
// A model that fails to load comes back as null and the caller draws a
// placeholder, so the page still works.
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { flat } from './materials.js';

const loader = new GLTFLoader();

// Every face is drawn in its flat base colour with the page's shared materials.
function prepare(gltf, shadows) {
  gltf.scene.traverse((object) => {
    if (!object.isMesh) return;
    const exported = object.material;
    object.material = flat(exported.color.getHex());
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

// figures: names of the cricketers; backdrops: venue keys. Resolves to { name: gltf | null }.
export async function loadModels(figures, backdrops) {
  const names = [...figures.map((name) => [name, true]), ...backdrops.map((name) => [name, false])];
  const loaded = await Promise.all(names.map(([name, shadows]) => loadModel(name, shadows)));
  return Object.fromEntries(names.map(([name], index) => [name, loaded[index]]));
}
