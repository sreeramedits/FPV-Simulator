import * as THREE from 'three';
import { MeshBVH } from 'three-mesh-bvh';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

// Collision world built from every mesh of the map (world space, position only).
export class World {
  constructor(mapScene) {
    mapScene.updateMatrixWorld(true);
    const geos = [];
    mapScene.traverse((o) => {
      if (!o.isMesh || !o.geometry) return;
      const src = o.geometry;
      const pos = src.getAttribute('position');
      const arr = new Float32Array(pos.count * 3);
      for (let i = 0; i < pos.count; i++) {
        arr[i * 3] = pos.getX(i); arr[i * 3 + 1] = pos.getY(i); arr[i * 3 + 2] = pos.getZ(i);
      }
      let g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(arr, 3));
      if (src.index) g.setIndex(Array.from(src.index.array));
      if (g.index) g = g.toNonIndexed();
      g.applyMatrix4(o.matrixWorld);
      geos.push(g);
    });
    this.geometry = mergeGeometries(geos, false);
    geos.forEach((g) => g.dispose());
    this.bvh = new MeshBVH(this.geometry, { maxLeafSize: 12 });
    this.geometry.computeBoundingBox();
    this.bounds = this.geometry.boundingBox.clone();
    this._sphere = new THREE.Sphere();
    this._tmp = new THREE.Vector3();
    this._tmpN = new THREE.Vector3();
    this._ray = new THREE.Ray();
  }

  // Height of the first surface below (x, fromY, z); null if none.
  groundHeight(x, z, fromY = 400) {
    this._ray.origin.set(x, fromY, z);
    this._ray.direction.set(0, -1, 0);
    const h = this.bvh.raycastFirst(this._ray, THREE.DoubleSide, 0, 2000);
    return h ? h.point.y : null;
  }

  heightBelow(pos) {
    this._ray.origin.copy(pos);
    this._ray.direction.set(0, -1, 0);
    const h = this.bvh.raycastFirst(this._ray, THREE.DoubleSide, 0, 2000);
    return h ? h.distance : null;
  }

  // Push a sphere out of the geometry. Mutates `pos`. Returns max penetration (0 = no contact);
  // outN receives the averaged contact normal (unit).
  collide(pos, R, outN) {
    outN.set(0, 0, 0);
    let maxDepth = 0;
    const sphere = this._sphere, tmp = this._tmp, n = this._tmpN;
    for (let it = 0; it < 3; it++) {
      sphere.center.copy(pos);
      sphere.radius = R;
      let deepest = 0;
      const bestN = new THREE.Vector3();
      this.bvh.shapecast({
        intersectsBounds: (box) => box.intersectsSphere(sphere),
        intersectsTriangle: (tri) => {
          tri.closestPointToPoint(sphere.center, tmp);
          const d = tmp.distanceTo(sphere.center);
          if (d < R) {
            const depth = R - d;
            if (d < 1e-6) tri.getNormal(n); else n.subVectors(sphere.center, tmp).divideScalar(d);
            if (depth > deepest) { deepest = depth; bestN.copy(n); }
            outN.addScaledVector(n, depth);
          }
          return false;
        },
      });
      if (deepest <= 1e-5) break;
      pos.addScaledVector(bestN, deepest + 1e-4);
      maxDepth = Math.max(maxDepth, deepest);
    }
    if (maxDepth > 0) {
      if (outN.lengthSq() < 1e-12) outN.set(0, 1, 0); else outN.normalize();
    }
    return maxDepth;
  }

  // Swept check from a to b for thin walls. Returns hit (distance, normal) or null.
  sweep(a, b, R, outHit) {
    const d = this._tmp.subVectors(b, a);
    const len = d.length();
    if (len < 1e-6) return false;
    d.divideScalar(len);
    this._ray.origin.copy(a);
    this._ray.direction.copy(d);
    const h = this.bvh.raycastFirst(this._ray, THREE.DoubleSide, 0, len + R * 0.25);
    if (!h || h.distance > len) return false;
    outHit.dist = h.distance;
    outHit.normal.copy(h.face.normal);
    if (outHit.normal.dot(d) > 0) outHit.normal.negate();
    return true;
  }
}
