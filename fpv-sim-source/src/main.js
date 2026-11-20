import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { World } from './world.js';
import { Quad, SUBSTEP } from './flight.js';
import { Input } from './input.js';
import { loadSettings } from './settings.js';
import { buildPanel } from './ui.js';

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const settings = loadSettings();

// ---------- renderer / scene
const canvas = $('gl');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
const scene = new THREE.Scene();
const SKY = 0xa9cdee;
scene.fog = new THREE.Fog(SKY, 250, 1100);

// gradient sky dome that follows the camera
const sky = new THREE.Mesh(
  new THREE.SphereGeometry(1500, 24, 16),
  new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { top: { value: new THREE.Color(0x3d7fc8) }, mid: { value: new THREE.Color(SKY) }, bot: { value: new THREE.Color(0x8fa6b8) } },
    vertexShader: 'varying vec3 vP; void main(){ vP=normalize(position); gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }',
    fragmentShader: 'uniform vec3 top,mid,bot; varying vec3 vP; void main(){ float h=vP.y; vec3 c = h>0. ? mix(mid,top,pow(h,.6)) : mix(mid,bot,pow(-h,.5)); gl_FragColor=vec4(c,1.); }',
  }),
);
sky.renderOrder = -1;
scene.add(sky);
scene.add(new THREE.HemisphereLight(0xdfeeff, 0x6b6558, 1.5));
const sun = new THREE.DirectionalLight(0xfff1d6, 2.2);
sun.position.set(120, 220, 80);
scene.add(sun);

const camera = new THREE.PerspectiveCamera(settings.cam.fov, innerWidth / innerHeight, 0.03, 3000);
function resize() {
  renderer.setSize(innerWidth, innerHeight, false);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize); resize();

// ---------- loading
const loader = new GLTFLoader();
const prog = { drone: 0, map: 0 };
const setProg = () => { $('lbar').style.width = ((prog.drone + prog.map) / 2) * 100 + '%'; };
const load = (url, key) => loader.loadAsync(url, (e) => { if (e.total) { prog[key] = e.loaded / e.total; setProg(); } });
let droneGltf, mapGltf;
try {
  [droneGltf, mapGltf] = await Promise.all([load('models/drone.glb', 'drone'), load('models/map.glb', 'map')]);
} catch (err) {
  $('ltxt').textContent = 'Failed to load models: ' + err.message;
  throw err;
}
$('ltxt').textContent = 'Building collision…';
await new Promise((r) => setTimeout(r, 30));

// ---------- map + collision world
const mapRoot = mapGltf.scene;
scene.add(mapRoot);
const world = new World(mapRoot);

// ---------- drone model (rotated so model +Z nose -> sim -Z forward; props spin about their own axis)
const droneRoot = new THREE.Group();
scene.add(droneRoot);
const modelScale = new THREE.Group();
droneRoot.add(modelScale);
const model = droneGltf.scene;
const props = [];
{
  model.updateMatrixWorld(true);
  const meshes = [];
  model.traverse((o) => { if (o.isMesh) meshes.push(o); });
  for (const m of meshes) {
    if (!/^Prop4in/i.test(m.name)) continue;
    const box = new THREE.Box3().setFromObject(m);
    const c = box.getCenter(new THREE.Vector3());
    const pivot = new THREE.Object3D();
    model.add(pivot);
    pivot.position.copy(c);
    pivot.updateMatrixWorld(true);
    pivot.attach(m);
    props.push({ pivot, dir: c.x * c.z > 0 ? 1 : -1 });
  }
  const bb = new THREE.Box3().setFromObject(model);
  const ctr = bb.getCenter(new THREE.Vector3());
  model.position.sub(ctr);
  model.traverse((o) => { if (o.isMesh) { o.frustumCulled = false; } });
  modelScale.rotation.y = Math.PI;
  modelScale.add(model);
  model.userData.width = bb.getSize(new THREE.Vector3()).x;
}
function applyScale() {
  // settings.drone.scale = metres per model unit
  modelScale.scale.setScalar(settings.drone.scale);
}

