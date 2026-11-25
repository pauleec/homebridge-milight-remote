'use strict';

const { SmartHomeTwinEngine, MiniMqttClient } = require('./smart-twin/twin_engine');

const PLUGIN_NAME = 'homebridge-milight-remote';
const PLATFORM_NAME = 'MiLightRemotePlatform';

module.exports = (api) => {
  api.registerPlatform(PLUGIN_NAME, PLATFORM_NAME, MiLightRemotePlatform);
};

class MiLightRemotePlatform {
  constructor(log, config, api) {
    this.log = log;
    this.config = config || {};
    this.api = api;
    this.accessories = new Map();
    this.twinAccMap = new Map();
    this.prefixMap = new Map();

    this.mqttHost = this.config.mqttHost || '127.0.0.1';
    this.mqttPort = Number(this.config.mqttPort) || 1883;
    this.hubUrl = String(this.config.hubUrl || 'http://milight-hub.local').replace(/\/+$/, '');
    this.defaultMode = this.config.exposureMode || 'none';
    this.enableTwin = (this.config.enableSmartHomeTwin !== false);
    this.twinPort = Number(this.config.twinPort) || 8588;

    this.api.on('didFinishLaunching', () => this._start());
  }

  configureAccessory(accessory) {
    this.accessories.set(accessory.UUID, accessory);
  }

  _start() {
    if (this.enableTwin) {
      this.twin = new SmartHomeTwinEngine({
        mqttHost: this.mqttHost,
        mqttPort: this.mqttPort,
        httpPort: this.twinPort,
        hubUrl: this.hubUrl,
        haDiscovery: this.config.haDiscovery !== false,
        hbConfigPath: this.api.user.configPath(),
        log: this.log
      });
      this.twin.start();
      for (const dev of this.twin.devices.values()) {
        this._ensureTwinAccessory(dev);
      }
      this.twin.on('deviceUpdated', (dev, src) => {
        if (src !== 'homekit') this._syncTwinToHomeKit(dev);
      });
    }

    this.mqtt = new MiniMqttClient(this.mqttHost, this.mqttPort, null, this.log);
    this.mqtt.subscribe(this.config.registryTopic || 'milight/remotes_registry/#');
    this.mqtt.on('message', (topic, payload, isRetained) => {
      if (topic.startsWith('milight/remotes_registry/')) {
        this._handleRegistry(payload);
      } else if (!isRetained && topic.endsWith('/event')) {
        this._handleRemoteEvent(topic, payload);
      }
    });
    this.mqtt.connect();
  }

