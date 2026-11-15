import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

// La génération des contours est faite sur le site : aucun GLB à modifier.
// Les lignes correspondent aux arêtes franches et aux limites de pièces non soudées.
const instances = new WeakMap();

function mount({ url, container, message, toggle, reset }) {
  if (!url || !container || instances.has(container)) return;
  const state = { url, outlines: [], loaded: false };
  instances.set(container, state);
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
  } catch (error) {
    message.textContent = 'WebGL n’est pas disponible sur ce navigateur.';
    return;
  }
  renderer.setClearColor(0xffffff, 1);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.35;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xffffff);
  scene.add(new THREE.HemisphereLight(0xffffff, 0xbababa, 2.35));
  const light = new THREE.DirectionalLight(0xffffff, 2.15);
  light.position.set(4, 8, 7);
  scene.add(light);
  const light2 = new THREE.DirectionalLight(0xffffff, 0.9);
  light2.position.set(-5, 3, -4);
  scene.add(light2);

  const camera = new THREE.PerspectiveCamera(35, 1, 0.01, 10000);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.screenSpacePanning = true;
  controls.minDistance = 0.01;
  controls.maxDistance = 10000;
  controls.autoRotate = false;

  let model = null;
  // Contours standard Three.js : plus legers et compatibles avec les gros GLB.
  const outlineMaterial = new THREE.LineBasicMaterial({
    color: 0x111111, transparent: false, depthTest: true, depthWrite: false
  });

  function resize() {
    const w = container.clientWidth;
    const h = container.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  const observer = new ResizeObserver(resize);
  observer.observe(container);
  resize();

  function fitView() {
    if (!model) return;
    const box = new THREE.Box3().setFromObject(model);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const radius = Math.max(size.length() / 2, 0.001);
    const halfFov = THREE.MathUtils.degToRad(camera.fov) / 2;
    const horizontalHalfFov = Math.atan(Math.tan(halfFov) * Math.max(camera.aspect, 0.1));
    const distance = radius / Math.sin(Math.min(halfFov, horizontalHalfFov)) * 1.2;
    camera.near = Math.max(distance / 1000, 0.00001);
    camera.far = distance * 1000;
    camera.updateProjectionMatrix();
    camera.position.copy(center).add(new THREE.Vector3(distance * 0.8, distance * 0.55, distance));
    controls.target.copy(center);
    controls.minDistance = Math.max(radius * 0.1, 0.001);
    controls.maxDistance = distance * 10;
    controls.update();
  }

  if (reset) reset.addEventListener('click', fitView);
  if (toggle) toggle.addEventListener('change', () => {
    for (const line of state.outlines) line.visible = toggle.checked;
  });

  // Rendu uniquement si l'onglet 3D est visible, pour préserver les ressources.
  let frame = null;
  function render() {
    frame = requestAnimationFrame(render);
    if (!container.getClientRects().length) return;
    controls.update();
    renderer.render(scene, camera);
  }
  render();

  const loader = new GLTFLoader();
  // Browser file:// blocks fetch() for GLB assets. For local browsing we
  // reconstruct the same GLB as a Blob URL from a classic JS asset script.
  // Hosted sites still load the original GLB normally (no extra decoding).
  let objectUrl = null;
  let modelUrl = url;
  if (location.protocol === 'file:') {
    const filename = decodeURIComponent(url.split('/').pop().split('?')[0]).toLowerCase();
    const encoded = window.Brick3DEmbedded?.[filename];
    if (encoded) {
      try {
        const binary = atob(encoded);
        const buffer = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) buffer[i] = binary.charCodeAt(i);
        objectUrl = URL.createObjectURL(new Blob([buffer], { type: 'model/gltf-binary' }));
        modelUrl = objectUrl;
      } catch (err) {
        console.error('Erreur de decodage du GLB embarque:', err);
      }
    }
  }
  loader.load(modelUrl, (gltf) => {
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    model = gltf.scene;
    model.updateMatrixWorld(true);
    scene.add(model);
    // Chaque primitive du GLB conserve ses matériaux, couleurs et textures.
    // Collecter avant d'ajouter les contours (ne pas modifier l'arbre pendant traverse).
    const meshes = [];
    model.traverse((object) => {
      if (object.isMesh && object.geometry) meshes.push(object);
    });
    for (const object of meshes) {
      try {
        const edges = new THREE.EdgesGeometry(object.geometry, 32);
        if (!edges.attributes.position || edges.attributes.position.count === 0) {
          edges.dispose();
          continue;
        }
        const outlines = new THREE.LineSegments(edges, outlineMaterial);
        outlines.name = 'Brick outlines';
        outlines.frustumCulled = false;
        outlines.renderOrder = 1;
        outlines.visible = toggle ? toggle.checked : true;
        object.add(outlines);
        state.outlines.push(outlines);
      } catch (outlineError) {
        console.warn('Contours non generes pour une piece; modele conserve :', outlineError);
      }
    }
    resize();
    fitView();
    state.loaded = true;
    message.hidden = true;
  }, undefined, (error) => {
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    console.error('GLB loading error:', error);
    message.textContent = 'Erreur de chargement 3D : ' + (error?.message || String(error)) + '. Consulte la console (F12) pour les détails.';
  });
}

window.Brick3D = { mount };
window.dispatchEvent(new Event('brick3d-ready'));
