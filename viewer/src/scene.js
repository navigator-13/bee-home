import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

/**
 * The 3D stage.
 *
 * Materials follow the original site's recipe, read off its AR export code:
 * a #F1D6BA base tinted over the plywood colour map at repeat(2, 2), with
 * faces treated differently depending on which way they point so cut edges
 * read as end grain. The original achieved that by splitting faces across
 * three material slots; here the same effect comes from box-projected UVs,
 * which is cheaper and survives arbitrary geometry.
 */

const WOOD = '#F1D6BA';
const BACKDROP = '#2A2920';

/**
 * Box-project UVs from vertex normals — the meshes carry no texture coords.
 *
 * `scale` is in UV units per metre, and this runs *after* the geometry has been
 * scaled from millimetres, so it has to be sized for metre-scale coordinates:
 * a 120 mm storey spans 0.12 × scale of the texture.
 */
function projectUvs(geometry, scale = 6) {
  const position = geometry.attributes.position;
  const normal = geometry.attributes.normal;
  const uv = new Float32Array(position.count * 2);
  for (let i = 0; i < position.count; i += 1) {
    const nx = Math.abs(normal.getX(i));
    const ny = Math.abs(normal.getY(i));
    const nz = Math.abs(normal.getZ(i));
    const x = position.getX(i);
    const y = position.getY(i);
    const z = position.getZ(i);
    let u;
    let v;
    if (nz >= nx && nz >= ny) {
      [u, v] = [x, y]; // top and bottom faces — face grain
    } else if (nx >= ny) {
      [u, v] = [y, z]; // side faces — end grain runs across the cut
    } else {
      [u, v] = [x, z];
    }
    uv[i * 2] = u * scale;
    uv[i * 2 + 1] = v * scale;
  }
  geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geometry.setAttribute('uv2', new THREE.BufferAttribute(uv, 2));
}

export class Stage {
  constructor(canvas) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(BACKDROP);

    this.camera = new THREE.PerspectiveCamera(35, 1, 0.01, 100);
    this.camera.position.set(0.42, 0.3, 0.52);

    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.07;
    this.controls.enablePan = false;
    this.controls.minDistance = 0.22;
    this.controls.maxDistance = 1.6;
    this.controls.maxPolarAngle = Math.PI * 0.52;

    this.scene.add(new THREE.HemisphereLight('#f4efe4', '#3a382c', 1.5));

    const key = new THREE.DirectionalLight('#fff6e6', 2.4);
    key.position.set(0.5, 0.9, 0.6);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.camera.near = 0.1;
    key.shadow.camera.far = 4;
    const extent = 0.5;
    Object.assign(key.shadow.camera, { left: -extent, right: extent, top: extent, bottom: -extent });
    key.shadow.bias = -0.0009;
    this.scene.add(key);

    const fill = new THREE.DirectionalLight('#cdd8f2', 0.5);
    fill.position.set(-0.7, 0.35, -0.4);
    this.scene.add(fill);

    // A shadow catcher rather than a visible ground plane — the original scene
    // had gridVisibility and groundPlaneVisibility both off.
    this.shadowFloor = new THREE.Mesh(
      new THREE.PlaneGeometry(4, 4),
      new THREE.ShadowMaterial({ opacity: 0.32 }),
    );
    this.shadowFloor.rotation.x = -Math.PI / 2;
    this.shadowFloor.receiveShadow = true;
    this.scene.add(this.shadowFloor);

    this.root = new THREE.Group();
    this.scene.add(this.root);

    this.loader = new GLTFLoader();
    this.cache = new Map();
    this.material = this.buildMaterial();

    this.resize();
    addEventListener('resize', () => this.resize());
    this.renderer.setAnimationLoop(() => {
      this.controls.update();
      this.renderer.render(this.scene, this.camera);
    });
  }

  buildMaterial() {
    const textures = new THREE.TextureLoader();
    const colorMap = textures.load('textures/WoodPlywood001_COL_2K.jpg');
    colorMap.colorSpace = THREE.SRGBColorSpace;
    colorMap.wrapS = THREE.RepeatWrapping;
    colorMap.wrapT = THREE.RepeatWrapping;
    colorMap.repeat.set(2, 2);

    const normalMap = textures.load('textures/birch_normal.png');
    normalMap.wrapS = THREE.RepeatWrapping;
    normalMap.wrapT = THREE.RepeatWrapping;
    normalMap.repeat.set(2, 2);

    return new THREE.MeshStandardMaterial({
      color: WOOD,
      map: colorMap,
      normalMap,
      normalScale: new THREE.Vector2(0.35, 0.35),
      roughness: 0.82,
      metalness: 0,
    });
  }

  async load(file) {
    if (!this.cache.has(file)) {
      this.cache.set(
        file,
        new Promise((resolve, reject) => {
          this.loader.load(file, (gltf) => {
            let geometry = null;
            gltf.scene.traverse((child) => {
              if (child.isMesh) geometry = child.geometry;
            });
            if (!geometry) {
              reject(new Error(`no mesh in ${file}`));
              return;
            }
            // Rhino is Z-up and millimetre; three.js wants Y-up and metres.
            geometry.rotateX(-Math.PI / 2);
            geometry.scale(0.001, 0.001, 0.001);
            projectUvs(geometry);
            resolve(geometry);
          }, undefined, reject);
        }),
      );
    }
    return this.cache.get(file);
  }

  add(geometry, position) {
    const mesh = new THREE.Mesh(geometry, this.material);
    mesh.position.copy(position);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.root.add(mesh);
    return mesh;
  }

  clear() {
    this.root.clear();
  }

  /** Drop the model onto y=0 and aim the camera at the middle of it. */
  frame() {
    const box = new THREE.Box3().setFromObject(this.root);
    if (box.isEmpty()) return;
    this.root.position.y -= box.min.y;
    const size = box.getSize(new THREE.Vector3());
    const centre = box.getCenter(new THREE.Vector3());
    this.controls.target.set(0, centre.y - box.min.y, 0);
    const radius = Math.max(size.x, size.y, size.z);
    this.controls.minDistance = radius * 0.8;
    this.controls.maxDistance = radius * 6;
  }

  lookFrom(distanceScale = 2.6) {
    const box = new THREE.Box3().setFromObject(this.root);
    if (box.isEmpty()) return;
    const radius = box.getSize(new THREE.Vector3()).length();
    const target = this.controls.target;
    this.camera.position.set(
      target.x + radius * 0.42 * distanceScale,
      target.y + radius * 0.3 * distanceScale,
      target.z + radius * 0.5 * distanceScale,
    );
    this.controls.update();
  }

  resize() {
    const canvas = this.renderer.domElement;
    const width = canvas.clientWidth || 1;
    const height = canvas.clientHeight || 1;
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }
}
