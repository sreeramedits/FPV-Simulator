import { saveSettings, resetSettings } from './settings.js';

const $ = (id) => document.getElementById(id);

export function buildPanel(settings, input, onChange) {
  const panel = $('panel');
  const mk = (html) => { const d = document.createElement('div'); d.innerHTML = html; return d; };
  const sliders = [];

  function slider(label, get, set, min, max, step, fmt = (v) => v.toFixed(2)) {
    const id = 'sl' + sliders.length;
    const el = mk(`<label>${label}<input type="range" id="${id}" min="${min}" max="${max}" step="${step}"><span class="val"></span></label>`);
    const inp = el.querySelector('input'), val = el.querySelector('.val');
    const sync = () => { inp.value = get(); val.textContent = fmt(get()); };
    inp.addEventListener('input', () => { set(parseFloat(inp.value)); val.textContent = fmt(get()); saveSettings(settings); onChange(); });
    sliders.push(sync); sync();
    return el;
  }
  function check(label, get, set) {
    const el = mk(`<label>${label}<input type="checkbox"><span></span></label>`);
    const inp = el.querySelector('input');
    const sync = () => { inp.checked = get(); };
    inp.addEventListener('change', () => { set(inp.checked); saveSettings(settings); onChange(); });
    sliders.push(sync); sync();
    return el;
  }

  const root = document.createElement('div');
  root.appendChild(mk('<b style="font-size:14px">SETTINGS</b> <span style="opacity:.6">(Tab to close, auto-saved)</span>'));

  // ---- radio mapping
  root.appendChild(mk('<h3>Radio / gamepad setup</h3>'));
  const info = mk('<div id="padinfo" style="opacity:.8;margin-bottom:6px">No radio detected. Plug it in (USB joystick mode) and move a stick.</div>');
  root.appendChild(info);
  const rows = {};
  const defs = [
    ['roll', 'axis', 'Roll → move stick RIGHT'], ['pitch', 'axis', 'Pitch → push stick FORWARD'],
    ['yaw', 'axis', 'Yaw → yaw RIGHT'], ['throttle', 'axis', 'Throttle → push UP'],
    ['arm', 'button', 'Arm switch (optional)'], ['reset', 'button', 'Reset button (optional)'],
  ];
  for (const [fn, kind, hint] of defs) {
    const el = mk(`<div class="row"><span class="n">${fn.toUpperCase()}</span><span class="ax" id="ax_${fn}"></span><button>Assign</button></div><div style="opacity:.55;margin:-2px 0 4px">${hint}</div>`);
    el.querySelector('button').addEventListener('click', () => {
      input.startAssign(fn, kind);
      rows[fn].textContent = kind === 'axis' ? 'move it…' : 'press it…';
    });
    root.appendChild(el);
    rows[fn] = el.querySelector('.ax');
  }
  const invRow = mk('<div class="row"><span class="n">Invert</span></div>');
  for (const fn of ['roll', 'pitch', 'yaw', 'throttle']) {
    const l = document.createElement('label');
    l.style.cssText = 'display:inline-flex;gap:3px;grid-template-columns:none';
    l.innerHTML = `${fn[0].toUpperCase()}<input type="checkbox">`;
    const inp = l.querySelector('input');
    inp.addEventListener('change', () => { settings.mapping[fn].inv = inp.checked; saveSettings(settings); });
    sliders.push(() => { inp.checked = settings.mapping[fn].inv; });
    invRow.appendChild(l);
  }
  root.appendChild(invRow);
  const live = mk('<div id="liveaxes" style="font-size:11px;opacity:.7;margin-top:4px"></div>');
  root.appendChild(live);

  // ---- rates
  root.appendChild(mk('<h3>Rates (Betaflight style)</h3>'));
  for (const ax of ['roll', 'pitch', 'yaw']) {
    root.appendChild(slider(`${ax} RC rate`, () => settings.rates[ax].rc, (v) => (settings.rates[ax].rc = v), 0.2, 2, 0.01));
    root.appendChild(slider(`${ax} super`, () => settings.rates[ax].super, (v) => (settings.rates[ax].super = v), 0, 0.95, 0.01));
    root.appendChild(slider(`${ax} expo`, () => settings.rates[ax].expo, (v) => (settings.rates[ax].expo = v), 0, 1, 0.01));
  }
  root.appendChild(mk('<h3>Camera</h3>'));
  root.appendChild(slider('Camera tilt °', () => settings.cam.tilt, (v) => (settings.cam.tilt = v), 0, 60, 1, (v) => v.toFixed(0)));
  root.appendChild(slider('FOV (vertical °)', () => settings.cam.fov, (v) => (settings.cam.fov = v), 50, 130, 1, (v) => v.toFixed(0)));
  root.appendChild(mk('<h3>Quad</h3>'));
  root.appendChild(slider('Thrust : weight', () => settings.drone.twr, (v) => (settings.drone.twr = v), 2, 14, 0.1, (v) => v.toFixed(1)));
  root.appendChild(slider('Mass kg', () => settings.drone.mass, (v) => (settings.drone.mass = v), 0.2, 1.5, 0.01));
  root.appendChild(slider('Throttle curve', () => settings.drone.thrustExpo, (v) => (settings.drone.thrustExpo = v), 0, 1, 0.01));
  root.appendChild(slider('Air drag ×', () => settings.drone.drag, (v) => (settings.drone.drag = v), 0.2, 3, 0.05));
  root.appendChild(slider('Model scale (m/unit)', () => settings.drone.scale, (v) => (settings.drone.scale = v), 0.02, 0.2, 0.005, (v) => v.toFixed(3)));
  root.appendChild(mk('<h3>Crashes</h3>'));
  root.appendChild(check('Crashes enabled', () => settings.crash.enabled, (v) => (settings.crash.enabled = v)));
  root.appendChild(slider('Crash impact m/s', () => settings.crash.speed, (v) => (settings.crash.speed = v), 2, 25, 0.5, (v) => v.toFixed(1)));
  root.appendChild(check('Auto reset', () => settings.crash.autoReset, (v) => (settings.crash.autoReset = v)));
  const btn = mk('<div class="row" style="margin-top:14px"><button id="rstS">Reset all settings</button></div>');
  btn.querySelector('button').addEventListener('click', () => {
    const d = resetSettings();
    for (const k of Object.keys(d)) settings[k] = d[k];
    sliders.forEach((f) => f()); onChange();
  });
  root.appendChild(btn);
  panel.appendChild(root);

  input.onAssigned = (fn) => { saveSettings(settings); sliders.forEach((f) => f()); };

  return {
    toggle() { panel.style.display = panel.style.display === 'block' ? 'none' : 'block'; },
    isOpen: () => panel.style.display === 'block',
    refresh() {
      if (panel.style.display !== 'block') return;
      const m = settings.mapping;
      $('padinfo').textContent = input.out.source === 'radio' ? `Detected: ${input.out.padName}` : 'No radio detected — using keyboard. Plug in your radio (USB joystick mode) and move a stick.';
      for (const [fn, kind] of defs) {
        if (input.assign && input.assign.fn === fn) continue;
        const c = m[fn];
        rows[fn].textContent = kind === 'axis' ? `axis ${c.axis}${c.inv ? ' (inv)' : ''}` : (c.button >= 0 ? `btn ${c.button}` : 'unset');
      }
      $('liveaxes').textContent = input.raw.length ? 'axes: ' + input.raw.map((v, i) => `${i}:${v.toFixed(2)}`).join('  ') : '';
    },
  };
}
