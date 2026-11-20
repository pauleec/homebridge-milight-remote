'use strict';

const net = require('net');
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const EventEmitter = require('events');

class MiniMqttClient extends EventEmitter {
  constructor(host, port, clientId, log) {
    super();
    this.host = host || '127.0.0.1';
    this.port = Number(port) || 1883;
    this.clientId = clientId || ('milight_twin_' + Math.random().toString(16).slice(2, 8));
    this.log = log || console;
    this.sock = null;
    this.buf = Buffer.alloc(0);
    this.pktId = 1;
    this.subs = new Set();
    this.pingTimer = null;
    this.connected = false;
  }

  connect() {
    if (this.sock) { try { this.sock.destroy(); } catch (_) {} this.sock = null; }
    this.buf = Buffer.alloc(0);
    const sock = net.createConnection({ host: this.host, port: this.port });
    this.sock = sock;
    sock.on('connect', () => {
      const vh = Buffer.from([0x00, 0x04, 0x4d, 0x51, 0x54, 0x54, 0x04, 0x02, 0x00, 0x3c]);
      const body = Buffer.concat([vh, this._strBuf(this.clientId)]);
      this.sock.write(Buffer.concat([Buffer.from([0x10]), this._encodeRemLen(body.length), body]));
    });
    sock.on('data', (chunk) => { this.buf = Buffer.concat([this.buf, chunk]); this._drainPackets(); });
    sock.on('error', () => {});
    sock.on('close', () => {
      this.connected = false;
      if (this.pingTimer) { clearInterval(this.pingTimer); this.pingTimer = null; }
      setTimeout(() => this.connect(), 3500);
    });
  }

  _encodeRemLen(len) {
    const out = [];
    do { let d = len % 128; len = Math.floor(len / 128); if (len > 0) d |= 0x80; out.push(d); } while (len > 0);
    return Buffer.from(out);
  }
  _strBuf(s) {
    const b = Buffer.from(String(s), 'utf8'), len = Buffer.alloc(2);
    len.writeUInt16BE(b.length, 0);
    return Buffer.concat([len, b]);
  }
  subscribe(topic) {
    this.subs.add(topic);
    if (!this.connected || !this.sock) return;
    const id = (this.pktId++ & 0x7fff) || 1, vh = Buffer.alloc(2);
    vh.writeUInt16BE(id, 0);
    const body = Buffer.concat([vh, this._strBuf(topic), Buffer.from([0x00])]);
    this.sock.write(Buffer.concat([Buffer.from([0x82]), this._encodeRemLen(body.length), body]));
  }
  publish(topic, payloadStr, retain = false) {
    if (!this.connected || !this.sock || !topic) return;
    const body = Buffer.concat([this._strBuf(topic), Buffer.from(String(payloadStr), 'utf8')]);
    this.sock.write(Buffer.concat([Buffer.from([retain ? 0x31 : 0x30]), this._encodeRemLen(body.length), body]));
  }
  _drainPackets() {
    while (this.buf.length >= 2) {
      const hdr = this.buf[0];
      let mult = 1, val = 0, idx = 1, byte;
      do { if (idx >= this.buf.length) return; byte = this.buf[idx++]; val += (byte & 0x7f) * mult; mult *= 128; } while ((byte & 0x80) !== 0);
      if (this.buf.length < idx + val) return;
      const pkt = this.buf.subarray(idx, idx + val);
      this.buf = this.buf.subarray(idx + val);
      const type = hdr >> 4;
      if (type === 2) {
        this.connected = true;
        for (const t of this.subs) this.subscribe(t);
        if (this.pingTimer) clearInterval(this.pingTimer);
        this.pingTimer = setInterval(() => { if (this.connected && this.sock) this.sock.write(Buffer.from([0xc0, 0x00])); }, 25000);
        this.emit('connected');
      } else if (type === 3) {
        const isRetained = Boolean(hdr & 0x01), qos = (hdr >> 1) & 0x03;
        const tLen = pkt.readUInt16BE(0);
        const topic = pkt.subarray(2, 2 + tLen).toString('utf8');
        const payload = pkt.subarray(2 + tLen + (qos > 0 ? 2 : 0)).toString('utf8');
        this.emit('message', topic, payload, isRetained);
      }
    }
  }
}

