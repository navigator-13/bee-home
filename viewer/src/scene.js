import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { woodByKey } from './woods.js';

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

/**
 * Two looks.
 *
 * `drawing` is what the original builder actually showed: hairline axonometric
 * line art on bone, no shading, no material. `timber` is the addition — the
 * same geometry shaded, so per-storey species selection has something to read
 * against.
 */
const BACKDROP = { drawing: '#e9e9e1', timber: '#2a2920' };
const LINE = { drawing: '#2a2920', timber: '#e9e9e1' };

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
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.mode = 'timber';
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(BACKDROP.timber);

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
    this.materials = new Map();
    this.edgeCache = new Map();
    this.maps = this.loadMaps();
    this.raycaster = new THREE.Raycaster();
    this.selected = -1;
    this.hovered = -1;
    this.onFrame = null; // the app hangs per-frame UI work here (storey rail)

    this.resize();
    addEventListener('resize', () => this.resize());
    this.renderer.setAnimationLoop(() => {
      this.controls.update();
      this.renderer.render(this.scene, this.camera);
      if (this.onFrame) this.onFrame();
    });
  }

  /** Screen-space centre and half-height of one storey, in canvas pixels. */
  storeyAnchor(index) {
    const box = new THREE.Box3();
    let found = false;
    for (const child of this.root.children) {
      if (child.isMesh && child.userData.storey === index) {
        box.expandByObject(child);
        found = true;
      }
    }
    if (!found) return null;
    // expandByObject works in world space already; no further transform.
    const centre = box.getCenter(new THREE.Vector3());
    const top = new THREE.Vector3(centre.x, box.max.y, centre.z);
    const canvas = this.renderer.domElement;
    const project = (v) => {
      const p = v.clone().project(this.camera);
      return {
        x: (p.x + 1) / 2 * canvas.clientWidth,
        y: (1 - p.y) / 2 * canvas.clientHeight,
        behind: p.z > 1,
      };
    };
    const c = project(centre);
    return c.behind ? null : { y: c.y, half: Math.abs(project(top).y - c.y) };
  }

  /**
   * In drawing mode the solids are still drawn — flat, in the background
   * colour, nudged back by a polygon offset — so they hide the edges behind
   * them. That is what turns a see-through wireframe into the occluded
   * hidden-line axonometric the original builder showed.
   */
  occluder() {
    if (!this._occluder) {
      this._occluder = new THREE.MeshBasicMaterial({
        color: BACKDROP.drawing,
        polygonOffset: true,
        polygonOffsetFactor: 1,
        polygonOffsetUnits: 1,
      });
    }
    return this._occluder;
  }

  loadMaps() {
    const textures = new THREE.TextureLoader();
    const repeat = (texture) => {
      texture.wrapS = THREE.RepeatWrapping;
      texture.wrapT = THREE.RepeatWrapping;
      texture.repeat.set(2, 2);
      return texture;
    };
    const colorMap = repeat(textures.load('textures/WoodPlywood001_COL_2K.jpg'));
    colorMap.colorSpace = THREE.SRGBColorSpace;
    return { colorMap, normalMap: repeat(textures.load('textures/birch_normal.png')) };
  }

  /** One shared material per species — the tint multiplies the plywood map. */
  materialFor(woodKey) {
    if (!this.materials.has(woodKey)) {
      const wood = woodByKey(woodKey);
      this.materials.set(woodKey, new THREE.MeshStandardMaterial({
        color: wood.tint,
        map: this.maps.colorMap,
        normalMap: this.maps.normalMap,
        normalScale: new THREE.Vector2(0.35, 0.35),
        roughness: wood.roughness,
        metalness: 0,
      }));
    }
    return this.materials.get(woodKey);
  }

  setMode(mode) {
    this.mode = mode;
    // Plates go into a printed PDF, so they need paper white rather than the
    // bone the on-screen drawing mode uses.
    // Plates are composited onto the page, so they render on transparency.
    this.scene.background = this.plateAlpha ? null
      : new THREE.Color(this.plateWhite ? '#ffffff' : BACKDROP[mode]);
    this.shadowFloor.visible = mode === 'timber';
    for (const child of this.root.children) {
      if (child.isLineSegments) {
        child.material.color.set(LINE[mode]);
        child.material.opacity = mode === 'drawing' ? 1 : 0.22;
      } else if (child.isMesh) {
        child.material = mode === 'drawing'
          ? this.occluder()
          : this.materialFor(child.userData.wood);
        child.castShadow = mode === 'timber';
        child.receiveShadow = mode === 'timber';
      }
    }
  }

  /** Which storey is under the pointer, or -1. */
  pick(event) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const point = new THREE.Vector2(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(point, this.camera);
    const targets = this.root.children.filter((c) => c.isMesh);
    const hit = this.raycaster.intersectObjects(targets, false)[0];
    return hit ? hit.object.userData.storey ?? -1 : -1;
  }

  setSelected(index) {
    this.selected = index;
    this.restyleLines();
  }

  /** A lighter touch than selection: the pointer resting on a storey. */
  setHovered(index) {
    if (index === this.hovered) return;
    this.hovered = index;
    this.restyleLines();
  }

  restyleLines() {
    for (const child of this.root.children) {
      if (!child.isLineSegments) continue;
      const storey = child.userData.storey;
      const isSelected = this.selected >= 0 && storey === this.selected;
      const isHovered = !isSelected && this.hovered >= 0 && storey === this.hovered;
      child.material.color.set(isSelected || isHovered ? '#a5b7e6' : LINE[this.mode]);
      child.material.opacity = isSelected ? 1
        : isHovered ? 0.85
          : (this.mode === 'drawing' ? 1 : 0.22);
    }
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

  /**
   * Add one part. `storey` is the stack index it belongs to (-1 for mounting
   * hardware), used for picking and for per-storey species.
   */
  add(geometry, position, { wood = 'birch', storey = -1 } = {}) {
    const mesh = new THREE.Mesh(geometry, this.materialFor(wood));
    mesh.position.copy(position);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData.storey = storey;
    mesh.userData.wood = wood;
    if (this.mode === 'drawing') mesh.material = this.occluder();
    this.root.add(mesh);

    if (!this.edgeCache.has(geometry.uuid)) {
      this.edgeCache.set(geometry.uuid, new THREE.EdgesGeometry(geometry, 20));
    }
    const lines = new THREE.LineSegments(
      this.edgeCache.get(geometry.uuid),
      new THREE.LineBasicMaterial({
        color: LINE[this.mode],
        transparent: true,
        opacity: this.mode === 'drawing' ? 1 : 0.22,
      }),
    );
    lines.position.copy(position);
    lines.userData.storey = storey;
    this.root.add(lines);

    mesh.userData.lines = lines; // so callers scaling a part scale both
    return mesh;
  }

  clear() {
    for (const child of this.root.children) {
      if (child.isLineSegments) child.material.dispose();
    }
    this.root.clear();
    this.selected = -1;
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

  /**
   * Swap to an orthographic camera for the measured views a spec sheet needs.
   * `axis` is 'front' or 'plan'; anything else restores the perspective view.
   */
  setProjection(axis) {
    const box = new THREE.Box3().setFromObject(this.root);
    if (box.isEmpty()) return;
    const size = box.getSize(new THREE.Vector3());
    const centre = box.getCenter(new THREE.Vector3());
    const aspect = this.camera.aspect || 1;

    if (axis !== 'front' && axis !== 'plan') return;

    const extent = axis === 'front'
      ? Math.max(size.x, size.y) * 0.62
      : Math.max(size.x, size.z) * 0.62;
    const ortho = new THREE.OrthographicCamera(
      -extent * aspect, extent * aspect, extent, -extent, 0.001, 40,
    );
    if (axis === 'front') {
      ortho.position.set(centre.x, centre.y, centre.z + 2);
      ortho.up.set(0, 1, 0);
    } else {
      ortho.position.set(centre.x, centre.y + 2, centre.z);
      ortho.up.set(0, 0, -1);
    }
    ortho.lookAt(centre);
    this.camera = ortho;
    this.controls.object = ortho;
    this.controls.target.copy(centre);
    this.controls.enabled = false;
    this.controls.update();
  }

  /**
   * The three measured views a spec sheet needs, captured from the live
   * scene: hidden-line drawing on white, axonometric plus front and plan
   * orthographics. Renders through temporary cameras so the interactive one
   * is never touched, and puts the mode back the way it found it.
   */
  captureViews() {
    const previous = { mode: this.mode, white: this.plateWhite, selected: this.selected };
    this.plateWhite = true;
    this.setMode('drawing');
    this.setSelected(-1);

    const box = new THREE.Box3().setFromObject(this.root);
    const size = box.getSize(new THREE.Vector3());
    const centre = box.getCenter(new THREE.Vector3());
    const aspect = this.camera.aspect || 1;
    const shot = (camera) => {
      this.renderer.render(this.scene, camera);
      // Read back synchronously, straight after the render, so the buffer is
      // still intact without needing preserveDrawingBuffer on all the time.
      return this.renderer.domElement.toDataURL('image/png');
    };

    const radius = size.length();
    const iso = new THREE.PerspectiveCamera(28, aspect, 0.01, 100);
    iso.position.set(centre.x + radius * 1.15, centre.y + radius * 0.82, centre.z + radius * 1.4);
    iso.lookAt(centre);

    const ortho = (axis) => {
      const extent = axis === 'front'
        ? Math.max(size.x, size.y) * 0.62
        : Math.max(size.x, size.z) * 0.62;
      const camera = new THREE.OrthographicCamera(
        -extent * aspect, extent * aspect, extent, -extent, 0.001, 40,
      );
      if (axis === 'front') {
        camera.position.set(centre.x, centre.y, centre.z + 2);
      } else {
        camera.position.set(centre.x, centre.y + 2, centre.z);
        camera.up.set(0, 0, -1);
      }
      camera.lookAt(centre);
      return camera;
    };

    const views = {
      iso: shot(iso),
      front: shot(ortho('front')),
      plan: shot(ortho('plan')),
    };

    this.plateWhite = previous.white;
    this.setMode(previous.mode);
    this.setSelected(previous.selected);
    return views;
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
