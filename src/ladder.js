// ============================================================
// LADDER LOGIC EDİTÖRÜ + PLC MOTORU
// ============================================================

// --- PLC Motoru ---
const plcEngine = {
  tags: {
    Sensor_S1: false, Sensor_S2: false, Sensor_S3: false,
    Motor_M1: false, Piston_A1: false, Fault_Lamp: false,
    Start_PB: false, Stop_PB: false,
    Timer_T1_Done: false, Counter_C1_Done: false,
  },
  timers: {}, // { id: { preset, acc, running, done } }
  counters: {}, // { id: { preset, acc, done } }
  rungs: [], // [ { elements: [...], coil } ]
  running: false,
  scanInterval: null,
  onTagChange: null,

  setTag(name, val) {
    if (this.tags[name] === val) return;
    this.tags[name] = val;
    if (this.onTagChange) this.onTagChange(name, val);
  },

  startScan() {
    if (this.scanInterval) return;
    this.running = true;
    this.scanInterval = setInterval(() => this.scan(), 50);
  },

  stopScan() {
    this.running = false;
    clearInterval(this.scanInterval);
    this.scanInterval = null;
  },

  scan() {
    this.rungs.forEach(rung => this.evaluateRung(rung));
    this.updateTimers();
  },

  evaluateRung(rung) {
    let result = true;
    rung.elements.forEach(el => {
      if (el.type === 'contact') {
        const val = this.tags[el.tag] ?? false;
        result = result && (el.negated ? !val : val);
      } else if (el.type === 'parallel') {
        // OR blok
        let any = false;
        el.branches.forEach(branch => {
          let brResult = true;
          branch.forEach(b => {
            const val = this.tags[b.tag] ?? false;
            brResult = brResult && (b.negated ? !val : val);
          });
          if (brResult) any = true;
        });
        result = result && any;
      }
    });

    // Coil çıkışı
    if (rung.coil) {
      const { tag, type } = rung.coil;
      if (type === 'coil') this.setTag(tag, result);
      else if (type === 'set' && result) this.setTag(tag, true);
      else if (type === 'reset' && result) this.setTag(tag, false);
      else if (type === 'timer') {
        const t = this.timers[tag] || { preset: rung.coil.preset || 3, acc: 0, running: false, done: false };
        t.running = result;
        if (!result) { t.acc = 0; t.done = false; }
        this.timers[tag] = t;
        this.setTag(tag + '_Done', t.done);
      } else if (type === 'counter' && result) {
        const c = this.counters[tag] || { preset: rung.coil.preset || 5, acc: 0, done: false };
        if (!this._prevRungResults) this._prevRungResults = {};
        if (!this._prevRungResults[tag]) { c.acc++; if (c.acc >= c.preset) c.done = true; }
        this._prevRungResults[tag] = result;
        this.counters[tag] = c;
        this.setTag(tag + '_Done', c.done);
      }
    }
    rung._lastResult = result;
  },

  updateTimers() {
    Object.entries(this.timers).forEach(([id, t]) => {
      if (t.running && !t.done) {
        t.acc += 0.05;
        if (t.acc >= t.preset) { t.done = true; this.setTag(id + '_Done', true); }
      }
    });
  },
};

