// FactoryIO Simülatör - Sim Engine
// Tüm simülasyon mantığı burada

const { ipcRenderer } = require('electron');

// ============================================================
// STATE
// ============================================================
const state = {
  running: false,
  speed: 3,
  faulted: false,
  components: [],   // {id, type, x, y, w, h, rotation, props, state}
  items: [],        // üretim ürünleri (konveyörde hareket eden)
  selected: null,   // seçili komponent id
  dragging: null,   // {id, offX, offY} veya {type} (sidebar'dan)
  stats: { total: 0, ok: 0, fault: 0, runSeconds: 0 },
  nextId: 1,
  lastTick: null,
  lastFps: 60,
  frameCount: 0,
  fpsTimer: 0,
  ctxTarget: null,  // sağ tık hedefi
  gridSize: 40,
};

// ============================================================
// CANVAS SETUP
// ============================================================
const canvas = document.getElementById('factory-canvas');
const ctx = canvas.getContext('2d');
const wrap = document.getElementById('canvas-wrap');

function resizeCanvas() {
  canvas.width = wrap.clientWidth;
  canvas.height = wrap.clientHeight;
}
resizeCanvas();
window.addEventListener('resize', resizeCanvas);

// ============================================================
// COMPONENT DEFINITIONS
// ============================================================
const COMP_DEFS = {
  'conveyor-h':    { label: 'Yatay Konveyör', w: 200, h: 60,  color: '#1e3a8a', icon: '➡' },
  'conveyor-v':    { label: 'Dikey Konveyör', w: 60,  h: 200, color: '#1e3a8a', icon: '⬇' },
  'conveyor-turn': { label: 'Dönüş',          w: 80,  h: 80,  color: '#1e3a8a', icon: '↩' },
  'sensor-prox':   { label: 'Proximity',       w: 40,  h: 40,  color: '#065f46', icon: '◎' },
  'sensor-photo':  { label: 'Fotoelektrik',    w: 40,  h: 40,  color: '#065f46', icon: '◈' },
  'sensor-color':  { label: 'Renk Sensörü',    w: 40,  h: 40,  color: '#3b0764', icon: '◐' },
  'actuator-piston':  { label: 'Piston',       w: 50,  h: 80,  color: '#78350f', icon: '⬆' },
  'actuator-arm':     { label: 'Robot Kol',    w: 80,  h: 80,  color: '#78350f', icon: '⟳' },
  'actuator-stopper': { label: 'Kapak',        w: 50,  h: 30,  color: '#7f1d1d', icon: '⊟' },
  'source':        { label: 'Kaynak',           w: 70,  h: 70,  color: '#065f46', icon: '📦' },
  'sink':          { label: 'Çıkış',            w: 70,  h: 70,  color: '#1e3a8a', icon: '🏁' },
  'display':       { label: 'HMI',              w: 100, h: 70,  color: '#252d3f', icon: '📟' },
};

const DEFAULT_PROPS = {
  'conveyor-h':    { hiz: 2, yon: 'sag', aktif: true },
  'conveyor-v':    { hiz: 2, yon: 'asagi', aktif: true },
  'conveyor-turn': { hiz: 2, yon: 'sag-asagi', aktif: true },
  'sensor-prox':   { id: 'S?', tetikMesafe: 30, aktif: true, deger: false },
  'sensor-photo':  { id: 'SF?', tetikMesafe: 40, aktif: true, deger: false },
  'sensor-color':  { id: 'SC?', hedefRenk: 'mavi', aktif: true, deger: false },
  'actuator-piston':  { id: 'A?', stroke: 40, hiz: 3, aktif: false },
  'actuator-arm':     { id: 'AR?', hiz: 2, aktif: false },
  'actuator-stopper': { id: 'ST?', acik: false },
  'source':        { urunAraligi: 3, otoOlustur: true, renk: 'mavi' },
  'sink':          { sayac: 0 },
  'display':       { baslik: 'HMI', gosterim: 'toplam' },
};

// ============================================================
// LOG
// ============================================================
const logLines = [];
function log(msg, type = '') {
  const t = new Date().toLocaleTimeString('tr', { hour12: false });
  logLines.push({ t, msg, type });
  if (logLines.length > 200) logLines.shift();
  const body = document.getElementById('log-body');
  body.innerHTML = logLines.slice().reverse().map(l =>
    `<div class="log-line ${l.type}"><span class="ts">[${l.t}]</span>${l.msg}</div>`
  ).join('');
}
function clearLog() { logLines.length = 0; document.getElementById('log-body').innerHTML = ''; }

// ============================================================
// ADD / REMOVE COMPONENTS
// ============================================================
let sensorCounter = 1, actuatorCounter = 1;