  _handleRegistry(payload) {
    if (!payload || !payload.trim()) return;
    try {
      const m = JSON.parse(payload);
      const devId = Number(m.device_id ?? m.id ?? 0);
      if (!devId) return;
      const hex = '0x' + devId.toString(16).toUpperCase().padStart(4, '0');
      const uuid = this.api.hap.uuid.generate(`milight-remote-${hex}`);
      const effMode = this.defaultMode;
      const prefix = String(m.topic_prefix || m.prefix || `milight/actions/rem_${devId.toString(16).toLowerCase()}`).replace(/\/+$/, '');

      if (m.active === false || effMode === 'none' || effMode === 'ignore') {
        const existing = this.accessories.get(uuid);
        if (existing) {
          this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [existing]);
          this.accessories.delete(uuid);
        }
        this.prefixMap.set(prefix, { uuid, acc: null, prefix, hex });
        this.mqtt.subscribe(`${prefix}/zone/+/event`);
        return;
      }

      const S = this.api.hap.Service, C = this.api.hap.Characteristic;
      const numZones = Math.min(Math.max(Number(m.num_zones ?? m.zones ?? 8), 1), 16);
      const friendlyName = m.name || `MiBoxer Remote (${hex})`;
      let acc = this.accessories.get(uuid);
      const isNew = !acc;
      if (isNew) acc = new this.api.platformAccessory(friendlyName, uuid);
      acc.getService(S.AccessoryInformation)
        .setCharacteristic(C.Manufacturer, 'MiBoxer / Mi-Light')
        .setCharacteristic(C.Model, m.visual_model || 'FUT089')
        .setCharacteristic(C.SerialNumber, hex);

      const lbl = acc.getService(S.ServiceLabel) || acc.addService(S.ServiceLabel, friendlyName);
      lbl.setCharacteristic(C.ServiceLabelNamespace, C.ServiceLabelNamespace.ARABIC_NUMERALS);
      for (let z = 0; z <= numZones; z++) {
        const sub = `zone-${z}`;
        const zName = z === 0 ? 'All Zones Master' : `Zone ${z}`;
        const sw = acc.getServiceById(S.StatelessProgrammableSwitch, sub) || acc.addService(S.StatelessProgrammableSwitch, zName, sub);
        sw.setCharacteristic(C.Name, zName);
        sw.setCharacteristic(C.ServiceLabelIndex, z + 1);
      }
      if (isNew) {
        this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [acc]);
        this.accessories.set(uuid, acc);
      }
      this.prefixMap.set(prefix, { uuid, acc, prefix, hex });
      this.mqtt.subscribe(`${prefix}/zone/+/event`);
    } catch (_) {}
  }

  _handleRemoteEvent(topic, payload) {
    const m = topic.match(/^(.*)\/zone\/(\d+)\/event$/);
    if (!m) return;
    const entry = this.prefixMap.get(m[1]);
    if (!entry || !entry.acc) return;
    const z = Number(m[2]);
    let data = {};
    try { data = JSON.parse(payload); } catch (_) {}
    const act = String(data.gesture_action || data.action || '').toLowerCase();
    const gest = String(data.gesture || 'single').toLowerCase();
    const C = this.api.hap.Characteristic, S = this.api.hap.Service;
    const hkEvent = (gest === 'long' || act === 'night_mode')
      ? C.ProgrammableSwitchEvent.LONG_PRESS
      : (gest === 'double' || gest === 'triple' || act.endsWith('_double') || act === 'set_white' || act === 'mode')
      ? C.ProgrammableSwitchEvent.DOUBLE_PRESS
      : C.ProgrammableSwitchEvent.SINGLE_PRESS;
    const sw = entry.acc.getServiceById(S.StatelessProgrammableSwitch, `zone-${z}`);
    if (sw) sw.getCharacteristic(C.ProgrammableSwitchEvent).updateValue(hkEvent);
  }

  _ensureTwinAccessory(dev) {
    const S = this.api.hap.Service, C = this.api.hap.Characteristic;
    const uuid = this.api.hap.uuid.generate(`milight-smart-twin-${dev.id}`);
    let acc = this.accessories.get(uuid);
    const isNew = !acc;
    if (isNew) acc = new this.api.platformAccessory(dev.name, uuid);
    acc.displayName = dev.name;

    acc.getService(S.AccessoryInformation)
      .setCharacteristic(C.Manufacturer, 'MiBoxer Smart Twin')
      .setCharacteristic(C.Model, `Virtual ${dev.kind.toUpperCase()}`)
      .setCharacteristic(C.SerialNumber, `TWIN-${dev.id.toUpperCase()}`);

    const svcMap = {
      curtain: S.WindowCovering, blind: S.WindowCovering,
      garage: S.GarageDoorOpener, gate: S.GarageDoorOpener,
      ac: S.Thermostat, radiator: S.Thermostat,
      fan: S.Fanv2, sprinkler: S.Valve,
      rgb_light: S.Lightbulb, scene: S.Switch
    };
    const targetSvcType = svcMap[dev.kind] || S.Switch;
    const svc = acc.getService(targetSvcType) || acc.addService(targetSvcType, dev.name);
    svc.setCharacteristic(C.Name, dev.name);
    if (C.ConfiguredName) svc.setCharacteristic(C.ConfiguredName, dev.name);

    const pushPatch = (patch) => this.twin.applyExternalPatch(dev.id, patch, 'homekit');

    if (dev.kind === 'curtain' || dev.kind === 'blind') {
      svc.getCharacteristic(C.TargetPosition).onSet((v) => pushPatch({ position: Number(v), open: Number(v) > 3 }));
    } else if (dev.kind === 'garage' || dev.kind === 'gate') {
      svc.getCharacteristic(C.TargetDoorState).onSet((v) => {
        const open = (v === C.TargetDoorState.OPEN);
        pushPatch({ open, position: open ? 100 : 0 });
      });
    } else if (dev.kind === 'ac' || dev.kind === 'radiator') {
      svc.getCharacteristic(C.TargetHeatingCoolingState).onSet((v) => {
        const hvacMode = v === C.TargetHeatingCoolingState.OFF ? 'off' : (v === C.TargetHeatingCoolingState.HEAT ? 'heat' : 'cool');
        pushPatch({ active: hvacMode !== 'off', hvacMode });
      });
      svc.getCharacteristic(C.TargetTemperature).setProps({ minValue: 16, maxValue: 30, minStep: 1 }).onSet((v) => pushPatch({ targetTemp: Number(v) }));
    } else if (dev.kind === 'fan') {
      svc.getCharacteristic(C.Active).onSet((v) => pushPatch({ active: Boolean(v) }));
      svc.getCharacteristic(C.RotationSpeed).onSet((v) => pushPatch({ speed: Number(v), active: Number(v) > 0 }));
    } else if (dev.kind === 'sprinkler') {
      svc.setCharacteristic(C.ValveType, C.ValveType.IRRIGATION);
      svc.getCharacteristic(C.Active).onSet((v) => pushPatch({ active: Boolean(v) }));
    } else if (dev.kind === 'rgb_light') {
      svc.getCharacteristic(C.On).onSet((v) => pushPatch({ on: Boolean(v) }));
      svc.getCharacteristic(C.Brightness).onSet((v) => pushPatch({ bri: Number(v), on: Number(v) > 0 }));
      svc.getCharacteristic(C.Hue).onSet((v) => pushPatch({ hue: Number(v), colorMode: 'hs' }));
      svc.getCharacteristic(C.Saturation).onSet((v) => pushPatch({ sat: Number(v), colorMode: 'hs' }));
    } else {
      svc.getCharacteristic(C.On).onSet((v) => pushPatch({ on: Boolean(v), scene: v ? 'party' : 'day' }));
    }

    if (isNew) {
      this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [acc]);
      this.accessories.set(uuid, acc);
    } else {
      this.api.updatePlatformAccessories([acc]);
    }
    this.twinAccMap.set(dev.id, { acc, svc });
    this._syncTwinToHomeKit(dev);
  }

  _syncTwinToHomeKit(dev) {
    const item = this.twinAccMap.get(dev.id);
    if (!item) return;
    const { svc } = item;
    const C = this.api.hap.Characteristic;
    if (dev.kind === 'curtain' || dev.kind === 'blind') {
      svc.updateCharacteristic(C.CurrentPosition, dev.position || 0);
      svc.updateCharacteristic(C.TargetPosition, dev.position || 0);
      svc.updateCharacteristic(C.PositionState, C.PositionState.STOPPED);
    } else if (dev.kind === 'garage' || dev.kind === 'gate') {
      svc.updateCharacteristic(C.CurrentDoorState, dev.open ? C.CurrentDoorState.OPEN : C.CurrentDoorState.CLOSED);
      svc.updateCharacteristic(C.TargetDoorState, dev.open ? C.TargetDoorState.OPEN : C.TargetDoorState.CLOSED);
    } else if (dev.kind === 'ac' || dev.kind === 'radiator') {
      const curSt = !dev.active || dev.hvacMode === 'off' ? C.CurrentHeatingCoolingState.OFF : (dev.hvacMode === 'heat' ? C.CurrentHeatingCoolingState.HEAT : C.CurrentHeatingCoolingState.COOL);
      const tgtSt = !dev.active || dev.hvacMode === 'off' ? C.TargetHeatingCoolingState.OFF : (dev.hvacMode === 'heat' ? C.TargetHeatingCoolingState.HEAT : C.TargetHeatingCoolingState.COOL);
      svc.updateCharacteristic(C.CurrentHeatingCoolingState, curSt);
      svc.updateCharacteristic(C.TargetHeatingCoolingState, tgtSt);
      svc.updateCharacteristic(C.CurrentTemperature, dev.currentTemp || 21);
      svc.updateCharacteristic(C.TargetTemperature, dev.targetTemp || 21);
    } else if (dev.kind === 'fan') {
      svc.updateCharacteristic(C.Active, dev.active ? 1 : 0);
      svc.updateCharacteristic(C.RotationSpeed, dev.speed || 0);
    } else if (dev.kind === 'sprinkler') {
      svc.updateCharacteristic(C.Active, dev.active ? 1 : 0);
      svc.updateCharacteristic(C.InUse, dev.active ? 1 : 0);
    } else if (dev.kind === 'rgb_light') {
      svc.updateCharacteristic(C.On, Boolean(dev.on));
      svc.updateCharacteristic(C.Brightness, dev.bri || 0);
      svc.updateCharacteristic(C.Hue, dev.hue || 0);
      svc.updateCharacteristic(C.Saturation, dev.sat || 0);
    } else {
      svc.updateCharacteristic(C.On, Boolean(dev.on));
    }
  }
}