// ---------- spawn
const SPAWN = { x: 35, z: 44, yaw: -Math.PI / 2 };
if (params.get('sx')) { SPAWN.x = +params.get('sx'); SPAWN.z = +params.get('sz'); SPAWN.yaw = (+params.get('sy') || 0) * Math.PI / 180; }
const quad = new Quad(settings, world);
function placeSpawn() {
  const gy = world.groundHeight(SPAWN.x, SPAWN.z) ?? 0;
  quad.setSpawn(new THREE.Vector3(SPAWN.x, gy + settings.drone.radius + 0.02, SPAWN.z), SPAWN.yaw);
}
placeSpawn();

// ---------- input / UI
const input = new Input(settings);
const panel = buildPanel(settings, input, () => { applyScale(); camera.fov = settings.cam.fov; camera.updateProjectionMatrix(); });
applyScale();

const CAMS = ['FPV', 'CHASE', 'TRACKER'];
let camMode = Math.max(0, CAMS.indexOf((params.get('cam') || 'fpv').toUpperCase()));
let hudOn = true;
const chase = { pos: new THREE.Vector3(), heading: 0, init: false };
const tracker = { pos: new THREE.Vector3(), init: false };
let armRequest = true;
const tmpV = new THREE.Vector3(), tmpV2 = new THREE.Vector3(), tmpQ = new THREE.Quaternion();
const tiltQ = new THREE.Quaternion();

// debug hooks for headless tests
window.sim = { quad, world, input, settings, camera, scene, setCam: (i) => (camMode = i), override: null, SPAWN, placeSpawn };

$('loading').style.display = 'none';

// ---------- main loop
let last = performance.now(), acc = 0, fpsAcc = 0, fpsN = 0, fps = 0;
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  fpsAcc += dt; fpsN++; if (fpsAcc > 0.5) { fps = fpsN / fpsAcc; fpsAcc = 0; fpsN = 0; }

  const ctl = input.update(dt);
  if (window.sim.override) Object.assign(ctl, window.sim.override);
  if (input.consumeKey('Tab')) panel.toggle();
  if (input.consumeKey('KeyC')) camMode = (camMode + 1) % CAMS.length;
  if (input.consumeKey('KeyH')) { hudOn = !hudOn; $('hud').style.display = hudOn ? 'block' : 'none'; }
  if (input.consumeKey('Space')) { armRequest = !armRequest; if (!armRequest) quad.armed = false; }
  if (ctl.resetEdge) { quad.reset(); armRequest = true; }

  // arming: switch (if mapped) or Space; requires low throttle
  const wantArm = ctl.armSwitch === null ? armRequest : ctl.armSwitch;
  if (!wantArm) quad.armed = false;
  else if (!quad.armed && !quad.crashed && ctl.throttle < 0.08) quad.armed = true;
  const throttleBlock = wantArm && !quad.armed && !quad.crashed && ctl.throttle >= 0.08;

  acc += dt;
  let steps = 0;
  while (acc >= SUBSTEP && steps < 40) { quad.step(SUBSTEP, ctl); acc -= SUBSTEP; steps++; }
  if (steps >= 40) acc = 0;

  // respawn conditions
  const b = world.bounds;
  if (quad.pos.y < b.min.y + 10 || quad.pos.y > b.max.y + 400 || Math.abs(quad.pos.x) > 700 || Math.abs(quad.pos.z) > 700) { quad.reset(); }
  if (quad.crashed && settings.crash.autoReset && quad.crashTimer > settings.crash.resetDelay) quad.reset();

  // drone model
  droneRoot.position.copy(quad.pos);
  droneRoot.quaternion.copy(quad.q);
  for (const p of props) p.pivot.rotation.y += p.dir * (quad.armed && !quad.crashed ? 25 + 60 * Math.sqrt(quad.thrustFrac) : 0) * dt;
  droneRoot.visible = camMode !== 0;

  updateCamera(dt);
  sky.position.copy(camera.position);
  renderer.render(scene, camera);
  updateHud(ctl, throttleBlock, fps);
  panel.refresh();
}

