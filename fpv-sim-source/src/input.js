// Radio/gamepad + keyboard input. Output sticks: roll/pitch/yaw in -1..1
// (roll right +, pitch forward +, yaw right +), throttle 0..1.
const dz = (v, d = 0.02) => (Math.abs(v) < d ? 0 : v);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

export class Input {
  constructor(settings) {
    this.s = settings;
    this.keys = new Set();
    this.kb = { roll: 0, pitch: 0, yaw: 0, throttle: 0 };
    this.out = { roll: 0, pitch: 0, yaw: 0, throttle: 0, armSwitch: null, resetEdge: false, source: 'keyboard', padName: '' };
    this.raw = [];
    this.buttons = [];
    this._prevReset = false;
    this.assign = null; // { fn, base, kind }
    this.onAssigned = null;
    this.pressedOnce = new Set();
    addEventListener('keydown', (e) => {
      if (e.repeat) return;
      this.keys.add(e.code);
      this.pressedOnce.add(e.code);
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => this.keys.clear());
  }

  consumeKey(code) {
    const had = this.pressedOnce.has(code);
    this.pressedOnce.delete(code);
    return had;
  }

  pad() {
    const pads = (navigator.getGamepads && navigator.getGamepads()) || [];
    let best = null;
    for (const p of pads) {
      if (!p || !p.connected) continue;
      if (!best || p.axes.length > best.axes.length) best = p;
    }
    return best;
  }

  startAssign(fn, kind) {
    const p = this.pad();
    this.assign = { fn, kind, base: p ? [...p.axes] : [], btnBase: p ? p.buttons.map((b) => b.pressed) : [] };
  }

  _pollAssign(p) {
    const a = this.assign;
    if (!a || !p) return;
    if (a.kind === 'axis') {
      let best = -1, bestD = 0.45;
      p.axes.forEach((v, i) => {
        const d = Math.abs(v - (a.base[i] ?? 0));
        if (d > bestD) { bestD = d; best = i; }
      });
      if (best >= 0) {
        const delta = p.axes[best] - (a.base[best] ?? 0);
        this.s.mapping[a.fn] = { axis: best, inv: delta < 0 };
        this.assign = null;
        this.onAssigned && this.onAssigned(a.fn);
      }
    } else {
      const idx = p.buttons.findIndex((b, i) => b.pressed && !a.btnBase[i]);
      if (idx >= 0) {
        this.s.mapping[a.fn] = { button: idx };
        this.assign = null;
        this.onAssigned && this.onAssigned(a.fn);
      }
    }
  }

  update(dt) {
    const o = this.out;
    const p = this.pad();
    o.resetEdge = false;
    if (p) {
      this.raw = [...p.axes];
      this.buttons = p.buttons.map((b) => b.pressed);
      this._pollAssign(p);
      const m = this.s.mapping;
      const get = (c) => {
        const v = p.axes[c.axis] ?? 0;
        return c.inv ? -v : v;
      };
      o.roll = dz(clamp(get(m.roll), -1, 1));
      o.pitch = dz(clamp(get(m.pitch), -1, 1));
      o.yaw = dz(clamp(get(m.yaw), -1, 1));
      o.throttle = clamp((get(m.throttle) + 1) / 2, 0, 1);
      o.armSwitch = m.arm.button >= 0 ? !!p.buttons[m.arm.button]?.pressed : null;
      const rb = m.reset.button >= 0 ? !!p.buttons[m.reset.button]?.pressed : false;
      o.resetEdge = rb && !this._prevReset;
      this._prevReset = rb;
      o.source = 'radio';
      o.padName = p.id;
    } else {
      this.raw = []; this.buttons = [];
      const k = this.keys, kb = this.kb;
      const t = (pos, neg) => (k.has(pos) ? 1 : 0) - (k.has(neg) ? 1 : 0);
      const tgt = { roll: t('ArrowRight', 'ArrowLeft'), pitch: t('ArrowUp', 'ArrowDown'), yaw: t('KeyD', 'KeyA') + t('KeyE', 'KeyQ') };
      const a = 1 - Math.exp(-dt / 0.07);
      for (const n of ['roll', 'pitch', 'yaw']) kb[n] += (clamp(tgt[n], -1, 1) - kb[n]) * a;
      const thrIn = t('KeyW', 'KeyS');
      kb.throttle = clamp(kb.throttle + thrIn * 0.9 * dt, 0, 1);
      if (k.has('ShiftLeft') && !thrIn) kb.throttle = clamp(kb.throttle - 1.5 * dt, 0, 1);
      o.roll = kb.roll; o.pitch = kb.pitch; o.yaw = kb.yaw; o.throttle = kb.throttle;
      o.armSwitch = null; o.source = 'keyboard'; o.padName = '';
    }
    if (this.consumeKey('KeyR')) o.resetEdge = true;
    return o;
  }
}