// Physical MiBoxer sliders transmit ~24%..100% (~61..255 on 0..255, or ~24..100 on 0..100).
// Remap physical travel to full 0%..100% with ~3% snap deadzones at both ends.
function sliderToFullPct(rawVal, srcKind = 'rf', is100Scale = false) {
  const v = Number(rawVal);
  if (Number.isNaN(v)) return 0;
  if (srcKind === 'ui') {
    if (v > 100) return Math.max(0, Math.min(100, Math.round((v / 255) * 100)));
    return Math.max(0, Math.min(100, Math.round(v)));
  }
  if (is100Scale) {
    if (v <= 27) return 0;
    if (v >= 97) return 100;
    return Math.max(0, Math.min(100, Math.round(((v - 27) / (97 - 27)) * 100)));
  }
  if (v <= 68) return 0;
  if (v >= 246) return 100;
  return Math.max(0, Math.min(100, Math.round(((v - 68) / (246 - 68)) * 100)));
}

const DEFAULT_DEVICES = [
  { id: 'z1_curtains',   zone: 1, name: '[Virtual] Z1 Living Curtains',  room: 'Living Room', kind: 'curtain',    position: 85, open: true },
  { id: 'z2_blinds',     zone: 2, name: '[Virtual] Z2 Study Blinds',     room: 'Study',       kind: 'blind',      position: 70, open: true },
  { id: 'z3_ac',         zone: 3, name: '[Virtual] Z3 Bedroom Split AC', room: 'Bedroom',     kind: 'ac',         active: true, hvacMode: 'cool', currentTemp: 22, targetTemp: 20, fanPct: 65 },
  { id: 'z4_fan',        zone: 4, name: '[Virtual] Z4 Lounge Fan',       room: 'Living Room', kind: 'fan',        active: true, speed: 55 },
  { id: 'z5_radiator',   zone: 5, name: '[Virtual] Z5 Hall Radiator',    room: 'Hall / Bath', kind: 'radiator',   active: false, hvacMode: 'off', currentTemp: 20, targetTemp: 24, valvePct: 0 },
  { id: 'z6_garage',     zone: 6, name: '[Virtual] Z6 Garage Door',      room: 'Garage',      kind: 'garage',     open: false, position: 0 },
  { id: 'z7_gate',       zone: 7, name: '[Virtual] Z7 Entrance Gate',    room: 'Driveway',    kind: 'gate',       open: false, position: 0 },
  { id: 'z8_sprinklers', zone: 8, name: '[Virtual] Z8 Lawn Sprinklers',  room: 'Front Lawn',  kind: 'sprinkler',  active: false, flowPct: 80 },
  { id: 'z0_driveway',   zone: 0, name: '[Virtual] S+/S- Driveway Lights', room: 'Driveway',  kind: 'rgb_light',  on: true, bri: 85, hue: 36, sat: 35, ct: 290, colorMode: 'ct', presetIdx: 0, presetName: 'Warm 2700K' },
  { id: 'scene_mode',    zone: 9, name: '[Virtual] Scene & Beat Mode',   room: 'Whole Home',  kind: 'scene',      on: false, scene: 'sunset', speedBpm: 90 }
];

const FACTORY_SANDBOX_BINDINGS = [
  { remoteHex: '*', zone: 0, targetId: 'master_all',    note: 'Master All Zones ON / OFF / Night Lockdown (S+/S- = Driveway Toggle)' },
  { remoteHex: '*', zone: 1, targetId: 'z1_curtains',   note: 'ON/OFF = Open/Close • Brightness = Curtain %' },
  { remoteHex: '*', zone: 2, targetId: 'z2_blinds',     note: 'ON/OFF = Raise/Lower • Brightness = Blind & Window Tilt %' },
  { remoteHex: '*', zone: 3, targetId: 'z3_ac',         note: 'ON/OFF = Power • Color/CCT = Cool 16°C..Heat 28°C • Bri = Fan' },
  { remoteHex: '*', zone: 4, targetId: 'z4_fan',        note: 'ON/OFF = Spin/Stop • Brightness or S+/S- = Fan RPM %' },
  { remoteHex: '*', zone: 5, targetId: 'z5_radiator',   note: 'ON/OFF = Valve • Brightness/CCT = Thermal Output %' },
  { remoteHex: '*', zone: 6, targetId: 'z6_garage',     note: 'ON/OFF = Roll Up/Down • Brightness = Door Height %' },
  { remoteHex: '*', zone: 7, targetId: 'z7_gate',       note: 'ON/OFF = Slide Open/Shut • Brightness = Gate Travel %' },
  { remoteHex: '*', zone: 8, targetId: 'z8_sprinklers', note: 'ON/OFF = Pop-Up Spray • Brightness = Water Throw %' }
];

const SCENE_ORDER = ['day', 'sunset', 'night', 'party'];