function updateCamera(dt) {
  camera.fov = settings.cam.fov;
  const dbg = window.sim.dbg;
  if (dbg) { camera.position.set(...dbg.pos); camera.up.set(...(dbg.up || [0, 1, 0])); camera.lookAt(...dbg.look); camera.fov = dbg.fov || 50; camera.updateProjectionMatrix(); droneRoot.visible = true; return; }
  if (camMode === 0) {
    camera.position.copy(tmpV.set(0, 0.025, -0.07).applyQuaternion(quad.q).add(quad.pos));
    tiltQ.setFromAxisAngle(tmpV2.set(1, 0, 0), settings.cam.tilt * Math.PI / 180);
    camera.quaternion.copy(quad.q).multiply(tiltQ);
  } else if (camMode === 1) {
    const fwd = tmpV.set(0, 0, -1).applyQuaternion(quad.q);
    const hd = Math.atan2(-fwd.x, -fwd.z);
    if (!chase.init) { chase.heading = hd; chase.init = true; }
    let dh = hd - chase.heading; dh = Math.atan2(Math.sin(dh), Math.cos(dh));
    chase.heading += dh * (1 - Math.exp(-dt * 4));
    const dist = Math.max(0.9, settings.drone.scale * 22);
    tmpV2.set(Math.sin(chase.heading) * dist, dist * 0.35, Math.cos(chase.heading) * dist).add(quad.pos);
    camera.position.lerp(tmpV2, 1 - Math.exp(-dt * 10));
    camera.lookAt(quad.pos);
  } else {
    if (!tracker.init || tracker.pos.distanceTo(quad.pos) > 45 || quad.resetCount !== tracker._rc) {
      tracker._rc = quad.resetCount;
      const back = tmpV.copy(quad.vel).setY(0);
      if (back.lengthSq() < 1) back.set(Math.sin(quad.spawn.yaw), 0, Math.cos(quad.spawn.yaw)); else back.normalize().negate();
      tracker.pos.copy(quad.pos).addScaledVector(back, 6).add(tmpV2.set(0, 2.2, 0));
      tracker.init = true;
    }
    camera.position.copy(tracker.pos);
    camera.lookAt(quad.pos);
    camera.fov = THREE.MathUtils.clamp(70 - camera.position.distanceTo(quad.pos) * 1.2, 18, 70);
  }
  camera.updateProjectionMatrix();
}

const stickL = $('sL').firstElementChild, stickR = $('sR').firstElementChild;
let altCache = 0, altT = 0;
function updateHud(ctl, throttleBlock, fps) {
  if (!hudOn) return;
  const spd = quad.vel.length() * 3.6;
  altT -= 1; if (altT <= 0) { altCache = world.heightBelow(quad.pos) ?? 0; altT = 6; }
  $('spd').textContent = `SPEED ${spd.toFixed(0)} km/h`;
  $('alt').textContent = `ALT   ${Math.max(0, altCache - settings.drone.radius).toFixed(1)} m`;
  const t = quad.flightTime; $('tm').textContent = `TIME  ${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
  $('cam').textContent = `CAM ${CAMS[camMode]}  ·  ${settings.cam.tilt}° tilt`;
  $('pad').textContent = input.out.source === 'radio' ? 'RADIO ✓' : 'KEYBOARD';
  $('fps').textContent = `${fps.toFixed(0)} fps`;
  const st = $('status');
  st.textContent = quad.crashed ? 'CRASHED' : throttleBlock ? 'THROTTLE HIGH – LOWER IT TO ARM' : !quad.armed ? 'DISARMED  (Space to arm)' : '';
  st.style.color = quad.crashed ? '#ff4040' : '#ffcc33';
  stickL.style.left = 50 + ctl.yaw * 45 + '%'; stickL.style.top = 50 - (ctl.throttle * 2 - 1) * 45 + '%';
  stickR.style.left = 50 + ctl.roll * 45 + '%'; stickR.style.top = 50 - ctl.pitch * 45 + '%';
}
requestAnimationFrame(frame);
