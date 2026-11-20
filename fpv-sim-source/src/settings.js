const KEY = 'fpv-sim-settings-v2';

export const DEFAULTS = {
  rates: {
    roll:  { rc: 1.0, super: 0.70, expo: 0.0 },
    pitch: { rc: 1.0, super: 0.70, expo: 0.0 },
    yaw:   { rc: 1.0, super: 0.70, expo: 0.0 },
  },
  cam:   { tilt: 30, fov: 90 },
  drone: { mass: 0.55, twr: 7.0, thrustExpo: 0.5, drag: 1.0, scale: 0.05, radius: 0.13 },
  crash: { enabled: true, speed: 12.0, autoReset: true, resetDelay: 1.5 },
  mapping: {
    roll:     { axis: 0, inv: false },
    pitch:    { axis: 1, inv: true },
    throttle: { axis: 2, inv: false },
    yaw:      { axis: 3, inv: false },
    arm:      { button: -1 },
    reset:    { button: -1 },
  },
};

function merge(base, over) {
  if (typeof base !== 'object' || base === null) return over === undefined ? base : over;
  const out = Array.isArray(base) ? [...base] : { ...base };
  for (const k of Object.keys(base)) {
    out[k] = merge(base[k], over && over[k] !== undefined ? over[k] : undefined);
  }
  return out;
}

export function loadSettings() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return merge(DEFAULTS, JSON.parse(raw));
  } catch (e) { /* ignore */ }
  return merge(DEFAULTS, {});
}

export function saveSettings(s) {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch (e) { /* ignore */ }
}

export function resetSettings() {
  try { localStorage.removeItem(KEY); } catch (e) { /* ignore */ }
  return merge(DEFAULTS, {});
}