class SmartHomeTwinEngine extends EventEmitter {
  constructor(opts = {}) {
    super();
    this.mqttHost = opts.mqttHost || '127.0.0.1';
    this.mqttPort = Number(opts.mqttPort) || 1883;
    this.httpPort = Number(opts.httpPort) || 8588;
    this.hubUrl = String(opts.hubUrl || 'http://192.168.7.121').replace(/\/+$/, '');
    this.haDiscovery = (opts.haDiscovery !== false);
    this.haPrefix = opts.haPrefix || 'homeassistant';
    this.twinBase = opts.twinBase || 'milight/twin';
    this.hbConfigPath = opts.hbConfigPath || '/var/lib/homebridge/config.json';
    this.routingStorePath = path.join('/var/lib/homebridge', 'milight_routing_config.json');
    this.log = opts.log || console;

    this.devices = new Map();
    for (const d of DEFAULT_DEVICES) this.devices.set(d.id, Object.assign({}, d));
    this.remotesByPrefix = new Map();
    this.sseClients = new Set();
    this.uiTxMarks = new Map();
    this.lastEvent = null;

    this.routing = {
      sandboxEnabled: true,
      sandboxBindings: JSON.parse(JSON.stringify(FACTORY_SANDBOX_BINDINGS)),
      realRules: []
    };
    try {
      if (fs.existsSync(this.routingStorePath)) {
        const raw = JSON.parse(fs.readFileSync(this.routingStorePath, 'utf8'));
        if (typeof raw.sandboxEnabled === 'boolean') this.routing.sandboxEnabled = raw.sandboxEnabled;
        if (Array.isArray(raw.sandboxBindings) && raw.sandboxBindings.length) this.routing.sandboxBindings = raw.sandboxBindings;
        if (Array.isArray(raw.realRules)) this.routing.realRules = raw.realRules;
      }
    } catch (_) {}
  }

  _saveRoutingStore() {
    try { fs.writeFileSync(this.routingStorePath, JSON.stringify(this.routing, null, 2), 'utf8'); } catch (_) {}
  }

  resetSandboxDefaults() {
    this.routing.sandboxEnabled = true;
    this.routing.sandboxBindings = JSON.parse(JSON.stringify(FACTORY_SANDBOX_BINDINGS));
    for (const d of DEFAULT_DEVICES) {
      this.devices.set(d.id, Object.assign({}, d));
      const cur = this.devices.get(d.id);
      this._publishTwinState(cur);
      this.emit('deviceUpdated', cur, 'reset');
    }
    this._saveRoutingStore();
    this._broadcastSse('init', this.getSnapshot());
    return this.routing;
  }

  start() {
    this.mqtt = new MiniMqttClient(this.mqttHost, this.mqttPort, null, this.log);
    this.mqtt.subscribe('milight/remotes_registry/#');
    this.mqtt.subscribe(`${this.twinBase}/+/set`);
    this.mqtt.on('connected', () => {
      for (const dev of this.devices.values()) this._publishTwinState(dev);
    });
    this.mqtt.on('message', (topic, payload, isRetained) => {
      if (topic.startsWith('milight/remotes_registry/')) this._onRegistry(payload);
      else if (topic.startsWith(`${this.twinBase}/`) && topic.endsWith('/set')) { if (!isRetained) this._onExternalSet(topic, payload); }
      else if (topic.endsWith('/event')) { if (!isRetained) this._onRemoteEvent(topic, payload); }
    });
    this.mqtt.connect();
    this._startHttpServer();
  }

  _onRegistry(payload) {
    if (!payload || !payload.trim()) return;
    try {
      const m = JSON.parse(payload);
      const devId = Number(m.device_id ?? m.id ?? 0);
      if (!devId) return;
      const hex = '0x' + devId.toString(16).toUpperCase().padStart(4, '0');
      const prefix = String(m.topic_prefix || m.prefix || `milight/actions/rem_${devId.toString(16).toLowerCase()}`).replace(/\/+$/, '');
      const model = m.visual_model || m.model || String(m.remote_type || 'FUT089').toUpperCase();
      this.remotesByPrefix.set(prefix, {
        device_id: devId, hex_id: hex, hex, visual_model: model, model,
        remote_type: String(m.remote_type || m.type || 'fut089'),
        name: m.name || `${model} (${hex})`, prefix,
        num_zones: Number(m.num_zones ?? m.zones ?? 8), zones: Number(m.num_zones ?? m.zones ?? 8)
      });
      this.mqtt.subscribe(`${prefix}/zone/+/event`);
    } catch (_) {}
  }

  _resolveSandboxTargets(remoteHex, zone) {
    if (!this.routing.sandboxEnabled) return [];
    const exact = this.routing.sandboxBindings.filter((b) => String(b.remoteHex || '*').toUpperCase() === String(remoteHex || '').toUpperCase() && Number(b.zone) === Number(zone));
    const chosen = exact.length ? exact : this.routing.sandboxBindings.filter((b) => (b.remoteHex === '*' || !b.remoteHex) && Number(b.zone) === Number(zone));
    return chosen.map((b) => b.targetId).filter((t) => t && t !== 'none');
  }