// --- Ladder Editörü UI ---
const ladderEditor = {
  rungs: [], // { id, elements, coil, comment }
  selectedRungId: null,
  nextId: 1,

  init() {
    this.renderToolbar();
    this.renderRungs();
    plcEngine.onTagChange = (tag, val) => {
      this.updateTagDisplay(tag, val);
      this.applyToSimulator(tag, val);
      ladderLog(`${tag} = ${val ? 'TRUE' : 'FALSE'}`, val ? 'ok' : '');
    };
  },

  addRung() {
    const id = this.nextId++;
    this.rungs.push({
      id,
      elements: [],
      coil: null,
      comment: 'Network ' + id,
    });
    plcEngine.rungs = this.rungs;
    this.renderRungs();
    this.selectRung(id);
  },

  deleteRung(id) {
    this.rungs = this.rungs.filter(r => r.id !== id);
    plcEngine.rungs = this.rungs;
    if (this.selectedRungId === id) this.selectedRungId = null;
    this.renderRungs();
  },

  selectRung(id) {
    this.selectedRungId = id;
    this.renderRungs();
  },

  addElement(rungId, type, tag, negated = false, preset = null) {
    const rung = this.rungs.find(r => r.id === rungId);
    if (!rung) return;
    if (type === 'coil' || type === 'set' || type === 'reset' || type === 'timer' || type === 'counter') {
      rung.coil = { tag, type, preset };
    } else {
      rung.elements.push({ type: 'contact', tag, negated });
    }
    plcEngine.rungs = this.rungs;
    this.renderRungs();
  },

  removeElement(rungId, idx) {
    const rung = this.rungs.find(r => r.id === rungId);
    if (!rung) return;
    rung.elements.splice(idx, 1);
    plcEngine.rungs = this.rungs;
    this.renderRungs();
  },

  renderToolbar() {
    const tb = document.getElementById('ladder-toolbar');
    if (!tb) return;
    tb.innerHTML = `
      <button class="lb" onclick="ladderEditor.addRung()">+ Network</button>
      <div class="lsep"></div>
      <span class="lcat">KONTAKT</span>
      <button class="lb element-btn" data-type="contact" data-negated="false" title="NO Kontakt">─┤ ├─</button>
      <button class="lb element-btn" data-type="contact" data-negated="true" title="NC Kontakt">─┤/├─</button>
      <div class="lsep"></div>
      <span class="lcat">COIL</span>
      <button class="lb element-btn" data-type="coil" title="Coil (─( )─)">─( )─</button>
      <button class="lb element-btn" data-type="set" title="Set Coil">─(S)─</button>
      <button class="lb element-btn" data-type="reset" title="Reset Coil">─(R)─</button>
      <div class="lsep"></div>
      <span class="lcat">BLOK</span>
      <button class="lb element-btn" data-type="timer" title="Timer TON">TON</button>
      <button class="lb element-btn" data-type="counter" title="Counter CTU">CTU</button>
      <div class="lsep"></div>
      <button class="lb run-btn" id="plcRunBtn" onclick="ladderEditor.togglePLC()">▶ PLC Başlat</button>
    `;

    tb.querySelectorAll('.element-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        if (!this.selectedRungId) { ladderLog('Önce bir network seç!', 'warn'); return; }
        this.showTagPicker(btn.dataset.type, btn.dataset.negated === 'true', btn.dataset.preset);
      });
    });
  },

  showTagPicker(type, negated, preset) {
    const modal = document.getElementById('ladder-modal');
    const isCoil = ['coil','set','reset','timer','counter'].includes(type);
    const tags = isCoil
      ? ['Motor_M1', 'Piston_A1', 'Fault_Lamp', 'Start_PB', 'Stop_PB', 'Timer_T1', 'Counter_C1']
      : ['Sensor_S1', 'Sensor_S2', 'Sensor_S3', 'Motor_M1', 'Piston_A1', 'Start_PB', 'Stop_PB', 'Timer_T1_Done', 'Counter_C1_Done'];

    const typeLabel = { contact:'NO Kontakt', coil:'Coil', set:'Set', reset:'Reset', timer:'TON Timer', counter:'CTU Sayaç' };
    let presetHtml = '';
    if (type === 'timer' || type === 'counter') {
      presetHtml = `<div class="modal-row"><label>Değer (sn/adet):</label><input type="number" id="presetVal" value="3" min="1" max="99" style="width:60px;padding:4px;background:#1e2535;border:1px solid #2e3a52;color:#e2e8f0;border-radius:4px"></div>`;
    }

    modal.innerHTML = `
      <div class="modal-box">
        <div class="modal-title">${typeLabel[type] || type} — Tag Seç</div>
        <div class="modal-tags">${tags.map(t => `<button class="tag-btn" onclick="ladderEditor.pickTag('${type}','${t}',${negated},this)">${t}</button>`).join('')}</div>
        ${presetHtml}
        <div class="modal-actions">
          <button class="lb" onclick="document.getElementById('ladder-modal').innerHTML=''">İptal</button>
        </div>
      </div>
    `;
    modal.style.display = 'flex';
  },

  pickTag(type, tag, negated, btn) {
    const presetEl = document.getElementById('presetVal');
    const preset = presetEl ? parseFloat(presetEl.value) : null;
    this.addElement(this.selectedRungId, type, tag, negated, preset);
    document.getElementById('ladder-modal').innerHTML = '';
    document.getElementById('ladder-modal').style.display = 'none';
    ladderLog(`${type.toUpperCase()} "${tag}" eklendi`, 'ok');
  },

  togglePLC() {
    if (plcEngine.running) {
      plcEngine.stopScan();
      document.getElementById('plcRunBtn').textContent = '▶ PLC Başlat';
      document.getElementById('plcRunBtn').className = 'lb run-btn';
      ladderLog('PLC durduruldu');
    } else {
      plcEngine.startScan();
      document.getElementById('plcRunBtn').textContent = '⏹ PLC Durdur';
      document.getElementById('plcRunBtn').className = 'lb run-btn running';
      ladderLog('PLC başlatıldı ✓', 'ok');
    }
  },

  renderRungs() {
    const container = document.getElementById('ladder-rungs');
    if (!container) return;
    if (this.rungs.length === 0) {
      container.innerHTML = '<div class="ladder-empty">+ Network butonuyla rung ekle</div>';
      return;
    }
    container.innerHTML = this.rungs.map(rung => this.renderRung(rung)).join('');
  },

  renderRung(rung) {
    const sel = rung.id === this.selectedRungId;
    const active = rung._lastResult;
    const elements = rung.elements.map((el, i) => {
      const tagVal = plcEngine.tags[el.tag] ?? false;
      const active = el.negated ? !tagVal : tagVal;
      return `
        <div class="rung-el ${active ? 'el-active' : ''}" title="${el.tag}">
          <div class="el-wire"></div>
          <div class="el-body">${el.negated ? '┤/├' : '┤  ├'}</div>
          <div class="el-tag">${el.tag}</div>
          <div class="el-val">${tagVal ? '1' : '0'}</div>
          <span class="el-del" onclick="ladderEditor.removeElement(${rung.id},${i})">×</span>
        </div>`;
    }).join('');

    const coilHtml = rung.coil ? (() => {
      const cv = plcEngine.tags[rung.coil.tag] ?? false;
      const symbols = { coil: '( )', set: '(S)', reset: '(R)', timer: '[TON]', counter: '[CTU]' };
      const sym = symbols[rung.coil.type] || '( )';
      const timerInfo = rung.coil.type === 'timer' ? `<div class="el-preset">${(plcEngine.timers[rung.coil.tag]?.acc || 0).toFixed(1)}/${rung.coil.preset}s</div>` : '';
      const ctrInfo = rung.coil.type === 'counter' ? `<div class="el-preset">${plcEngine.counters[rung.coil.tag]?.acc || 0}/${rung.coil.preset}</div>` : '';
      return `
        <div class="rung-coil ${cv ? 'el-active' : ''}">
          <div class="el-wire long"></div>
          <div class="el-body">${sym}</div>
          <div class="el-tag">${rung.coil.tag}</div>
          <div class="el-val">${cv ? '1' : '0'}</div>
          ${timerInfo}${ctrInfo}
        </div>`;
    })() : `<div class="rung-coil-empty" onclick="ladderEditor.selectRung(${rung.id}); ladderEditor.showTagPicker('coil',false,null)">+ Coil</div>`;

    return `
      <div class="ladder-rung ${sel ? 'selected' : ''} ${active ? 'rung-active' : ''}" onclick="ladderEditor.selectRung(${rung.id})">
        <div class="rung-header">
          <span class="rung-comment">${rung.comment}</span>
          <span class="rung-del" onclick="ladderEditor.deleteRung(${rung.id})">🗑</span>
        </div>
        <div class="rung-body">
          <div class="rung-power ${active ? 'power-on' : ''}"></div>
          <div class="rung-elements">${elements || '<span class="rung-add-hint" onclick="event.stopPropagation()">← Kontakt ekle</span>'}</div>
          ${coilHtml}
          <div class="rung-power ${active ? 'power-on' : ''}"></div>
        </div>
      </div>`;
  },

  updateTagDisplay(tag, val) {
    this.renderRungs();
    // Tag monitor güncelle
    const tagEl = document.getElementById('tag-' + tag);
    if (tagEl) {
      tagEl.querySelector('.tag-val').textContent = val ? '1' : '0';
      tagEl.querySelector('.tag-dot').className = 'tag-dot ' + (val ? 'on' : 'off');
    }
  },

  applyToSimulator(tag, val) {
    if (!state || !state.components) return;
    if (tag === 'Motor_M1') {
      state.components.filter(c => c.type.startsWith('conveyor')).forEach(c => { c.props.aktif = val; });
    }
    if (tag === 'Piston_A1') {
      state.components.filter(c => c.type === 'actuator-piston').forEach(c => { c.simState.active = val; });
    }
    if (tag === 'Fault_Lamp' && val) injectFault();
  },

  // Tag monitor tablosunu render et
  renderTagMonitor() {
    const el = document.getElementById('tag-monitor');
    if (!el) return;
    el.innerHTML = Object.entries(plcEngine.tags).map(([tag, val]) => `
      <div class="tag-row" id="tag-${tag}">
        <span class="tag-dot ${val ? 'on' : 'off'}"></span>
        <span class="tag-name">${tag}</span>
        <span class="tag-val">${val ? '1' : '0'}</span>
        <button class="tag-force" onclick="ladderEditor.forceTag('${tag}')">F</button>
      </div>`).join('');
  },

  forceTag(tag) {
    const cur = plcEngine.tags[tag] ?? false;
    plcEngine.setTag(tag, !cur);
    // Sensörse simülatöre de yansıt
    if (tag.startsWith('Sensor')) {
      state.components.filter(c => c.type.startsWith('sensor') && c.props.id && ('Sensor_' + c.props.id) === tag)
        .forEach(c => { c.simState.active = !cur; });
    }
    this.renderTagMonitor();
  },

  loadExample() {
    this.rungs = [];
    plcEngine.rungs = [];
    this.nextId = 1;

    // Network 1: Sensor_S1 → Motor_M1
    const r1 = { id: this.nextId++, elements: [{ type:'contact', tag:'Sensor_S1', negated:false }], coil: { tag:'Motor_M1', type:'coil' }, comment:'Network 1: S1 → Motor' };
    // Network 2: Sensor_S2 → Piston_A1
    const r2 = { id: this.nextId++, elements: [{ type:'contact', tag:'Sensor_S2', negated:false }], coil: { tag:'Piston_A1', type:'coil' }, comment:'Network 2: S2 → Piston' };
    // Network 3: Sensor_S3 → Fault_Lamp (NC + Motor_M1)
    const r3 = { id: this.nextId++, elements: [{ type:'contact', tag:'Sensor_S3', negated:false },{ type:'contact', tag:'Motor_M1', negated:false }], coil: { tag:'Fault_Lamp', type:'coil' }, comment:'Network 3: S3 + Motor → Fault' };

    this.rungs = [r1, r2, r3];
    plcEngine.rungs = this.rungs;
    this.renderRungs();
    this.renderTagMonitor();
    ladderLog('Örnek ladder yüklendi', 'ok');
  },

  getJSON() { return JSON.stringify({ rungs: this.rungs }, null, 2); },
  loadJSON(json) {
    try {
      const d = JSON.parse(json);
      this.rungs = d.rungs || [];
      this.nextId = Math.max(...this.rungs.map(r => r.id), 0) + 1;
      plcEngine.rungs = this.rungs;
      this.renderRungs();
      ladderLog('Ladder yüklendi', 'ok');
    } catch(e) { ladderLog('JSON parse hatası: ' + e.message, 'err'); }
  }
};

// Tag monitor periyodik güncelle
setInterval(() => {
  if (plcEngine.running) ladderEditor.renderTagMonitor();
}, 200);

// Simülatör sensörlerini PLC'ye bağla (her 100ms)
setInterval(() => {
  if (!plcEngine.running || !state || !state.components) return;
  state.components.forEach(c => {
    if (!c.type.startsWith('sensor') || !c.props.id) return;
    const tag = 'Sensor_' + c.props.id;
    const val = c.simState?.active || false;
    if (plcEngine.tags[tag] !== undefined && plcEngine.tags[tag] !== val) {
      plcEngine.setTag(tag, val);
    }
  });
}, 100);

function ladderLog(msg, type = '') {
  if (typeof log === 'function') log('[PLC] ' + msg, type);
}