function createComp(type, x, y) {
  const def = COMP_DEFS[type];
  if (!def) return null;
  const props = JSON.parse(JSON.stringify(DEFAULT_PROPS[type] || {}));

  // Auto-name sensors & actuators
  if (type.startsWith('sensor')) { props.id = 'S' + sensorCounter++; }
  if (type.startsWith('actuator')) { props.id = 'A' + actuatorCounter++; }

  // Snap to grid
  x = Math.round(x / state.gridSize) * state.gridSize;
  y = Math.round(y / state.gridSize) * state.gridSize;

  const comp = {
    id: state.nextId++,
    type,
    x, y,
    w: def.w, h: def.h,
    rotation: 0,
    props,
    simState: { active: false, pistonPos: 0, itemOnTop: false, sourceTimer: 0, colorMatch: false },
  };
  state.components.push(comp);
  log(`${def.label} eklendi (${x},${y})`, 'ok');
  updateCompCount();
  checkDropHint();
  return comp;
}

function removeComp(id) {
  const i = state.components.findIndex(c => c.id === id);
  if (i === -1) return;
  const def = COMP_DEFS[state.components[i].type];
  state.components.splice(i, 1);
  if (state.selected === id) { state.selected = null; renderProps(); }
  log(`${def.label} silindi`, 'warn');
  updateCompCount();
  checkDropHint();
}

function addCompClick(type) {
  const cx = (canvas.width / 2 - COMP_DEFS[type].w / 2) + Math.random() * 60 - 30;
  const cy = (canvas.height / 2 - COMP_DEFS[type].h / 2) + Math.random() * 60 - 30;
  const c = createComp(type, cx, cy);
  state.selected = c.id;
  renderProps();
}

function updateCompCount() {
  document.getElementById('componentCount').textContent = state.components.length + ' komponent';
}
function checkDropHint() {
  if (state.components.length > 0) wrap.classList.add('has-items');
  else wrap.classList.remove('has-items');
}

// ============================================================
// SIMULATION LOGIC
// ============================================================
let simInterval = null;

function toggleSim() {
  if (!state.running) startSim(); else stopSim();
}
function startSim() {
  state.running = true;
  state.faulted = false;
  document.getElementById('btnStart').textContent = '⏸ Duraklat';
  document.getElementById('btnStart').className = 'tb-btn stop';
  document.getElementById('sim-dot').className = 'sb-dot green';
  document.getElementById('sim-status').textContent = 'Çalışıyor';
  log('Simülasyon başlatıldı', 'ok');
}
function stopSim() {
  state.running = false;
  document.getElementById('btnStart').textContent = '▶ Başlat';
  document.getElementById('btnStart').className = 'tb-btn active';
  document.getElementById('sim-dot').className = 'sb-dot red';
  document.getElementById('sim-status').textContent = 'Duruyor';
  log('Simülasyon durduruldu');
}
function injectFault() {
  state.faulted = true;
  state.running = false;
  document.getElementById('btnStart').textContent = '▶ Başlat';
  document.getElementById('btnStart').className = 'tb-btn active';
  document.getElementById('sim-dot').className = 'sb-dot amber';
  document.getElementById('sim-status').textContent = 'ARIZA';
  state.stats.fault++;
  log('⚠ ARIZA enjekte edildi! Hat durdu.', 'err');
  updateStats();
}
function setSpeed(v) {
  state.speed = parseInt(v);
  document.getElementById('speedVal').textContent = v;
}
function clearScene() {
  state.components = [];
  state.items = [];
  state.selected = null;
  state.running = false;
  state.faulted = false;
  state.stats = { total: 0, ok: 0, fault: 0, runSeconds: 0 };
  renderProps();
  updateCompCount();
  checkDropHint();
  log('Sahne temizlendi');
  updateStats();
}

// Spawn product from source
function spawnFromSource(src, dt) {
  if (!src.simState) src.simState = { sourceTimer: 0 };
  src.simState.sourceTimer += dt;
  const interval = src.props.urunAraligi || 3;
  if (src.simState.sourceTimer >= interval) {
    src.simState.sourceTimer = 0;
    const colors = { mavi: '#3b82f6', kirmizi: '#ef4444', yesil: '#10b981', sari: '#f59e0b', mor: '#8b5cf6' };
    const clr = colors[src.props.renk] || '#3b82f6';
    state.items.push({
      id: state.nextId++,
      x: src.x + src.w / 2,
      y: src.y + src.h / 2,
      w: 28, h: 28,
      vx: state.speed * 20,
      vy: 0,
      color: clr,
      ok: true,
      delivered: false,
      label: 'P' + state.stats.total,
    });
    state.stats.total++;
    log('Ürün kaynaktan çıktı', 'ok');
    updateStats();
  }
}