  _onRemoteEvent(topic, payload) {
    const match = topic.match(/^(.*)\/zone\/(\d+)\/event$/);
    if (!match) return;
    const [, prefix, zStr] = match;
    const rem = this.remotesByPrefix.get(prefix) || { hex: '0x????', model: 'Remote', name: prefix, prefix };
    const z = parseInt(zStr, 10);
    let data;
    try { data = JSON.parse(payload); } catch (_) { data = { action: String(payload).trim() }; }
    const act = String(data.action || data.command || '').toLowerCase();
    const val = (data.value !== undefined) ? Number(data.value) : undefined;

    const mark = this.uiTxMarks.get(`${rem.hex}:${z}`);
    const isUiEcho = Boolean(data.source === 'virtual' || data.source === 'ui' || (mark && (Date.now() - mark.ts < 1100)));
    const srcKind = isUiEcho ? 'ui' : 'rf';
    if (!this.seen255ByType) this.seen255ByType = new Set(['fut089', 'rgb_cct', 'rgbw', 'fut100']);
    if (srcKind === 'rf' && act === 'brightness' && val !== undefined && val > 100 && rem.remote_type) {
      this.seen255ByType.add(rem.remote_type);
    }
    const is100Scale = (act === 'level') || (srcKind === 'rf' && rem.remote_type && !this.seen255ByType.has(rem.remote_type) && (val === undefined || val <= 100));
    const effVal = (isUiEcho && mark && mark.uiPct !== undefined && (act === 'brightness' || act === 'level')) ? mark.uiPct : val;
    const normAct = (act === 'level') ? 'brightness' : act;
    const normPct = (normAct === 'brightness' && effVal !== undefined) ? sliderToFullPct(effVal, srcKind, is100Scale) : undefined;

    this.lastEvent = {
      ts: new Date().toISOString(), source: srcKind,
      remoteName: rem.name, device_id: rem.device_id || parseInt(String(rem.hex || '0').replace(/^0x/i, ''), 16) || 0,
      hex: rem.hex, model: rem.model, zone: z, action: normAct, value: val, pct: normPct, topic
    };
    if (this.mqtt) this.mqtt.publish('milight/ha_events', JSON.stringify(this.lastEvent), false);

    const touched = this._applySandboxMappedAction(rem.hex, z, normAct, val, normPct);
    const firedRules = this._executeMatchingRealRules(rem.hex, z, normAct, val, normPct);
    this._broadcastSse('rf_event', { event: this.lastEvent, updated: touched, firedRules });
  }

