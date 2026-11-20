// Betaflight "Betaflight" rates type: returns deg/s for a stick in -1..1
export function bfRate(stick, r) {
  const a = Math.abs(stick);
  const cmd = stick * Math.pow(a, 3) * r.expo + stick * (1 - r.expo);
  const rc = Math.min(2, r.rc);
  const sf = 1 / Math.min(1, Math.max(0.01, 1 - a * r.super));
  return 200 * rc * cmd * sf;
}