// Update items movement along conveyors
function updateItems(dt) {
  state.items.forEach(item => {
    let onConveyor = false;
    state.components.forEach(c => {
      if (item.x + item.w / 2 >= c.x && item.x - item.w / 2 <= c.x + c.w &&
          item.y + item.h / 2 >= c.y && item.y - item.h / 2 <= c.y + c.h) {
        if (c.type === 'conveyor-h' && c.props.aktif) {
          item.vx = (c.props.yon === 'sag' ? 1 : -1) * state.speed * 18;
          item.vy = 0;
          onConveyor = true;
        }
        if (c.type === 'conveyor-v' && c.props.aktif) {
          item.vy = (c.props.yon === 'asagi' ? 1 : -1) * state.speed * 18;
          item.vx = 0;
          onConveyor = true;
        }
        // Stopper
        if (c.type === 'actuator-stopper' && !c.props.acik) {
          item.vx = 0; item.vy = 0;
        }
      }
    });
    if (!onConveyor) { item.vx *= 0.92; item.vy *= 0.92; }
    item.x += item.vx * dt;
    item.y += item.vy * dt;
  });

  // Deliver to sink
  state.items.forEach(item => {
    state.components.forEach(c => {
      if (c.type === 'sink' && !item.delivered) {
        const cx2 = c.x + c.w / 2, cy2 = c.y + c.h / 2;
        if (Math.abs(item.x - cx2) < 35 && Math.abs(item.y - cy2) < 35) {
          item.delivered = true;
          c.props.sayac = (c.props.sayac || 0) + 1;
          state.stats.ok++;
          log(`Ürün ${item.label} teslim edildi ✓`, 'ok');
          updateStats();
        }
      }
    });
  });
  state.items = state.items.filter(i => !i.delivered && i.x > -100 && i.x < canvas.width + 100 && i.y > -100 && i.y < canvas.height + 100);
}

// Update sensors
function updateSensors(dt) {
  state.components.forEach(sensor => {
    if (!sensor.type.startsWith('sensor')) return;
    let triggered = false;
    const sx = sensor.x + sensor.w / 2, sy = sensor.y + sensor.h / 2;
    state.items.forEach(item => {
      const dx = item.x - sx, dy = item.y - sy;
      if (Math.sqrt(dx * dx + dy * dy) < (sensor.props.tetikMesafe || 35)) triggered = true;
    });
    if (triggered !== sensor.simState.active) {
      sensor.simState.active = triggered;
      log(`${sensor.props.id || sensor.type} → ${triggered ? 'ON' : 'OFF'}`, triggered ? 'ok' : '');
      // Trigger linked actuators (same-id logic simple version)
      if (triggered) triggerActuatorsForSensor(sensor);
    }
    sensor.props.deger = triggered;
  });
}

function triggerActuatorsForSensor(sensor) {
  state.components.forEach(c => {
    if (c.type === 'actuator-piston') {
      c.simState.active = true;
      log(`${c.props.id} piston tetiklendi`, 'warn');
      setTimeout(() => { c.simState.active = false; }, 600);
    }
  });
}

// Update actuators visual
function updateActuators(dt) {
  state.components.forEach(c => {
    if (c.type === 'actuator-piston') {
      const target = c.simState.active ? c.props.stroke || 40 : 0;
      c.simState.pistonPos = c.simState.pistonPos + (target - c.simState.pistonPos) * Math.min(1, dt * 6);
    }
    if (c.type === 'actuator-arm') {
      c.simState.angle = (c.simState.angle || 0) + (c.simState.active ? dt * 3 : 0);
    }
  });
}

// Update sources
function updateSources(dt) {
  if (!state.running) return;
  state.components.forEach(c => {
    if (c.type === 'source' && c.props.otoOlustur) spawnFromSource(c, dt);
  });
}

function updateStats() {
  document.getElementById('sb-total').textContent = state.stats.total;
  document.getElementById('sb-ok').textContent = state.stats.ok;
  document.getElementById('sb-fault').textContent = state.stats.fault;
  const oee = state.stats.total === 0 ? '—' : Math.round(state.stats.ok / state.stats.total * 100) + '%';
  document.getElementById('sb-oee').textContent = oee;
}

// ============================================================
// DRAW
// ============================================================
const COLORS = {
  'conveyor-h': '#1e3a8a', 'conveyor-v': '#1e3a8a', 'conveyor-turn': '#1e3a8a',
  'sensor-prox': '#065f46', 'sensor-photo': '#065f46', 'sensor-color': '#3b0764',
  'actuator-piston': '#78350f', 'actuator-arm': '#78350f', 'actuator-stopper': '#7f1d1d',
  'source': '#064e3b', 'sink': '#1e3a8a', 'display': '#1e293b',
};
const COLORS_ACTIVE = {
  'sensor-prox': '#10b981', 'sensor-photo': '#06b6d4', 'sensor-color': '#8b5cf6',
  'actuator-piston': '#f59e0b', 'actuator-arm': '#f59e0b', 'actuator-stopper': '#ef4444',
};

function drawGrid() {
  const g = state.gridSize;
  ctx.strokeStyle = 'rgba(46,58,82,0.5)';
  ctx.lineWidth = 0.5;
  for (let x = 0; x < canvas.width; x += g) {
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, canvas.height); ctx.stroke();
  }
  for (let y = 0; y < canvas.height; y += g) {
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(canvas.width, y); ctx.stroke();
  }
}

