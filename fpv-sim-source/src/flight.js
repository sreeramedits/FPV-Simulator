import * as THREE from 'three';
import { bfRate } from './rates.js';

const G = 9.81;
const D2R = Math.PI / 180;
export const SUBSTEP = 1 / 480;

export class Quad {
  constructor(cfg, world) {
    this.cfg = cfg;           // live reference to settings
    this.world = world;
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.q = new THREE.Quaternion();
    this.w = new THREE.Vector3();          // body-frame angular velocity (rad/s): x pitch, y yaw, z roll
    this.thrust = 0;                       // N, motor-lag filtered
    this.thrustFrac = 0;
    this.armed = false;
    this.crashed = false;
    this.crashTimer = 0;
    this.contact = false;
    this.flightTime = 0;
    this.lastImpact = 0;
    this.spawn = { pos: new THREE.Vector3(), yaw: 0 };
    this.resetCount = 0;
    this._n = new THREE.Vector3();
    this._hit = { dist: 0, normal: new THREE.Vector3() };
    this._prev = new THREE.Vector3();
    this._v = new THREE.Vector3();
    this._qd = new THREE.Quaternion();
    this._qi = new THREE.Quaternion();
    this._f = new THREE.Vector3();
    this._up = new THREE.Vector3();
  }

  setSpawn(pos, yaw) { this.spawn.pos.copy(pos); this.spawn.yaw = yaw; this.reset(); }

  reset() {
    this.pos.copy(this.spawn.pos);
    this.vel.set(0, 0, 0);
    this.q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), this.spawn.yaw);
    this.w.set(0, 0, 0);
    this.thrust = 0; this.thrustFrac = 0;
    this.crashed = false; this.crashTimer = 0;
    this.flightTime = 0;
    this.armed = false;
    this.resetCount++;
  }

  crash() {
    if (this.crashed) return;
    this.crashed = true;
    this.crashTimer = 0;
    const s = 6 + Math.random() * 8;
    this.w.set((Math.random() - 0.5) * s, (Math.random() - 0.5) * s, (Math.random() - 0.5) * s);
  }

  // one fixed physics step
  step(dt, ctl) {
    const c = this.cfg, d = c.drone;
    const live = this.armed && !this.crashed;

    // --- angular rate controller (first-order response to Betaflight-style rates)
    if (live) {
      const tgt = this._v.set(
        -bfRate(ctl.pitch, c.rates.pitch) * D2R,
        -bfRate(ctl.yaw, c.rates.yaw) * D2R,
        -bfRate(ctl.roll, c.rates.roll) * D2R,
      );
      const a = 1 - Math.exp(-dt / 0.03);
      this.w.x += (tgt.x - this.w.x) * a;
      this.w.y += (tgt.y - this.w.y) * a;
      this.w.z += (tgt.z - this.w.z) * a;
    } else {
      this.w.multiplyScalar(Math.exp(-(this.crashed ? 0.6 : 6) * dt));
    }

    // --- motors / thrust (non-linear throttle->thrust, lagged)
    const thr = live ? ctl.throttle : 0;
    const k = d.thrustExpo;
    const frac = thr * (1 - k) + thr * thr * k;
    const target = frac * d.twr * d.mass * G;
    this.thrust += (target - this.thrust) * (1 - Math.exp(-dt / 0.035));
    this.thrustFrac = this.thrust / (d.twr * d.mass * G);

    // --- forces
    const up = this._up.set(0, 1, 0).applyQuaternion(this.q);
    const f = this._f.copy(up).multiplyScalar(this.thrust);
    this._qi.copy(this.q).invert();
    const vb = this._v.copy(this.vel).applyQuaternion(this._qi);
    const m = d.drag;
    const fx = -(0.010 * Math.abs(vb.x) + 0.004) * vb.x * m;
    const fy = -(0.020 * Math.abs(vb.y) + 0.006) * vb.y * m;
    const fz = -(0.0065 * Math.abs(vb.z) + 0.004) * vb.z * m;
    const drag = this._v.set(fx, fy, fz).applyQuaternion(this.q);
    f.add(drag);
    this.vel.addScaledVector(f, dt / d.mass);
    this.vel.y -= G * dt;

    // --- integrate
    this._prev.copy(this.pos);
    this.pos.addScaledVector(this.vel, dt);
    const ang = this.w.length() * dt;
    if (ang > 1e-9) {
      this._qd.setFromAxisAngle(this._v.copy(this.w).normalize(), ang);
      this.q.multiply(this._qd).normalize();
    }

    // --- collisions
    this.contact = false;
    const R = d.radius;
    let n = this._n;
    const speed = this.vel.length();
    if (speed * dt > R * 0.5 && this.world.sweep(this._prev, this.pos, R, this._hit)) {
      this.pos.copy(this._prev).addScaledVector(this.vel, Math.max(0, this._hit.dist - R) / Math.max(speed, 1e-6));
      n.copy(this._hit.normal);
      this._respond(n, dt);
    }
    if (this.world.collide(this.pos, R, n) > 0) this._respond(n, dt);

    if (live) this.flightTime += dt;
    if (this.crashed) this.crashTimer += dt;
  }

  _respond(n, dt) {
    this.contact = true;
    const vn = this.vel.dot(n);
    if (vn < 0) {
      const impact = -vn;
      this.lastImpact = impact;
      const cr = this.cfg.crash;
      if (cr.enabled && !this.crashed && impact > cr.speed) this.crash();
      const e = this.crashed ? 0.35 : 0.15;
      this.vel.addScaledVector(n, -(1 + e) * vn);
    }
    // surface friction + rotational damping while touching
    const vnow = this.vel.dot(n);
    const tangent = this._v.copy(this.vel).addScaledVector(n, -vnow);
    tangent.multiplyScalar(-Math.min(1, 5 * dt));
    this.vel.add(tangent);
    this.w.multiplyScalar(1 - Math.min(1, 10 * dt));
  }
}