  _applySandboxMappedAction(remoteHex, z, act, val, normPct) {
    if (!this.routing.sandboxEnabled) return [];
    const changed = [];
    const touch = (id, patch) => {
      const dev = this.devices.get(id);
      if (!dev) return;
      Object.assign(dev, patch);
      this._publishTwinState(dev);
      this.emit('deviceUpdated', dev, 'rf');
      changed.push(dev);
    };

    if (act === 'mode' || act === 'next_mode') {
      const sc = this.devices.get('scene_mode');
      const nextScene = SCENE_ORDER[(SCENE_ORDER.indexOf(sc.scene) + 1) % SCENE_ORDER.length];
      touch('scene_mode', { scene: nextScene, on: nextScene !== 'day' });
      return changed;
    }

    const targets = this._resolveSandboxTargets(remoteHex, z);
    const zoneHasFan = targets.some((tid) => {
      const d = this.devices.get(tid);
      return d && d.kind === 'fan';
    });

    // Multi-function S+ / S- Auxiliary Button Demo on any non-fan zone!
    // S+ toggles Driveway Bollards ON <-> OFF; S- cycles architectural color/CCT presets!
    if ((act === 'mode_speed_up' || act === 'mode_speed_down') && !zoneHasFan) {
      const drv = this.devices.get('z0_driveway');
      if (drv) {
        const PRESETS = [
          { presetName: 'Warm 2700K',  colorMode: 'ct', ct: 345, sat: 0,  hue: 36,  bri: 85 },
          { presetName: 'Crisp 4000K', colorMode: 'ct', ct: 220, sat: 0,  hue: 200, bri: 95 },
          { presetName: 'Amber Gold',  colorMode: 'hs', ct: 290, sat: 92, hue: 34,  bri: 90 },
          { presetName: 'Ocean Cyan',  colorMode: 'hs', ct: 220, sat: 90, hue: 190, bri: 88 },
          { presetName: 'Sunset Rose', colorMode: 'hs', ct: 290, sat: 88, hue: 315, bri: 88 }
        ];
        if (act === 'mode_speed_up') {
          touch('z0_driveway', { on: !drv.on });
        } else {
          const nextIdx = ((drv.presetIdx || 0) + 1) % PRESETS.length;
          touch('z0_driveway', Object.assign({ on: true, presetIdx: nextIdx }, PRESETS[nextIdx]));
        }
      }
      return changed;
    }

    for (const tid of targets) {
      if (tid === 'master_all') {
        if (act === 'off') {
          touch('z0_driveway',   { on: false });
          touch('z1_curtains',   { position: 0, open: false });
          touch('z2_blinds',     { position: 0, open: false });
          touch('z3_ac',         { active: false, hvacMode: 'off' });
          touch('z4_fan',        { active: false, speed: 0 });
          touch('z5_radiator',   { active: false, hvacMode: 'off', valvePct: 0 });
          touch('z6_garage',     { open: false, position: 0 });
          touch('z7_gate',       { open: false, position: 0 });
          touch('z8_sprinklers', { active: false, flowPct: 0 });
        } else if (act === 'on') {
          touch('z0_driveway',   { on: true });
          touch('z1_curtains',   { position: 100, open: true });
          touch('z2_blinds',     { position: 100, open: true });
          touch('z3_ac',         { active: true, hvacMode: 'cool' });
          touch('z4_fan',        { active: true, speed: 60 });
        } else if (act === 'night_mode') {
          touch('z0_driveway',   { on: true, bri: 15, sat: 0, ct: 360, colorMode: 'ct', presetName: 'Night 15%' });
          touch('z1_curtains',   { position: 0, open: false });
          touch('z2_blinds',     { position: 0, open: false });
          touch('z6_garage',     { open: false, position: 0 });
          touch('z7_gate',       { open: false, position: 0 });
          touch('z8_sprinklers', { active: false, flowPct: 0 });
          touch('scene_mode',    { scene: 'night', on: true });
        }
      } else {
        this._driveSingleVirtualTarget(tid, act, val, touch, normPct);
      }
    }
    return changed;
  }

  _driveSingleVirtualTarget(tid, act, val, touch, normPct) {
    const dev = this.devices.get(tid);
    if (!dev) return;
    const pct = (normPct !== undefined) ? normPct : ((val !== undefined) ? sliderToFullPct(val, 'rf', false) : 100);
    if (['curtain','blind','garage','gate'].includes(dev.kind)) {
      if (act === 'on') touch(tid, { open: true, position: 100 });
      else if (act === 'off') touch(tid, { open: false, position: 0 });
      else if (act === 'night_mode') touch(tid, { open: dev.kind === 'curtain' || dev.kind === 'blind', position: (dev.kind === 'curtain' || dev.kind === 'blind') ? 20 : 0 });
      else if (act === 'brightness' && val !== undefined) touch(tid, { open: pct > 2, position: pct });
    } else if (dev.kind === 'ac') {
      if (act === 'on') touch(tid, { active: true, hvacMode: dev.hvacMode === 'off' ? 'cool' : dev.hvacMode });
      else if (act === 'off') touch(tid, { active: false, hvacMode: 'off' });
      else if (act === 'brightness' && val !== undefined) touch(tid, { active: pct > 0, hvacMode: dev.hvacMode === 'off' ? 'cool' : dev.hvacMode, fanPct: pct });
      else if (act === 'hue' && val !== undefined) { const cool = val >= 140 && val <= 270; touch(tid, { active: true, hvacMode: cool ? 'cool' : 'heat', targetTemp: cool ? 19 : 25 }); }
      else if ((act === 'color_temp' || act === 'kelvin' || act === 'saturation') && val !== undefined) {
        const cctPct = val > 100 ? Math.max(0, Math.min(100, Math.round(((val - 153) / 217) * 100))) : Math.max(0, Math.min(100, val));
        const t = Math.round(16 + (cctPct / 100) * 12);
        touch(tid, { active: true, targetTemp: t, hvacMode: t >= 23 ? 'heat' : 'cool' });
      }
    } else if (dev.kind === 'fan') {
      if (act === 'on') touch(tid, { active: true, speed: dev.speed > 0 ? dev.speed : 60 });
      else if (act === 'off') touch(tid, { active: false, speed: 0 });
      else if (act === 'brightness' && val !== undefined) touch(tid, { active: pct > 0, speed: pct });
      else if (act === 'mode_speed_up') touch(tid, { active: true, speed: Math.min(100, (dev.speed || 40) + 20) });
      else if (act === 'mode_speed_down') touch(tid, { active: true, speed: Math.max(0, (dev.speed || 40) - 20) });
    } else if (dev.kind === 'radiator') {
      if (act === 'on') touch(tid, { active: true, hvacMode: 'heat', valvePct: 80, targetTemp: 24 });
      else if (act === 'off') touch(tid, { active: false, hvacMode: 'off', valvePct: 0 });
      else if (act === 'brightness' && val !== undefined) touch(tid, { active: pct > 0, hvacMode: pct > 0 ? 'heat' : 'off', valvePct: pct, targetTemp: Math.round(18 + (pct / 100) * 12) });
    } else if (dev.kind === 'sprinkler') {
      if (act === 'on') touch(tid, { active: true, flowPct: 85 });
      else if (act === 'off') touch(tid, { active: false, flowPct: 0 });
      else if (act === 'brightness' && val !== undefined) touch(tid, { active: pct > 0, flowPct: pct });
    } else if (dev.kind === 'rgb_light') {
      if (act === 'on') touch(tid, { on: true });
      else if (act === 'off') touch(tid, { on: false });
      else if (act === 'set_white') touch(tid, { on: true, sat: 0, ct: 260, colorMode: 'ct' });
      else if (act === 'brightness' && val !== undefined) touch(tid, { on: pct > 0, bri: pct });
      else if (act === 'hue' && val !== undefined) touch(tid, { on: true, hue: val, sat: 90, colorMode: 'hs' });
      else if (act === 'saturation' && val !== undefined) touch(tid, { on: true, sat: Math.max(0, Math.min(100, val)), colorMode: 'hs' });
      else if ((act === 'color_temp' || act === 'kelvin') && val !== undefined) touch(tid, { on: true, ct: val > 100 ? val : Math.round(153 + (val / 100) * 217), sat: 0, colorMode: 'ct' });
    }
  }

