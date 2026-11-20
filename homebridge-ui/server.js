'use strict';

const fs = require('fs');
const os = require('os');
const http = require('http');
const { HomebridgePluginUiServer } = require('@homebridge/plugin-ui-utils');

function detectLanIp() {
  const nets = os.networkInterfaces();
  for (const list of Object.values(nets)) {
    for (const iface of (list || [])) {
      if (iface.family === 'IPv4' && !iface.internal) return iface.address;
    }
  }
  return '127.0.0.1';
}

class MiLightRemoteUiServer extends HomebridgePluginUiServer {
  constructor() {
    super();
    this.onRequest('/host-info', async () => {
      const cfg = this._readPlatformConfig();
      return { lanIp: detectLanIp(), twinPort: Number(cfg.twinPort) || 8588, hubUrl: String(cfg.hubUrl || 'http://192.168.7.121').replace(/\/+$/, '') };
    });
    this.onRequest('/remotes', async () => {
      const hubUrl = String(this._readPlatformConfig().hubUrl || 'http://192.168.7.121').replace(/\/+$/, '');
      try { const d = await this._httpGetJson(`${hubUrl}/api/remotes`); return Array.isArray(d) ? d : []; } catch (e) { return { error: e.message, remotes: [] }; }
    });
    this.onRequest('/last-event', async () => {
      const hubUrl = String(this._readPlatformConfig().hubUrl || 'http://192.168.7.121').replace(/\/+$/, '');
      try { return await this._httpGetJson(`${hubUrl}/api/remotes/last_seen`); } catch (e) { return { error: e.message }; }
    });
    this.onRequest('/twin-state', async () => {
      const p = Number(this._readPlatformConfig().twinPort) || 8588;
      try { return await this._httpGetJson(`http://127.0.0.1:${p}/api/state`); } catch (e) { return { devices: [] }; }
    });
    this.onRequest('/twin-cmd', async (payload) => {
      const p = Number(this._readPlatformConfig().twinPort) || 8588;
      try { return await this._httpPostJson(`http://127.0.0.1:${p}/api/command`, payload || {}); } catch (e) { return { error: e.message }; }
    });
    this.onRequest('/routing-get', async () => {
      const p = Number(this._readPlatformConfig().twinPort) || 8588;
      try { return await this._httpGetJson(`http://127.0.0.1:${p}/api/routing`); } catch (e) { return { error: e.message }; }
    });
    this.onRequest('/routing-save', async (payload) => {
      const p = Number(this._readPlatformConfig().twinPort) || 8588;
      try { return await this._httpPostJson(`http://127.0.0.1:${p}/api/routing`, payload || {}); } catch (e) { return { error: e.message }; }
    });
    this.onRequest('/routing-reset', async () => {
      const p = Number(this._readPlatformConfig().twinPort) || 8588;
      try { return await this._httpPostJson(`http://127.0.0.1:${p}/api/routing/reset_defaults`, {}); } catch (e) { return { error: e.message }; }
    });
    this.onRequest('/real-devices', async () => {
      const p = Number(this._readPlatformConfig().twinPort) || 8588;
      try { return await this._httpGetJson(`http://127.0.0.1:${p}/api/real_devices`); } catch (_) { return { devices: [] }; }
    });
    this.onRequest('/test-rule', async (payload) => {
      const p = Number(this._readPlatformConfig().twinPort) || 8588;
      try { return await this._httpPostJson(`http://127.0.0.1:${p}/api/test_rule`, payload || {}); } catch (e) { return { error: e.message }; }
    });
    this.onRequest('/virtual-send', async (payload) => {
      const cfg = this._readPlatformConfig();
      const p = Number(cfg.twinPort) || 8588;
      const hubUrl = String(cfg.hubUrl || 'http://192.168.7.121').replace(/\/+$/, '');
      try { return await this._httpPostJson(`http://127.0.0.1:${p}/api/virtual_send`, payload || {}); }
      catch (_) { return await this._httpPostJson(`${hubUrl}/api/remotes/virtual_send`, payload || {}); }
    });
    this.ready();
  }

  _readPlatformConfig() {
    try {
      const cfgPath = process.env.UIX_CONFIG_PATH || '/var/lib/homebridge/config.json';
      const raw = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
      return (raw.platforms || []).find((p) => p.platform === 'MiLightRemotePlatform') || {};
    } catch (_) { return {}; }
  }

  _httpGetJson(urlStr) {
    return new Promise((resolve, reject) => {
      const req = http.get(urlStr, { timeout: 2500 }, (res) => {
        let b = ''; res.on('data', (d) => (b += d));
        res.on('end', () => { try { resolve(JSON.parse(b)); } catch (_) { resolve({}); } });
      });
      req.on('error', reject);
      req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
    });
  }

  _httpPostJson(urlStr, payload) {
    return new Promise((resolve, reject) => {
      const data = JSON.stringify(payload || {});
      const u = new URL(urlStr);
      const req = http.request({
        hostname: u.hostname, port: u.port || 80, path: u.pathname + u.search,
        method: 'POST', timeout: 3000,
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) }
      }, (res) => {
        let b = ''; res.on('data', (d) => (b += d));
        res.on('end', () => { try { resolve(JSON.parse(b)); } catch (_) { resolve({ status: res.statusCode, body: b }); } });
      });
      req.on('error', reject);
      req.on('timeout', () => { req.destroy(); reject(new Error('POST timeout')); });
      req.write(data); req.end();
    });
  }
}

(() => new MiLightRemoteUiServer())();