function drawConveyorH(c) {
  const { x, y, w, h } = c;
  const active = c.props.aktif && state.running && !state.faulted;
  // Belt base
  ctx.fillStyle = '#1e2535';
  ctx.strokeStyle = active ? '#3b82f6' : '#2e3a52';
  ctx.lineWidth = 1.5;
  roundRect(ctx, x, y + h * 0.25, w, h * 0.5, 6);
  ctx.fill(); ctx.stroke();
  // Rollers
  const n = Math.max(2, Math.floor(w / 30));
  for (let i = 0; i <= n; i++) {
    const rx = x + (i / n) * w;
    ctx.fillStyle = '#3d4f6e';
    ctx.beginPath(); ctx.ellipse(rx, y + h * 0.5, 5, h * 0.22, 0, 0, Math.PI * 2); ctx.fill();
  }
  // Belt lines (animated)
  const offset = active ? (Date.now() / (200 / state.speed)) % 30 : 0;
  const dir = c.props.yon === 'sag' ? 1 : -1;
  ctx.strokeStyle = active ? '#3b82f650' : '#2e3a5250';
  ctx.lineWidth = 1;
  for (let i = -1; i < w / 30 + 2; i++) {
    const lx = x + ((i * 30 + dir * offset) % w + w) % w;
    ctx.beginPath(); ctx.moveTo(lx, y + h * 0.3); ctx.lineTo(lx, y + h * 0.7); ctx.stroke();
  }
  // Label
  ctx.fillStyle = active ? '#93c5fd' : '#475569';
  ctx.font = '500 11px Segoe UI';
  ctx.textAlign = 'center';
  ctx.fillText(active ? (c.props.yon === 'sag' ? '→ ÇALIŞIYOR' : '← ÇALIŞIYOR') : '⏸ BEKLEMEDE', x + w / 2, y + h * 0.5 + 4);
}

function drawConveyorV(c) {
  const { x, y, w, h } = c;
  const active = c.props.aktif && state.running && !state.faulted;
  ctx.fillStyle = '#1e2535';
  ctx.strokeStyle = active ? '#3b82f6' : '#2e3a52';
  ctx.lineWidth = 1.5;
  roundRect(ctx, x + w * 0.25, y, w * 0.5, h, 6);
  ctx.fill(); ctx.stroke();
  const n = Math.max(2, Math.floor(h / 30));
  for (let i = 0; i <= n; i++) {
    const ry = y + (i / n) * h;
    ctx.fillStyle = '#3d4f6e';
    ctx.beginPath(); ctx.ellipse(x + w * 0.5, ry, w * 0.22, 5, 0, 0, Math.PI * 2); ctx.fill();
  }
  const offset = active ? (Date.now() / (200 / state.speed)) % 30 : 0;
  const dir = c.props.yon === 'asagi' ? 1 : -1;
  ctx.strokeStyle = active ? '#3b82f650' : '#2e3a5250';
  ctx.lineWidth = 1;
  for (let i = -1; i < h / 30 + 2; i++) {
    const ly = y + ((i * 30 + dir * offset) % h + h) % h;
    ctx.beginPath(); ctx.moveTo(x + w * 0.3, ly); ctx.lineTo(x + w * 0.7, ly); ctx.stroke();
  }
}

function drawSensor(c) {
  const { x, y, w, h } = c;
  const active = c.simState && c.simState.active;
  const clr = active ? (COLORS_ACTIVE[c.type] || '#10b981') : '#1e2535';
  ctx.fillStyle = clr;
  ctx.strokeStyle = active ? '#10b981' : '#2e3a52';
  ctx.lineWidth = active ? 2 : 1;
  roundRect(ctx, x, y, w, h, 8);
  ctx.fill(); ctx.stroke();
  if (active) {
    ctx.strokeStyle = '#10b98140';
    ctx.lineWidth = 6;
    roundRect(ctx, x - 3, y - 3, w + 6, h + 6, 10);
    ctx.stroke();
  }
  ctx.fillStyle = active ? '#fff' : '#475569';
  ctx.font = 'bold 11px Segoe UI';
  ctx.textAlign = 'center';
  ctx.fillText(c.props.id || 'S?', x + w / 2, y + h / 2 - 4);
  ctx.font = '9px Segoe UI';
  ctx.fillStyle = active ? '#d1fae5' : '#374151';
  ctx.fillText(active ? 'ON' : 'OFF', x + w / 2, y + h / 2 + 8);
}

function drawPiston(c) {
  const { x, y, w, h } = c;
  const pos = c.simState.pistonPos || 0;
  const active = pos > 2;
  // Body
  ctx.fillStyle = '#292524';
  ctx.strokeStyle = active ? '#f59e0b' : '#2e3a52';
  ctx.lineWidth = 1.5;
  roundRect(ctx, x + 8, y + pos + 10, w - 16, h - pos - 20, 4);
  ctx.fill(); ctx.stroke();
  // Rod
  ctx.fillStyle = active ? '#fbbf24' : '#6b7280';
  ctx.fillRect(x + w / 2 - 5, y, 10, pos + 12);
  // Head
  ctx.fillStyle = active ? '#f59e0b' : '#4b5563';
  roundRect(ctx, x + w / 2 - 12, y + pos, 24, 14, 4);
  ctx.fill();
  // Label
  ctx.fillStyle = '#94a3b8';
  ctx.font = '500 10px Segoe UI';
  ctx.textAlign = 'center';
  ctx.fillText(c.props.id || 'A?', x + w / 2, y + h - 4);
}