  _readHbBridgeCreds() {
    try {
      const cfg = JSON.parse(fs.readFileSync(this.hbConfigPath, 'utf8'));
      return { port: Number(cfg.bridge?.port) || 51826, pin: String(cfg.bridge?.pin || '031-45-155') };
    } catch (_) { return { port: 51826, pin: '031-45-155' }; }
  }

  async listRealHomebridgeDevices() {
    const { port, pin } = this._readHbBridgeCreds();
    return new Promise((resolve) => {
      const req = http.request({ hostname: '127.0.0.1', port, path: '/accessories', method: 'GET', timeout: 2000, headers: { authorization: pin } }, (res) => {
        let b = ''; res.on('data', (c) => (b += c));
        res.on('end', () => {
          try {
            const j = JSON.parse(b), out = [];
            for (const acc of (j.accessories || [])) {
              let accName = '', serial = '';
              for (const s of (acc.services || [])) {
                for (const c of (s.characteristics || [])) {
                  if (c.description === 'Name' && !accName && typeof c.value === 'string') accName = c.value;
                  if (c.description === 'Serial Number' && typeof c.value === 'string') serial = c.value;
                }
              }
              if (serial.startsWith('TWIN-') || (accName && accName.startsWith('[Virtual]'))) continue;
              for (const s of (acc.services || [])) {
                const chars = s.characteristics || [];
                const onChar = chars.find((c) => c.description === 'On');
                const posChar = chars.find((c) => c.description === 'Target Position');
                const briChar = chars.find((c) => c.description === 'Brightness');
                const hueChar = chars.find((c) => c.description === 'Hue');
                if (!onChar && !posChar) continue;
                const sName = chars.find((c) => c.description === 'Configured Name' || c.description === 'Name');
                const label = (sName && sName.value) ? String(sName.value) : (accName || `Accessory ${acc.aid}`);
                if (label === 'Learn' || label === 'Scan Frequency') continue;
                out.push({ key: `${acc.aid}:${s.iid}`, aid: acc.aid, name: label, kind: posChar ? 'cover' : (briChar ? 'light' : 'switch'), onIid: onChar?.iid || null, posIid: posChar?.iid || null, briIid: briChar?.iid || null, hueIid: hueChar?.iid || null });
              }
            }
            resolve(out);
          } catch (_) { resolve([]); }
        });
      });
      req.on('error', () => resolve([])); req.on('timeout', () => { req.destroy(); resolve([]); }); req.end();
    });
  }

  _executeMatchingRealRules(remoteHex, z, act, val, normPct) {
    const fired = [];
    for (const rule of (this.routing.realRules || [])) {
      if (rule.enabled === false) continue;
      const rOk = (!rule.remoteHex || rule.remoteHex === '*' || String(rule.remoteHex).toUpperCase() === String(remoteHex).toUpperCase());
      const zOk = (rule.zone === '*' || Number(rule.zone) === Number(z));
      const aOk = (rule.control === '*' || rule.control === act);
      if (rOk && zOk && aOk) { this.executeSingleRealRule(rule, act, val, normPct); fired.push(rule.name || rule.id); }
    }
    return fired;
  }

  executeSingleRealRule(rule, incomingAct, rawVal, normPct) {
    const pct = (normPct !== undefined) ? normPct : ((rawVal !== undefined) ? sliderToFullPct(rawVal, 'rf', false) : 100);
    const deg = (rawVal !== undefined) ? Math.max(0, Math.min(360, Number(rawVal))) : 0;
    const tpl = (s) => String(s || '').replace(/\{\{pct\}\}/g, String(pct)).replace(/\{\{hue\}\}/g, String(deg)).replace(/\{\{action\}\}/g, String(incomingAct || 'on'));

    if (rule.targetType === 'mqtt' && this.mqtt) {
      this.mqtt.publish(tpl(rule.mqttTopic), tpl(rule.mqttPayload || '{"state":"ON"}'), false);
    } else if (rule.targetType === 'ha_event' && this.mqtt) {
      const slug = String(rule.haEventSlug || 'remote_event').replace(/[^a-zA-Z0-9_-]/g, '_');
      this.mqtt.publish(`milight/ha_triggers/${slug}`, JSON.stringify({ event: slug, action: incomingAct, pct, ts: new Date().toISOString() }), false);
    } else if (rule.targetType === 'webhook' && rule.webhookUrl) {
      try {
        const u = new URL(tpl(rule.webhookUrl)), mod = u.protocol === 'https:' ? https : http;
        const body = tpl(rule.webhookBody || '{}');
        const req = mod.request({ hostname: u.hostname, port: u.port || 80, path: u.pathname + u.search, method: 'POST', timeout: 2500, headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } }, (r) => r.resume());
        req.on('error', () => {}); req.write(body); req.end();
      } catch (_) {}
    } else if (rule.targetType === 'homebridge_hap' && rule.hapTarget) {
      const { port, pin } = this._readHbBridgeCreds();
      const ht = rule.hapTarget, mode = rule.hapOperation || 'follow', chList = [];
      if (ht.posIid) {
        const tp = mode === 'open' ? 100 : (mode === 'close' ? 0 : (incomingAct === 'off' ? 0 : (incomingAct === 'on' ? 100 : pct)));
        chList.push({ aid: Number(ht.aid), iid: Number(ht.posIid), value: tp });
      } else if (ht.onIid) {
        const v = mode === 'open' ? true : (mode === 'close' ? false : incomingAct !== 'off');
        chList.push({ aid: Number(ht.aid), iid: Number(ht.onIid), value: v });
        if (ht.briIid && incomingAct === 'brightness') chList.push({ aid: Number(ht.aid), iid: Number(ht.briIid), value: pct });
      }
      if (chList.length) {
        const body = JSON.stringify({ characteristics: chList });
        const req = http.request({ hostname: '127.0.0.1', port, path: '/characteristics', method: 'PUT', timeout: 2500, headers: { authorization: pin, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } }, (r) => r.resume());
        req.on('error', () => {}); req.write(body); req.end();
      }
    }
  }

  applyExternalPatch(id, patch, source = 'ui') {
    const dev = this.devices.get(id);
    if (!dev) return null;
    Object.assign(dev, patch);
    if (['curtain','blind','garage','gate'].includes(dev.kind)) {
      if (patch.open !== undefined && patch.position === undefined) dev.position = dev.open ? 100 : 0;
      if (patch.position !== undefined) dev.open = Number(dev.position) > 3;
    }
    this._publishTwinState(dev);
    this.emit('deviceUpdated', dev, source);
    this._broadcastSse('state_patch', { source, device: dev });
    return dev;
  }

  _onExternalSet(topic, payload) {
    const parts = topic.split('/'), id = parts[parts.length - 2];
    let patch = {};
    try { patch = JSON.parse(payload); } catch (_) {}
    this.applyExternalPatch(id, patch, 'mqtt_ha');
  }

  _publishTwinState(dev) { if (this.mqtt) this.mqtt.publish(`${this.twinBase}/${dev.id}/state`, JSON.stringify(dev), true); }
  getSnapshot() { return { devices: Array.from(this.devices.values()), remotes: Array.from(this.remotesByPrefix.values()), lastEvent: this.lastEvent, routing: this.routing }; }
  _broadcastSse(ev, obj) { const m = `event: ${ev}\ndata: ${JSON.stringify(obj)}\n\n`; for (const r of this.sseClients) { try { r.write(m); } catch (_) { this.sseClients.delete(r); } } }

  _startHttpServer() {
    const pubIndex = path.join(__dirname, 'twin3d.html');
    this.httpServer = http.createServer(async (req, res) => {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
      if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
      const u = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
      const readJson = () => new Promise((r) => { let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => { try { r(JSON.parse(b || '{}')); } catch (_) { r({}); } }); });

      if (u.pathname === '/miboxer_catalog.js' || u.pathname === '/three.min.js') {
        const fp = path.join(__dirname, '..', 'homebridge-ui', 'public', u.pathname.slice(1));
        fs.readFile(fp, (err, buf) => { if (err) { res.writeHead(404); res.end(); return; } res.writeHead(200, { 'Content-Type': 'application/javascript' }); res.end(buf); });
      } else if (req.method === 'GET' && u.pathname === '/api/remotes') {
        const reqHub = http.get(`${this.hubUrl}/api/remotes`, { timeout: 2000 }, (hRes) => {
          let b = ''; hRes.on('data', (c) => (b += c));
          hRes.on('end', () => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(b || JSON.stringify(Array.from(this.remotesByPrefix.values()))); });
        });
        reqHub.on('error', () => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(Array.from(this.remotesByPrefix.values()))); });
        reqHub.on('timeout', () => reqHub.destroy());
      } else if (req.method === 'GET' && u.pathname === '/api/stream') {
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive' });
        res.write(`event: init\ndata: ${JSON.stringify(this.getSnapshot())}\n\n`);
        this.sseClients.add(res);
        req.on('close', () => this.sseClients.delete(res));
      } else if (req.method === 'GET' && u.pathname === '/api/state') {
        res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(this.getSnapshot()));
      } else if (req.method === 'GET' && u.pathname === '/api/routing') {
        res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ routing: this.routing, factoryDefaults: FACTORY_SANDBOX_BINDINGS }));
      } else if (req.method === 'POST' && u.pathname === '/api/routing') {
        const b = await readJson();
        if (typeof b.sandboxEnabled === 'boolean') this.routing.sandboxEnabled = b.sandboxEnabled;
        if (Array.isArray(b.sandboxBindings)) this.routing.sandboxBindings = b.sandboxBindings;
        if (Array.isArray(b.realRules)) this.routing.realRules = b.realRules;
        this._saveRoutingStore();
        res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ ok: true, routing: this.routing }));
      } else if (req.method === 'POST' && u.pathname === '/api/routing/reset_defaults') {
        res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ ok: true, routing: this.resetSandboxDefaults() }));
      } else if (req.method === 'GET' && u.pathname === '/api/real_devices') {
        res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ devices: await this.listRealHomebridgeDevices() }));
      } else if (req.method === 'POST' && u.pathname === '/api/test_rule') {
        const b = await readJson(); if (b && b.rule) this.executeSingleRealRule(b.rule, b.rule.control === '*' ? 'on' : (b.rule.control || 'on'), 180);
        res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ ok: true }));
      } else if (req.method === 'POST' && u.pathname === '/api/command') {
        const p = await readJson(), id = p.id; delete p.id;
        res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ ok: true, device: this.applyExternalPatch(id, p, 'web3d') }));
      } else if (req.method === 'POST' && u.pathname === '/api/virtual_send') {
        const p = await readJson();
        const devId = Number(p.device_id || 0), hex = '0x' + devId.toString(16).toUpperCase().padStart(4, '0'), z = Number(p.group_id ?? 0);
        this.uiTxMarks.set(`${hex}:${z}`, { ts: Date.now(), act: String(p.action || '').toLowerCase(), uiPct: p.value !== undefined ? Number(p.value) : undefined });
        const postStr = JSON.stringify(p), hu = new URL(`${this.hubUrl}/api/remotes/virtual_send`);
        const hReq = http.request({ hostname: hu.hostname, port: hu.port || 80, path: hu.pathname, method: 'POST', timeout: 2500, headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(postStr) } }, (hr) => { hr.resume(); res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{"ok":true}'); });
        hReq.on('error', () => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{"ok":true}'); });
        hReq.write(postStr); hReq.end();
      } else {
        fs.readFile(pubIndex, 'utf8', (err, html) => {
          if (err) { res.writeHead(200); res.end('MiLight Smart Twin Running'); return; }
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(html);
        });
      }
    });
    this.httpServer.on('error', () => {});
    this.httpServer.listen(this.httpPort, '0.0.0.0');
  }
}

module.exports = { SmartHomeTwinEngine, MiniMqttClient, DEFAULT_DEVICES, FACTORY_SANDBOX_BINDINGS, SCENE_ORDER };