function drawStopper(c) {
  const { x, y, w, h } = c;
  const open = c.props.acik;
  ctx.fillStyle = open ? '#065f46' : '#7f1d1d';
  ctx.strokeStyle = open ? '#10b981' : '#ef4444';
  ctx.lineWidth = 1.5;
  roundRect(ctx, x, y, w, h, 5);
  ctx.fill(); ctx.stroke();
  ctx.fillStyle = '#fff';
  ctx.font = 'bold 11px Segoe UI';
  ctx.textAlign = 'center';
  ctx.fillText(open ? 'AÇ' : 'KAP', x + w / 2, y + h / 2 + 4);
}

function drawArm(c) {
  const { x, y, w, h } = c;
  const cx2 = x + w / 2, cy2 = y + h / 2;
  const angle = c.simState.angle || 0;
  ctx.fillStyle = '#1e2535';
  ctx.strokeStyle = '#2e3a52';
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.arc(cx2, cy2, w / 2 - 4, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  // Arm
  ctx.strokeStyle = c.simState.active ? '#f59e0b' : '#4b5563';
  ctx.lineWidth = 4;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(cx2, cy2);
  ctx.lineTo(cx2 + Math.cos(angle) * (w / 2 - 8), cy2 + Math.sin(angle) * (h / 2 - 8));
  ctx.stroke();
  // Hub
  ctx.fillStyle = '#6b7280';
  ctx.beginPath(); ctx.arc(cx2, cy2, 6, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#94a3b8';
  ctx.font = '9px Segoe UI';
  ctx.textAlign = 'center';
  ctx.fillText(c.props.id || 'AR?', cx2, y + h - 2);
}

function drawSource(c) {
  const { x, y, w, h } = c;
  const pulse = 0.5 + 0.5 * Math.sin(Date.now() / 600);
  ctx.fillStyle = `rgba(6,95,70,${0.5 + pulse * 0.3})`;
  ctx.strokeStyle = '#10b981';
  ctx.lineWidth = 1.5;
  roundRect(ctx, x, y, w, h, 10);
  ctx.fill(); ctx.stroke();
  ctx.font = '22px serif';
  ctx.textAlign = 'center';
  ctx.fillText('📦', x + w / 2, y + h / 2 + 6);
  ctx.fillStyle = '#6ee7b7';
  ctx.font = '500 10px Segoe UI';
  ctx.fillText('KAYNAK', x + w / 2, y + h - 6);
}

function drawSink(c) {
  const { x, y, w, h } = c;
  ctx.fillStyle = '#1e3a8a50';
  ctx.strokeStyle = '#3b82f6';
  ctx.lineWidth = 1.5;
  roundRect(ctx, x, y, w, h, 10);
  ctx.fill(); ctx.stroke();
  ctx.font = '18px serif';
  ctx.textAlign = 'center';
  ctx.fillText('🏁', x + w / 2, y + h / 2 + 2);
  ctx.fillStyle = '#93c5fd';
  ctx.font = 'bold 12px Segoe UI';
  ctx.fillText(c.props.sayac || 0, x + w / 2, y + 16);
  ctx.fillStyle = '#60a5fa';
  ctx.font = '10px Segoe UI';
  ctx.fillText('ÇIKIŞ', x + w / 2, y + h - 6);
}

function drawDisplay(c) {
  const { x, y, w, h } = c;
  ctx.fillStyle = '#0f172a';
  ctx.strokeStyle = '#334155';
  ctx.lineWidth = 1;
  roundRect(ctx, x, y, w, h, 8);
  ctx.fill(); ctx.stroke();
  ctx.fillStyle = '#0f4';
  ctx.font = 'bold 11px Consolas, monospace';
  ctx.textAlign = 'left';
  const lines = [
    `TOPLAM: ${state.stats.total}`,
    `BAŞARILI: ${state.stats.ok}`,
    `ARIZA: ${state.stats.fault}`,
    `OEE: ${state.stats.total ? Math.round(state.stats.ok/state.stats.total*100) : 0}%`,
  ];
  lines.forEach((l, i) => ctx.fillText(l, x + 8, y + 18 + i * 13));
  ctx.fillStyle = '#166534';
  ctx.font = '9px Segoe UI';
  ctx.textAlign = 'center';
  ctx.fillText('HMI', x + w / 2, y + h - 4);
}

function drawGenericComp(c) {
  const def = COMP_DEFS[c.type] || { label: c.type };
  ctx.fillStyle = COLORS[c.type] || '#1e2535';
  ctx.strokeStyle = '#2e3a52';
  ctx.lineWidth = 1;
  roundRect(ctx, c.x, c.y, c.w, c.h, 8);
  ctx.fill(); ctx.stroke();
  ctx.fillStyle = '#94a3b8';
  ctx.font = '11px Segoe UI';
  ctx.textAlign = 'center';
  ctx.fillText(def.label, c.x + c.w / 2, c.y + c.h / 2 + 4);
}

function drawComp(c) {
  ctx.save();
  if (c.rotation) {
    const cx2 = c.x + c.w / 2, cy2 = c.y + c.h / 2;
    ctx.translate(cx2, cy2);
    ctx.rotate(c.rotation * Math.PI / 180);
    ctx.translate(-cx2, -cy2);
  }
  switch (c.type) {
    case 'conveyor-h': drawConveyorH(c); break;
    case 'conveyor-v': drawConveyorV(c); break;
    case 'conveyor-turn': drawGenericComp(c); break;
    case 'sensor-prox': case 'sensor-photo': case 'sensor-color': drawSensor(c); break;
    case 'actuator-piston': drawPiston(c); break;
    case 'actuator-arm': drawArm(c); break;
    case 'actuator-stopper': drawStopper(c); break;
    case 'source': drawSource(c); break;
    case 'sink': drawSink(c); break;
    case 'display': drawDisplay(c); break;
    default: drawGenericComp(c);
  }
  // Selection ring
  if (state.selected === c.id) {
    ctx.strokeStyle = '#3b82f6';
    ctx.lineWidth = 2;
    ctx.setLineDash([5, 3]);
    roundRect(ctx, c.x - 3, c.y - 3, c.w + 6, c.h + 6, 10);
    ctx.stroke();
    ctx.setLineDash([]);
    // Resize handle bottom-right
    ctx.fillStyle = '#3b82f6';
    ctx.fillRect(c.x + c.w - 6, c.y + c.h - 6, 10, 10);
  }
  ctx.restore();
}

function drawItems() {
  state.items.forEach(item => {
    ctx.fillStyle = item.color;
    ctx.strokeStyle = item.ok ? '#fff3' : '#ef444480';
    ctx.lineWidth = 1;
    roundRect(ctx, item.x - item.w / 2, item.y - item.h / 2, item.w, item.h, 5);
    ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 9px Segoe UI';
    ctx.textAlign = 'center';
    ctx.fillText(item.label, item.x, item.y + 3);
  });
}

function drawFaultOverlay() {
  ctx.fillStyle = 'rgba(127,29,29,0.25)';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#fca5a5';
  ctx.font = 'bold 18px Segoe UI';
  ctx.textAlign = 'center';
  ctx.fillText('⚠  ARIZA — HAT DURDURULDU', canvas.width / 2, 32);
}

function draw() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#0f1117';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  drawGrid();
  state.components.forEach(drawComp);
  drawItems();
  if (state.faulted) drawFaultOverlay();
}

// ============================================================
// MAIN LOOP
// ============================================================
function loop(ts) {
  if (!state.lastTick) state.lastTick = ts;
  const dt = Math.min((ts - state.lastTick) / 1000, 0.1);
  state.lastTick = ts;

  // FPS
  state.frameCount++;
  state.fpsTimer += dt;
  if (state.fpsTimer >= 1) {
    document.getElementById('fpsLabel').textContent = state.frameCount + ' FPS';
    state.frameCount = 0;
    state.fpsTimer = 0;
  }

  if (state.running && !state.faulted) {
    state.stats.runSeconds += dt;
    document.getElementById('sb-time').textContent = Math.round(state.stats.runSeconds) + 's';
    updateSources(dt);
    updateItems(dt);
    updateSensors(dt);
    updateActuators(dt);
  } else {
    updateActuators(dt); // still animate pistons returning
  }
  draw();
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

// ============================================================
// INPUT - DRAG & DROP FROM SIDEBAR
// ============================================================
wrap.addEventListener('dragover', e => { e.preventDefault(); wrap.classList.add('drag-over'); });
wrap.addEventListener('dragleave', () => wrap.classList.remove('drag-over'));
wrap.addEventListener('drop', e => {
  e.preventDefault();
  wrap.classList.remove('drag-over');
  const type = e.dataTransfer.getData('comp-type');
  if (!type) return;
  const rect = canvas.getBoundingClientRect();
  const x = e.clientX - rect.left - (COMP_DEFS[type]?.w || 80) / 2;
  const y = e.clientY - rect.top - (COMP_DEFS[type]?.h || 60) / 2;
  const c = createComp(type, x, y);
  state.selected = c.id;
  renderProps();
});

document.querySelectorAll('.comp-item').forEach(el => {
  el.addEventListener('dragstart', e => {
    e.dataTransfer.setData('comp-type', el.dataset.type);
  });
});

// ============================================================
// INPUT - CANVAS MOUSE
// ============================================================
let mouseDown = false, dragId = null, dragOffX = 0, dragOffY = 0;
let resizing = false, resizeId = null;

canvas.addEventListener('mousedown', e => {
  if (e.button === 2) return;
  const { cx, cy } = canvasXY(e);
  hideCtxMenu();

  // Check resize handle
  const sel = state.components.find(c => c.id === state.selected);
  if (sel) {
    const hx = sel.x + sel.w - 6, hy = sel.y + sel.h - 6;
    if (cx >= hx && cx <= hx + 10 && cy >= hy && cy <= hy + 10) {
      resizing = true; resizeId = sel.id; return;
    }
  }

  // Hit test components (reverse for top-first)
  const hit = [...state.components].reverse().find(c =>
    cx >= c.x && cx <= c.x + c.w && cy >= c.y && cy <= c.y + c.h
  );
  if (hit) {
    state.selected = hit.id;
    dragId = hit.id;
    dragOffX = cx - hit.x;
    dragOffY = cy - hit.y;
    mouseDown = true;
    renderProps();
  } else {
    state.selected = null;
    renderProps();
  }
});

canvas.addEventListener('mousemove', e => {
  const { cx, cy } = canvasXY(e);
  if (resizing && resizeId) {
    const c = state.components.find(x => x.id === resizeId);
    if (c) {
      c.w = Math.max(40, Math.round((cx - c.x) / state.gridSize) * state.gridSize);
      c.h = Math.max(30, Math.round((cy - c.y) / state.gridSize) * state.gridSize);
    }
    return;
  }
  if (mouseDown && dragId) {
    const c = state.components.find(x => x.id === dragId);
    if (c) {
      c.x = Math.round((cx - dragOffX) / state.gridSize) * state.gridSize;
      c.y = Math.round((cy - dragOffY) / state.gridSize) * state.gridSize;
    }
  }
});

canvas.addEventListener('mouseup', () => { mouseDown = false; dragId = null; resizing = false; resizeId = null; });
canvas.addEventListener('dblclick', e => {
  const { cx, cy } = canvasXY(e);
  const hit = [...state.components].reverse().find(c =>
    cx >= c.x && cx <= c.x + c.w && cy >= c.y && cy <= c.y + c.h
  );
  if (hit) {
    // Toggle stopper on dblclick
    if (hit.type === 'actuator-stopper') {
      hit.props.acik = !hit.props.acik;
      log(`${hit.props.id} ${hit.props.acik ? 'açıldı' : 'kapandı'}`, hit.props.acik ? 'ok' : 'warn');
    }
    // Toggle conveyor
    if (hit.type.startsWith('conveyor')) {
      hit.props.aktif = !hit.props.aktif;
      log(`Konveyör ${hit.props.aktif ? 'aktif' : 'devre dışı'}`, 'warn');
    }
  }
});

canvas.addEventListener('contextmenu', e => {
  e.preventDefault();
  const { cx, cy } = canvasXY(e);
  const hit = [...state.components].reverse().find(c =>
    cx >= c.x && cx <= c.x + c.w && cy >= c.y && cy <= c.y + c.h
  );
  if (hit) {
    state.ctxTarget = hit.id;
    state.selected = hit.id;
    renderProps();
    showCtxMenu(e.clientX, e.clientY);
  }
});

function canvasXY(e) {
  const r = canvas.getBoundingClientRect();
  return { cx: e.clientX - r.left, cy: e.clientY - r.top };
}

// ============================================================
// CONTEXT MENU
// ============================================================
const ctxEl = document.getElementById('ctx-menu');
function showCtxMenu(x, y) { ctxEl.style.left = x + 'px'; ctxEl.style.top = y + 'px'; ctxEl.classList.add('show'); }
function hideCtxMenu() { ctxEl.classList.remove('show'); }
document.addEventListener('click', hideCtxMenu);

function ctxDelete() { if (state.ctxTarget) removeComp(state.ctxTarget); hideCtxMenu(); }
function ctxRotate() {
  const c = state.components.find(x => x.id === state.ctxTarget);
  if (c) { c.rotation = ((c.rotation || 0) + 90) % 360; log(`Komponent döndürüldü (${c.rotation}°)`); }
  hideCtxMenu();
}
function ctxDuplicate() {
  const c = state.components.find(x => x.id === state.ctxTarget);
  if (c) {
    const nc = createComp(c.type, c.x + 30, c.y + 30);
    nc.props = JSON.parse(JSON.stringify(c.props));
    state.selected = nc.id;
    renderProps();
  }
  hideCtxMenu();
}
function ctxProps() { hideCtxMenu(); }

// ============================================================
// PROPERTIES PANEL
// ============================================================
function renderProps() {
  const el = document.getElementById('props-content');
  if (!state.selected) {
    el.innerHTML = '<div class="no-sel">Bir komponent seçin</div>'; return;
  }
  const c = state.components.find(x => x.id === state.selected);
  if (!c) { el.innerHTML = '<div class="no-sel">Komponent bulunamadı</div>'; return; }
  const def = COMP_DEFS[c.type] || { label: c.type };

  let html = `
    <div class="prop-group">
      <div class="prop-group-title">Genel</div>
      <div class="prop-row"><span class="prop-label">Tür</span><span class="prop-val">${def.label}</span></div>
      <div class="prop-row"><span class="prop-label">ID</span><span class="prop-val">#${c.id}</span></div>
      <div class="prop-row"><span class="prop-label">Konum</span><span class="prop-val">${Math.round(c.x)}, ${Math.round(c.y)}</span></div>
      <div class="prop-row"><span class="prop-label">Boyut</span><span class="prop-val">${Math.round(c.w)} × ${Math.round(c.h)}</span></div>
      <div class="prop-row"><span class="prop-label">Döndürme</span><span class="prop-val">${c.rotation || 0}°</span></div>
    </div>
    <div class="prop-group">
      <div class="prop-group-title">Özellikler</div>
  `;

  Object.entries(c.props).forEach(([k, v]) => {
    if (typeof v === 'boolean') {
      html += `<div class="prop-row">
        <span class="prop-label">${k}</span>
        <div class="prop-toggle ${v ? 'on' : ''}" onclick="toggleProp(${c.id},'${k}')"></div>
      </div>`;
    } else if (typeof v === 'number') {
      html += `<div class="prop-row">
        <span class="prop-label">${k}</span>
        <input class="prop-input" type="number" value="${v}" onchange="setProp(${c.id},'${k}',parseFloat(this.value))">
      </div>`;
    } else {
      html += `<div class="prop-row">
        <span class="prop-label">${k}</span>
        <input class="prop-input" type="text" value="${v}" onchange="setProp(${c.id},'${k}',this.value)">
      </div>`;
    }
  });

  html += `</div><button class="delete-btn" onclick="removeComp(${c.id})">🗑 Sil</button>`;
  el.innerHTML = html;
}

function toggleProp(id, key) {
  const c = state.components.find(x => x.id === id);
  if (c) { c.props[key] = !c.props[key]; renderProps(); }
}
function setProp(id, key, val) {
  const c = state.components.find(x => x.id === id);
  if (c) { c.props[key] = val; renderProps(); }
}

// ============================================================
// SAVE / LOAD
// ============================================================
function saveScene() { ipcRenderer.send('save-scene', { components: state.components, stats: state.stats }); }
ipcRenderer.on('save-done', () => log('Sahne kaydedildi ✓', 'ok'));
ipcRenderer.on('menu-save', saveScene);
ipcRenderer.on('menu-load', (e, data) => {
  if (data.components) { state.components = data.components; checkDropHint(); updateCompCount(); log('Sahne yüklendi ✓', 'ok'); }
});
ipcRenderer.on('menu-toggle', toggleSim);
ipcRenderer.on('menu-reset', clearScene);

// ============================================================
// HELPERS
// ============================================================
function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

log('FactoryIO Simülatör hazır — komponent ekle ve başlat!', 'ok');

// ============================================================
// OPC UA ENTEGRASYONU
// ============================================================
const opcuaTags = {
  Sensor_S1: false, Sensor_S2: false, Sensor_S3: false,
  Motor_M1: false, Piston_A1: false, Fault_Lamp: false,
};

// OPC UA server hazır olduğunda
ipcRenderer.on('opcua-ready', (e, ok) => {
  const dot = document.getElementById('opcua-dot');
  const lbl = document.getElementById('opcua-label');
  if (dot) dot.className = 'sb-dot ' + (ok ? 'green' : 'red');
  if (lbl) lbl.textContent = ok ? 'OPC UA: opc.tcp://localhost:4840' : 'OPC UA: Kapalı';
  log(ok ? '[OPC UA] TIA Portal bağlantısına hazır ✓' : '[OPC UA] node-opcua yüklü değil — npm install gerekli', ok ? 'ok' : 'warn');
});

// TIA Portal bir tag yazdığında (Motor_M1, Piston_A1 vs.)
ipcRenderer.on('opcua-tag-write', (e, { tag, val }) => {
  opcuaTags[tag] = val;
  log(`[OPC UA ←TIA] ${tag} = ${val}`, 'ok');

  // Konveyörleri motor tag'ine göre güncelle
  if (tag === 'Motor_M1') {
    state.components.filter(c => c.type.startsWith('conveyor')).forEach(c => {
      c.props.aktif = val;
    });
  }
  // Pistonu güncelle
  if (tag === 'Piston_A1') {
    state.components.filter(c => c.type === 'actuator-piston').forEach(c => {
      c.simState.active = val;
    });
  }
  // Arıza lambası
  if (tag === 'Fault_Lamp' && val) {
    injectFault();
  }
});

// Sensör tetiklenince OPC UA server'a bildir → TIA Portal okur
function sendSensorToOpcUa(sensorId, value) {
  const tagName = 'Sensor_' + sensorId;
  if (opcuaTags[tagName] === value) return;
  opcuaTags[tagName] = value;
  ipcRenderer.send('opcua-update-tag', { tag: tagName, val: value });
}

// updateSensors fonksiyonunu OPC UA ile güçlendir
const _origUpdateSensors = updateSensors;
// Sensör değişimlerini OPC UA'ya da yansıt
const _opcuaSensorPatch = setInterval(() => {
  state.components.forEach(sensor => {
    if (!sensor.type.startsWith('sensor')) return;
    const id = sensor.props.id;
    if (!id) return;
    const tagName = 'Sensor_' + id;
    if (opcuaTags[tagName] !== undefined) {
      const val = sensor.simState?.active || false;
      if (opcuaTags[tagName] !== val) {
        sendSensorToOpcUa(id, val);
      }
    }
  });
}, 100);
ipcRenderer.on('ladder-loaded', (e, json) => {
  if (typeof ladderEditor !== 'undefined') ladderEditor.loadJSON(json);
});
