(function(root) {
  'use strict';
  const SVG_NS = 'http://www.w3.org/2000/svg';

  const ACT_TO_SVG = {
    on: ['on', 'zone_on'], off: ['off', 'zone_off'],
    set_white: ['set_white', 'on'], night_mode: ['night_mode', 'off'],
    brightness: ['brightness'], level: ['brightness'],
    kelvin: ['kelvin'], color_temp: ['kelvin'], temperature: ['kelvin'],
    saturation: ['saturation'], hue: ['hue'],
    mode: ['mode'], next_mode: ['mode', 'mode_speed_up'], previous_mode: ['mode', 'mode_speed_down'],
    mode_speed_up: ['mode_speed_up'], mode_speed_down: ['mode_speed_down']
  };

  function polarPt(cx, cy, r, deg) {
    const rad = ((deg - 90) * Math.PI) / 180;
    return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
  }

  function ringWedge(cx, cy, rIn, rOut, sDeg, eDeg) {
    const p1 = polarPt(cx, cy, rOut, eDeg), p2 = polarPt(cx, cy, rOut, sDeg);
    const p3 = polarPt(cx, cy, rIn, sDeg), p4 = polarPt(cx, cy, rIn, eDeg);
    const lg = eDeg - sDeg <= 180 ? '0' : '1';
    return `M ${p1.x.toFixed(1)} ${p1.y.toFixed(1)} A ${rOut.toFixed(1)} ${rOut.toFixed(1)} 0 ${lg} 0 ${p2.x.toFixed(1)} ${p2.y.toFixed(1)} L ${p3.x.toFixed(1)} ${p3.y.toFixed(1)} A ${rIn.toFixed(1)} ${rIn.toFixed(1)} 0 ${lg} 1 ${p4.x.toFixed(1)} ${p4.y.toFixed(1)} Z`;
  }

  function normalizeTouchZones(tz) {
    const def = (segs) => ({ enabled: false, segments: segs, offset_deg: 0, zone_mask: 65535, labels: Array(segs).fill('') });
    const src = tz || {};
    const normOne = (s, dSegs) => {
      if (!s) return def(dSegs);
      const n = Number(s.segments || dSegs);
      const arr = Array.isArray(s.labels) ? s.labels.slice(0, 12) : [];
      while (arr.length < n) arr.push('');
      return {
        enabled: Boolean(s.enabled),
        segments: n,
        offset_deg: Number(s.offset_deg ?? s.offsetDeg ?? 0),
        zone_mask: Number(s.zone_mask ?? s.zoneMask ?? 65535),
        labels: arr
      };
    };
    return {
      hue_ring: normOne(src.hue_ring, 6),
      cct_bar: normOne(src.cct_bar, 4),
      sat_bar: normOne(src.sat_bar, 3),
      bri_bar: normOne(src.bri_bar, 4)
    };
  }

  function defaultCalibration() {
    return { hue_offset: 0, hue_invert: false, bri_min: 0, bri_max: 100, bri_invert: false, cct_min: 0, cct_max: 100, cct_invert: false, sat_min: 0, sat_max: 100, sat_invert: false };
  }

  function isHostDark() {
    if (document.documentElement.classList.contains('dark') || document.body.classList.contains('dark')) return true;
    const parseLum = (str) => {
      if (!str || str === 'transparent') return null;
      const m = String(str).match(/[\d.]+/g);
      if (!m || m.length < 3) return null;
      if (m.length >= 4 && Number(m[3]) < 0.15) return null; // Ignore transparent rgba(0,0,0,0)!
      return (0.299 * Number(m[0]) + 0.587 * Number(m[1]) + 0.114 * Number(m[2])) / 255;
    };
    // Check Home Assistant CSS variables first if hosted inside HA
    const haEl = document.querySelector('home-assistant') || document.documentElement;
    const haBg = getComputedStyle(haEl).getPropertyValue('--primary-background-color').trim() ||
                 getComputedStyle(haEl).getPropertyValue('--card-background-color').trim();
    if (haBg && haBg.startsWith('#')) {
      const hex = haBg.slice(1);
      const full = hex.length === 3 ? hex.split('').map(c => c + c).join('') : hex;
      if (full.length === 6) {
        const r = parseInt(full.slice(0, 2), 16), g = parseInt(full.slice(2, 4), 16), b = parseInt(full.slice(4, 6), 16);
        return ((0.299 * r + 0.587 * g + 0.114 * b) / 255) < 0.45;
      }
    }
    const candidates = [haBg, getComputedStyle(document.body).backgroundColor, getComputedStyle(document.documentElement).backgroundColor];
    for (const c of candidates) {
      const lum = parseLum(c);
      if (lum !== null) return lum < 0.45;
    }
    return false; // Default to clean Light Mode stylesheet
  }

  function injectStudioStyles(contextEl) {
    const cssText = `
      .mbx-hit, .mbx-seg-hit { transition: filter 0.12s ease, stroke-width 0.12s ease; touch-action: none; }
      .mbx-hit.zone-active { stroke: #ea580c !important; stroke-width: 2.2px !important; }
      .mbx-hit.fire-rf, .mbx-seg-hit.fire-rf { stroke: #16a34a !important; stroke-width: 2.8px !important; filter: drop-shadow(0 0 6px rgba(22,163,74,0.75)); }
      .mbx-hit.fire-ui, .mbx-seg-hit.fire-ui { stroke: #ea580c !important; stroke-width: 2.8px !important; filter: drop-shadow(0 0 6px rgba(234,88,12,0.75)); }

      .mlrs-modal-backdrop {
        --mlrs-bg: #ffffff; --mlrs-fg: #0f172a; --mlrs-muted: #f8fafc; --mlrs-muted-fg: #64748b;
        --mlrs-border: #e2e8f0; --mlrs-input-bg: #ffffff; --mlrs-primary: #0f172a; --mlrs-primary-fg: #ffffff;
        --mlrs-hover: #f1f5f9; --mlrs-ring: #0284c7;
        position: fixed; inset: 0; z-index: 9999; background: rgba(15, 23, 42, 0.48); backdrop-filter: blur(2px);
        display: flex; align-items: center; justify-content: center; padding: 14px;
        font-family: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; color: var(--mlrs-fg);
      }
      .mlrs-modal-backdrop.mlrs-dark {
        --mlrs-bg: #09090b; --mlrs-fg: #f8fafc; --mlrs-muted: #18181b; --mlrs-muted-fg: #a1a1aa;
        --mlrs-border: #27272a; --mlrs-input-bg: #09090b; --mlrs-primary: #f8fafc; --mlrs-primary-fg: #09090b;
        --mlrs-hover: #27272a; --mlrs-ring: #38bdf8; background: rgba(0, 0, 0, 0.72);
      }
      .mlrs-modal {
        background: var(--mlrs-bg); color: var(--mlrs-fg); border: 1px solid var(--mlrs-border); border-radius: 12px;
        width: 96vw; max-width: 1840px; height: 94vh; display: flex; flex-direction: column; overflow: hidden;
        box-shadow: 0 20px 45px -10px rgba(15, 23, 42, 0.25);
      }
      .mlrs-topbar { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 12px; padding: 14px 20px; background: var(--mlrs-bg); border-bottom: 1px solid var(--mlrs-border); }
      .mlrs-preset-bar { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; padding: 9px 20px; background: var(--mlrs-muted); border-bottom: 1px solid var(--mlrs-border); font-size: 12px; }
      .mlrs-body { display: grid; grid-template-columns: minmax(290px, 355px) minmax(0, 1fr) minmax(315px, 405px); flex: 1; min-height: 0; overflow: hidden; }
      .mlrs-modal *, .mlrs-modal *::before, .mlrs-modal *::after { box-sizing: border-box; }
      @media (max-width: 1040px) { .mlrs-body { grid-template-columns: 1fr; overflow-y: auto; } }
      .mlrs-col { padding: 14px 16px; overflow-y: auto; overflow-x: hidden; min-width: 0; border-right: 1px solid var(--mlrs-border); background: var(--mlrs-bg); }
      .mlrs-col:last-child { border-right: none; border-left: 1px solid var(--mlrs-border); }
      .mlrs-stage-wrap { display: flex; flex-direction: column; align-items: center; justify-content: center; background: var(--mlrs-muted); padding: 16px; overflow: auto; }
      
      @keyframes mlrsSpotPulse {
        0%, 100% { box-shadow: 0 0 0 2px #f59e0b, 0 0 14px rgba(245, 158, 11, 0.45); }
        50%      { box-shadow: 0 0 0 3.5px #0ea5e9, 0 0 22px rgba(14, 165, 233, 0.55); }
      }
      .mlrs-tour-focus {
        border-radius: 8px !important;
        animation: mlrsSpotPulse 1.8s ease-in-out infinite !important;
        position: relative;
        z-index: 5;
      }
      .mlrs-tour-done-badge {
        display: inline-flex; align-items: center; gap: 4px; padding: 2px 8px;
        border-radius: 999px; font-size: 11px; font-weight: 700;
        background: #dcfce7; color: #166534; border: 1px solid #86efac;
      }
      .mlrs-tour-pending-badge {
        display: inline-flex; align-items: center; gap: 4px; padding: 2px 8px;
        border-radius: 999px; font-size: 11px; font-weight: 700;
        background: #fef3c7; color: #92400e; border: 1px solid #fcd34d;
      }
      .mlrs-stage-wrap.mlrs-night-room {
        background: radial-gradient(circle at 50% 42%, #0f172a 0%, #030712 78%) !important;
      }
      .mlrs-stage-wrap.mlrs-night-room .mlrs-stage-card {
        background: #060a13 !important;
        border-color: rgba(110, 231, 183, 0.35) !important;
        box-shadow: 0 0 38px rgba(16, 185, 129, 0.18), inset 0 0 18px rgba(16, 185, 129, 0.06) !important;
      }
      .mlrs-launcher-card {
        background: #ffffff !important; border: 1px solid #cbd5e1 !important;
        border-radius: 10px !important; padding: 9px 12px !important; margin: 0 0 10px 0 !important;
        box-shadow: 0 1px 4px rgba(15, 23, 42, 0.05) !important; color: #0f172a !important;
      }
      .mlrs-launcher-grid {
        display: grid !important; grid-template-columns: repeat(3, minmax(0, 1fr)) !important; gap: 7px !important; margin-top: 7px !important;
      }
      @media (max-width: 960px) { .mlrs-launcher-grid { grid-template-columns: repeat(2, minmax(0, 1fr)) !important; } }
      button.mlrs-wf-item, .mlrs-wf-item {
        display: flex !important; align-items: center !important; gap: 9px !important; text-align: left !important;
        background: #f8fafc !important; color: #0f172a !important; border: 1px solid #cbd5e1 !important;
        border-radius: 8px !important; padding: 7px 10px !important; cursor: pointer !important;
        font-weight: 500 !important; box-shadow: none !important; width: 100% !important;
        transition: transform 0.1s ease, border-color 0.15s ease, background 0.15s ease !important;
      }
      button.mlrs-wf-item:hover, .mlrs-wf-item:hover {
        border-color: #0284c7 !important; background: #f0f9ff !important; filter: none !important;
        box-shadow: 0 2px 6px rgba(2, 132, 199, 0.12) !important; transform: translateY(-1px) !important;
      }
      .mlrs-wf-ico {
        font-size: 15px !important; line-height: 1 !important; width: 28px !important; height: 28px !important; border-radius: 7px !important;
        background: #e0f2fe !important; border: 1px solid #bae6fd !important; display: flex !important; align-items: center !important; justify-content: center !important; flex-shrink: 0 !important;
      }
      .mlrs-lum-swatch {
        display: inline-block; width: 11px; height: 11px; border-radius: 50%;
        background: #6ee7b7; box-shadow: 0 0 8px #34d399, 0 0 14px #10b981;
      }
      .mlrs-stage-card { background: var(--mlrs-bg); border: 1px solid var(--mlrs-border); border-radius: 12px; padding: 20px 28px; display: flex; flex-direction: column; align-items: center; box-shadow: 0 1px 3px rgba(0,0,0,0.05); }
      .mlrs-footer { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 10px; padding: 11px 20px; background: var(--mlrs-bg); border-top: 1px solid var(--mlrs-border); }
      .mlrs-btn { background: var(--mlrs-bg); color: var(--mlrs-fg); border: 1px solid var(--mlrs-border); border-radius: 6px; padding: 6px 12px; font-size: 12.5px; font-weight: 500; cursor: pointer; display: inline-flex; align-items: center; gap: 6px; }
      .mlrs-btn:hover { background: var(--mlrs-hover); }
      .mlrs-btn.primary, .mlrs-btn.active-tab { background: var(--mlrs-primary); border-color: var(--mlrs-primary); color: var(--mlrs-primary-fg); font-weight: 600; }
      .mlrs-btn.danger-outline { color: #dc2626; border-color: #fecaca; }
      .mlrs-sec-title { font-size: 12.5px; font-weight: 700; color: var(--mlrs-fg); margin-bottom: 10px; }
      .mlrs-field { margin-bottom: 10px; }
      .mlrs-field label { display: block; font-size: 11.5px; font-weight: 600; color: var(--mlrs-fg); margin-bottom: 4px; }
      .mlrs-input, .mlrs-select { width: 100%; max-width: 100%; box-sizing: border-box; background: var(--mlrs-input-bg); border: 1px solid var(--mlrs-border); color: var(--mlrs-fg); border-radius: 6px; padding: 6px 9px; font-size: 12.5px; }
      .mlrs-swatch { height: 32px; padding: 2px 4px; cursor: pointer; }
      .mlrs-icon-grid { display: grid; grid-template-columns: repeat(6, 1fr); gap: 5px; }
      .mlrs-icon-cell { aspect-ratio: 1; border: 1px solid var(--mlrs-border); border-radius: 6px; background: var(--mlrs-input-bg); color: var(--mlrs-fg); display: flex; flex-direction: column; align-items: center; justify-content: center; cursor: pointer; padding: 3px; }
      .mlrs-icon-cell:hover { background: var(--mlrs-hover); }
      .mlrs-icon-cell.sel { border: 2px solid var(--mlrs-ring); background: var(--mlrs-hover); }
      .mlrs-pill-group { display: inline-flex; background: var(--mlrs-muted); padding: 3px; border-radius: 8px; border: 1px solid var(--mlrs-border); gap: 3px; }
      .mlrs-pill-group .mlrs-btn { border: none; padding: 5px 11px; font-size: 12px; border-radius: 6px; background: transparent; }
      .mlrs-pill-group .mlrs-btn.active-tab { background: var(--mlrs-primary); color: var(--mlrs-primary-fg); }

      
      .mlrs-modal-backdrop.mlrs-backdrop-fs, .mlrs-modal-backdrop:fullscreen { padding: 0 !important; width: 100vw !important; height: 100vh !important; }
      .mlrs-modal-backdrop:fullscreen .mlrs-modal { width: 100vw !important; max-width: 100vw !important; height: 100vh !important; border-radius: 0 !important; border: none !important; }
      .mlrs-modal.mlrs-fullscreen .mlrs-body, .mlrs-modal-backdrop:fullscreen .mlrs-body { grid-template-columns: 340px 1fr 390px !important; }

      .mlrs-modal.mlrs-fullscreen { width: 100vw !important; max-width: 100vw !important; height: 100vh !important; border-radius: 0 !important; border: none !important; }
      .mlrs-peel-wrap { display: flex; flex-direction: column; align-items: center; justify-content: center; width: 100%; height: 100%; flex: 1; min-height: 0; user-select: none; }
      .mlrs-peel-bar { display: flex; align-items: center; justify-content: center; gap: 8px; flex-wrap: wrap; margin-bottom: 8px; padding: 6px 10px; border-radius: 9px; border: 1px solid rgba(2,132,199,0.32); background: rgba(2,132,199,0.07); font-size: 11.5px; width: 100%; box-sizing: border-box; }
      .mlrs-peel-btn { padding: 4px 10px; border-radius: 6px; border: 1px solid #0284c7; background: #0284c7; color: #fff; font-weight: 700; font-size: 11.5px; cursor: pointer; }
      .mlrs-peel-btn.peeled { background: #0f172a; border-color: #334155; }
      .mlrs-peel-stack { position: relative; display: inline-grid; place-items: center; padding: 6px; flex: 1; min-height: 0; }
      .mlrs-peel-under, .mlrs-peel-over { grid-area: 1 / 1; display: flex; align-items: center; justify-content: center; }
      .mlrs-peel-over { position: relative; z-index: 2; transition: clip-path 0.24s cubic-bezier(.22,.9,.3,1), filter 0.2s ease; filter: drop-shadow(-3px 5px 8px rgba(15,23,42,0.28)); }
      .mlrs-peel-stack.scrubbing .mlrs-peel-over, .mlrs-peel-stack.scrubbing .mlrs-peel-flap { transition: none !important; }
      .mlrs-peel-corner-hit { position: absolute; top: 2px; right: 2px; width: 42px; height: 42px; z-index: 5; cursor: pointer; border-radius: 0 10px 0 28px; background: linear-gradient(225deg, rgba(148,163,184,0.38) 0%, rgba(255,255,255,0.88) 48%, rgba(15,23,42,0.16) 52%, transparent 56%); box-shadow: -2px 2px 5px rgba(15,23,42,0.18); }
      .mlrs-peel-flap { position: absolute; inset: 6px; z-index: 4; pointer-events: none; background: linear-gradient(225deg, rgba(241,245,249,0.97) 0%, rgba(203,213,225,0.94) 55%, rgba(148,163,184,0.88) 100%); filter: drop-shadow(-6px 7px 10px rgba(15,23,42,0.34)); transition: clip-path 0.24s cubic-bezier(.22,.9,.3,1), opacity 0.2s ease; }


      .mlrs-tour-bar {
        display: flex !important; align-items: center !important; justify-content: space-between !important; gap: 14px !important;
        flex-wrap: wrap !important; padding: 10px 14px !important; border-radius: 11px !important;
        border: 1px solid rgba(2,132,199,0.35) !important;
        background: linear-gradient(135deg, rgba(2,132,199,0.09) 0%, rgba(15,23,42,0.03) 100%) !important;
        box-shadow: inset 0 1px 0 rgba(255,255,255,0.35), 0 2px 6px rgba(15,23,42,0.05) !important;
        margin: 0 0 10px 0 !important; font-size: 12.5px !important; line-height: 1.4 !important; box-sizing: border-box !important;
      }
      .mlrs-tour-left { display: flex !important; align-items: center !important; gap: 11px !important; flex: 1 !important; min-width: 240px !important; }
      .mlrs-tour-icon { width: 34px !important; height: 34px !important; border-radius: 9px !important; background: #0284c7 !important; color: #fff !important; display: flex !important; align-items: center !important; justify-content: center !important; font-size: 16px !important; flex-shrink: 0 !important; }
      .mlrs-tour-step-badge { display: inline-flex !important; align-items: center !important; padding: 2px 8px !important; border-radius: 999px !important; background: rgba(2,132,199,0.16) !important; color: #0284c7 !important; font-weight: 800 !important; font-size: 10.5px !important; text-transform: uppercase !important; letter-spacing: 0.04em !important; margin-right: 7px !important; }
      .mlrs-tour-dots { display: inline-flex !important; gap: 4px !important; align-items: center !important; margin-left: 8px !important; vertical-align: middle !important; }
      .mlrs-tour-dot { width: 6px !important; height: 6px !important; border-radius: 999px !important; background: rgba(100,116,139,0.35) !important; }
      .mlrs-tour-dot.on { width: 16px !important; background: #0284c7 !important; }
      .mlrs-tour-nav { display: flex !important; align-items: center !important; gap: 6px !important; flex-wrap: wrap !important; }
      button.mlrs-tour-btn { padding: 5px 11px !important; border-radius: 7px !important; border: 1px solid rgba(100,116,139,0.38) !important; background: #ffffff !important; color: #0f172a !important; font-weight: 700 !important; font-size: 11.5px !important; cursor: pointer !important; }
      button.mlrs-tour-btn.demo { background: #0284c7 !important; border-color: #0284c7 !important; color: #ffffff !important; }
      button.mlrs-tour-reopen { display: inline-flex !important; align-items: center !important; gap: 6px !important; padding: 5px 12px !important; border-radius: 999px !important; border: 1px solid rgba(2,132,199,0.45) !important; background: rgba(2,132,199,0.10) !important; color: #0284c7 !important; font-weight: 700 !important; font-size: 11.5px !important; cursor: pointer !important; }

      .mlrs-box-sub { padding: 9px 10px; border-radius: 8px; background: var(--mlrs-muted); border: 1px solid var(--mlrs-border); margin-bottom: 10px; }
    `;
    if (document.head && !document.getElementById('mlrs-shared-styles')) {
      const st = document.createElement('style');
      st.id = 'mlrs-shared-styles';
      st.textContent = cssText;
      document.head.appendChild(st);
    }
    const rootNode = contextEl && typeof contextEl.getRootNode === 'function' ? contextEl.getRootNode() : null;
    if (rootNode && rootNode !== document && typeof rootNode.querySelector === 'function' && !rootNode.querySelector('#mlrs-shared-styles')) {
      const stShadow = document.createElement('style');
      stShadow.id = 'mlrs-shared-styles';
      stShadow.textContent = cssText;
      rootNode.appendChild(stShadow);
    }
  }

  // ============================================================================
  // 1. INTERACTIVE STAGE CONTROLLER (Finger Pucks, Segmented Pads & Step/Hold)
  // ============================================================================
  function mountInteractiveStage(stageEl, opts) {
    injectStudioStyles(stageEl);
    const Cat = root.MiBoxerCatalog;
    if (!stageEl || !Cat) return null;

    const model = typeof opts.model === 'string' ? (Cat.MODELS.find(m => m.id === opts.model) || Cat.MODELS[0]) : (opts.model || Cat.MODELS[0]);
    const cal = Object.assign(defaultCalibration(), opts.calibration || {});
    const tz = normalizeTouchZones(opts.touchZones);
    let activeZone = opts.activeZone !== undefined ? Number(opts.activeZone) : 1;
    const editMode = Boolean(opts.editMode);
    const facia = opts.facia || null;
    const stepCounters = opts.stepState || {};

    stageEl.innerHTML = Cat.renderModelSvg(model, {
      size: opts.size || 'large',
      uid: opts.uid || 'studio_stage',
      facia: facia,
      touchZones: tz,
      activeZone: activeZone,
      editorMode: editMode,
      selectedPadKey: opts.selectedPadKey || null,
      luminousPreview: Boolean(opts.luminousPreview)
    });

    const svgEl = stageEl.querySelector('svg');
    if (!svgEl) return null;
    const vb = (svgEl.getAttribute('viewBox') || '0 0 220 310').trim().split(/[\s,]+/).map(Number);
    const vbRatio = (vb[2] > 0 && vb[3] > 0) ? (vb[2] / vb[3]) : 0.71;
    svgEl.removeAttribute('width');
    svgEl.removeAttribute('height');
    svgEl.style.height = opts.maxHeight || 'clamp(370px, 58vh, 640px)';
    svgEl.style.maxHeight = '100%';
    svgEl.style.width = 'auto';
    svgEl.style.maxWidth = '100%';
    svgEl.style.aspectRatio = `${vb[2] || 220} / ${vb[3] || 310}`;
    if (vbRatio > 0.88) {
      svgEl.style.height = opts.squareHeight || 'clamp(330px, 48vh, 520px)';
    }
    svgEl.style.display = 'block';
    svgEl.style.userSelect = 'none';

    const updateZoneHighlight = () => {
      svgEl.querySelectorAll('.mbx-hit[data-act="zone"], .mbx-hit[data-act="zone_on"]').forEach(el => {
        const pKey = el.getAttribute('data-pad-key');
        const target = (pKey && svgEl.querySelector(`g[data-pad-key="${pKey}"] > rect`)) || el;
        target.classList.toggle('zone-active', Number(el.getAttribute('data-zone')) === activeZone);
      });
    };
    updateZoneHighlight();

    // Coordinated Finger-Press Reticle Layer
    const puckLayer = document.createElementNS(SVG_NS, 'g');
    puckLayer.setAttribute('pointer-events', 'none');
    svgEl.appendChild(puckLayer);
    const puckTimers = {};

    function showFingerPuck(svgX, svgY, labelText, isRf, keyName) {
      const id = keyName || (isRf ? 'rf' : 'ui');
      const old = puckLayer.querySelector(`[data-puck-id="${id}"]`);
      if (old) old.remove();
      if (puckTimers[id]) clearTimeout(puckTimers[id]);

      const col = isRf ? '#16a34a' : '#ea580c';
      const g = document.createElementNS(SVG_NS, 'g');
      g.setAttribute('data-puck-id', id);

      const halo = document.createElementNS(SVG_NS, 'circle');
      halo.setAttribute('cx', svgX.toFixed(1)); halo.setAttribute('cy', svgY.toFixed(1));
      halo.setAttribute('r', '9.5'); halo.setAttribute('fill', isRf ? 'rgba(22,163,74,0.24)' : 'rgba(234,88,12,0.26)');
      halo.setAttribute('stroke', col); halo.setAttribute('stroke-width', '1.5');
      g.appendChild(halo);

      const dot = document.createElementNS(SVG_NS, 'circle');
      dot.setAttribute('cx', svgX.toFixed(1)); dot.setAttribute('cy', svgY.toFixed(1));
      dot.setAttribute('r', '4'); dot.setAttribute('fill', col);
      dot.setAttribute('stroke', '#ffffff'); dot.setAttribute('stroke-width', '1.2');
      g.appendChild(dot);

      if (labelText) {
        const pillW = Math.max(26, labelText.length * 4.5 + 9);
        const py = Math.max(12, svgY - 15);
        const rect = document.createElementNS(SVG_NS, 'rect');
        rect.setAttribute('x', (svgX - pillW / 2).toFixed(1)); rect.setAttribute('y', (py - 8).toFixed(1));
        rect.setAttribute('width', pillW.toFixed(1)); rect.setAttribute('height', '11');
        rect.setAttribute('rx', '4'); rect.setAttribute('fill', '#0f172a');
        rect.setAttribute('stroke', col); rect.setAttribute('stroke-width', '0.9');
        g.appendChild(rect);

        const txt = document.createElementNS(SVG_NS, 'text');
        txt.setAttribute('x', svgX.toFixed(1)); txt.setAttribute('y', py.toFixed(1));
        txt.setAttribute('text-anchor', 'middle'); txt.setAttribute('font-size', '6.2');
        txt.setAttribute('font-weight', '700'); txt.setAttribute('fill', '#ffffff');
        txt.textContent = labelText;
        g.appendChild(txt);
      }

      puckLayer.appendChild(g);
      puckTimers[id] = setTimeout(() => { g.remove(); }, 1500);
    }

    function clientToSvgPoint(clientX, clientY) {
      const pt = svgEl.createSVGPoint();
      pt.x = clientX; pt.y = clientY;
      const ctm = svgEl.getScreenCTM();
      return ctm ? pt.matrixTransform(ctm.inverse()) : { x: 0, y: 0 };
    }

    function unionBBox(els) {
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      els.forEach(el => {
        if (!el.getBBox) return;
        try {
          const b = el.getBBox();
          if (b.width <= 0 && b.height <= 0) return;
          if (b.x < minX) minX = b.x;
          if (b.y < minY) minY = b.y;
          if (b.x + b.width > maxX) maxX = b.x + b.width;
          if (b.y + b.height > maxY) maxY = b.y + b.height;
        } catch (_) {}
      });
      if (!Number.isFinite(minX)) return null;
      return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
    }

    function analogPointForValue(act, rawVal, isRf) {
      const aLow = String(act || '').toLowerCase();
      const normAct = (aLow === 'color_temp' || aLow === 'temperature') ? 'kelvin' : (aLow === 'level' ? 'brightness' : aLow);
      let candidates = Array.from(svgEl.querySelectorAll(`.mbx-hit[data-act="${normAct}"]`));
      // For hue, exclude discrete R/G/B rectangular buttons (which have width < 40 and rx/rect tag) when a wheel or strip exists
      if (normAct === 'hue' && candidates.length > 1) {
        const nonRectBtn = candidates.filter(el => el.tagName.toLowerCase() === 'circle' || el.tagName.toLowerCase() === 'path' || !el.hasAttribute('data-val') || (el.getBBox && el.getBBox().width < 20));
        if (nonRectBtn.length) candidates = nonRectBtn;
      }
      if (!candidates.length && normAct === 'kelvin') {
        candidates = Array.from(svgEl.querySelectorAll('.mbx-hit[data-act="saturation"]'));
      }
      if (!candidates.length) return null;
      const bb = unionBBox(candidates);
      if (!bb || !bb.width || !bb.height) return null;

      const numVal = Number(rawVal);
      if (Number.isNaN(numVal)) return null;

      // Wheel vs Bar check: if width & height are roughly square (>35x35), it's a Colour Ring!
      if (normAct === 'hue' && bb.height > 32 && bb.width > 32 && Math.abs(bb.width - bb.height) < 20) {
        const cx = bb.x + bb.width / 2, cy = bb.y + bb.height / 2;
        const r = Math.max(bb.width, bb.height) * 0.42;
        const deg = isRf ? physicalHueToWheelDeg(numVal, cal) : (((numVal % 360) + 360) % 360);
        const pt = polarPt(cx, cy, r, deg);
        return { x: pt.x, y: pt.y, text: `${Math.round(numVal)}°` };
      }

      const vert = bb.height > bb.width * 1.2;
      if (normAct === 'saturation' && vert) {
        // Physical vertical saturation slider has 0% at TOP and 100% at BOTTOM!
        const rawPct = Math.max(0, Math.min(100, numVal > 100 ? (numVal / 255) * 100 : numVal));
        const fracFromTop = rawPct / 100;
        return {
          x: bb.x + bb.width / 2,
          y: bb.y + 4 + fracFromTop * Math.max(4, bb.height - 8),
          text: `${Math.round(rawPct)}%`
        };
      }

      const pct = isRf ? normalizeSliderPct(numVal, normAct) : Math.max(0, Math.min(100, numVal > 100 ? (numVal / 255) * 100 : numVal));
      const frac = Math.max(0, Math.min(1, pct / 100));
      return {
        x: vert ? (bb.x + bb.width / 2) : (bb.x + 4 + frac * Math.max(4, bb.width - 8)),
        y: vert ? (bb.y + 4 + (1 - frac) * Math.max(4, bb.height - 8)) : (bb.y + bb.height / 2),
        text: `${Math.round(pct)}%`
      };
    }

    function pulseAction(action, zone, isRf, value) {
      if (zone !== undefined && zone !== null && !isNaN(Number(zone))) {
        activeZone = Number(zone);
        updateZoneHighlight();
      }
      const cls = isRf ? 'fire-rf' : 'fire-ui';

      // 1. Segmented Ring / Slider Pads
      const segEls = svgEl.querySelectorAll(`.mbx-seg-hit[data-seg-act="${action}"]`);
      if (segEls.length > 0) {
        segEls.forEach(el => {
          el.classList.add(cls);
          if (el.getBBox) {
            const bb = el.getBBox();
            showFingerPuck(bb.x + bb.width / 2, bb.y + bb.height / 2, action.replace(/_seg_/, ' #'), isRf, isRf ? 'rf' : 'ui');
          }
          setTimeout(() => el.classList.remove(cls), 750);
        });
        return;
      }

      // 2. Zone-only selection pulse
      if (action === 'zone' || action === 'zone_on' || action === 'zone_off') {
        const zTarget = svgEl.querySelector(`.mbx-hit[data-zone="${zone}"][data-act="${action}"]`) || svgEl.querySelector(`.mbx-hit[data-zone="${zone}"]`);
        if (zTarget && zTarget.getBBox) {
          zTarget.classList.add(cls);
          const bb = zTarget.getBBox();
          showFingerPuck(bb.x + bb.width / 2, bb.y + bb.height / 2, `Z${zone}`, isRf, isRf ? 'rf_btn' : 'ui_btn');
          setTimeout(() => zTarget.classList.remove(cls), 720);
          return;
        }
      }

      // 3. Analog Wheel & Sliders (Factory AND Custom Panels): Show exact finger position puck WITHOUT flashing whole track!
      const isAnalogAct = /^(hue|brightness|level|kelvin|color_temp|temperature|saturation)$/i.test(String(action || ''));
      if (isAnalogAct && value !== undefined && value !== null && value !== '' && !Number.isNaN(Number(value)) && Number(value) >= 0) {
        const pt = analogPointForValue(action, value, isRf);
        if (pt) {
          showFingerPuck(pt.x, pt.y, `${isRf ? 'RF' : 'UI'} ${pt.text}`, isRf, isRf ? `rf_${action}` : `ui_${action}`);
          return;
        }
      }

      // 4. Standard Discrete Buttons (ON, OFF, W, M, S+, S-, 60S)
      const acts = ACT_TO_SVG[action] || [action];
      let shownBtnPuck = false;
      acts.forEach(a => {
        svgEl.querySelectorAll(`.mbx-hit[data-act="${a}"]`).forEach(el => {
          if (el.hasAttribute('data-zone') && Number(el.getAttribute('data-zone')) !== Number(zone)) return;
          el.classList.add(cls);
          if (!shownBtnPuck && el.getBBox) {
            const bb = el.getBBox();
            showFingerPuck(bb.x + bb.width / 2, bb.y + bb.height / 2, String(action).toUpperCase(), isRf, isRf ? 'rf_btn' : 'ui_btn');
            shownBtnPuck = true;
          }
          setTimeout(() => el.classList.remove(cls), 720);
        });
      });
    }

    // DESIGN MODE: Click any stencil slot / segment / rocker to customize it!
    if (editMode) {
      svgEl.querySelectorAll('.mbx-seg-hit, .mbx-hit').forEach(el => {
        el.style.cursor = 'pointer';
        el.onclick = (ev) => {
          ev.stopPropagation();
          const pKey = el.getAttribute('data-pad-key') || el.getAttribute('data-seg-act') || el.getAttribute('data-act') || 'btn_on';
          const act = el.getAttribute('data-seg-act') || el.getAttribute('data-act') || 'on';
          const z = el.getAttribute('data-zone');
          if (typeof opts.onSelectPad === 'function') opts.onSelectPad(pKey, act, z);
        };
      });
      return { pulseAction, setActiveZone: (z) => { activeZone = Number(z); updateZoneHighlight(); } };
    }

    // Helper for Single-Button Multi-Function pads (Short Tap = +1 Step Cycle, Hold = ON/OFF Toggle)
    function attachPadInteraction(el, pKey, baseAct, fixedZone, fixedVal) {
      const padCfg = (facia && facia.pads && facia.pads[pKey]) || {};
      const mf = padCfg.multifunc && padCfg.multifunc.enabled ? padCfg.multifunc : null;
      let holdTimer = null, heldFired = false;

      el.addEventListener('pointerdown', () => {
        if (el.getAttribute('data-blanked') === '1') return;
        heldFired = false;
        holdTimer = setTimeout(() => {
          heldFired = true;
          const zNext = fixedZone !== null ? fixedZone : activeZone;
          const bb = el.getBBox ? el.getBBox() : null;
          if (mf) {
            const st = stepCounters[pKey] || { step: 1, on: true };
            st.on = !st.on;
            stepCounters[pKey] = st;
            const msg = `${padCfg.label || pKey}: ${st.on ? 'ON' : 'OFF'} (Hold Toggle)`;
            if (bb) showFingerPuck(bb.x + bb.width / 2, bb.y + bb.height / 2, st.on ? 'HOLD: ON' : 'HOLD: OFF', false, 'ui_btn');
            if (typeof opts.onAction === 'function') opts.onAction(baseAct, st.on ? 100 : 0, zNext, msg);
          } else if (baseAct === 'on' || baseAct === 'off' || baseAct === 'zone_on' || baseAct === 'zone_off' || baseAct === 'set_white') {
            const longAct = (baseAct === 'off' || baseAct === 'zone_off') ? 'night_mode' : 'set_white';
            if (bb) showFingerPuck(bb.x + bb.width / 2, bb.y + bb.height / 2, `HOLD ${longAct.toUpperCase()}`, false, 'ui_btn');
            if (typeof opts.onAction === 'function') opts.onAction(longAct, 0, zNext);
          }
        }, 580);
      });
      const clr = () => { if (holdTimer) { clearTimeout(holdTimer); holdTimer = null; } };
      el.addEventListener('pointerup', clr);
      el.addEventListener('pointerleave', clr);

      el.addEventListener('click', (ev) => {
        ev.stopPropagation();
        if (el.getAttribute('data-blanked') === '1') return;
        if (heldFired) { heldFired = false; return; }
        let zNext = activeZone;
        if (fixedZone !== null) {
          zNext = fixedZone;
          activeZone = zNext;
          updateZoneHighlight();
          if (typeof opts.onZoneChange === 'function') opts.onZoneChange(zNext);
        }
        const sp = clientToSvgPoint(ev.clientX, ev.clientY);
        const bb = el.getBBox ? el.getBBox() : null;
        const px = (sp && !Number.isNaN(sp.x) && sp.x !== 0) ? sp.x : (bb ? bb.x + bb.width / 2 : 0);
        const py = (sp && !Number.isNaN(sp.y) && sp.y !== 0) ? sp.y : (bb ? bb.y + bb.height / 2 : 0);
        if (padCfg.segmentMode === 'slider') {
          let frac = 0.5;
          const sDegAttr = el.getAttribute('data-sdeg');
          const eDegAttr = el.getAttribute('data-edeg');
          if (sDegAttr !== null && eDegAttr !== null) {
            const cxRing = Number(el.getAttribute('data-cx') || 0);
            const cyRing = Number(el.getAttribute('data-cy') || 0);
            const sDeg = Number(sDegAttr), eDeg = Number(eDegAttr);
            // polarPt uses 0 deg = 12 o'clock clockwise: ang = atan2(dx, -dy)
            let ang = Math.atan2(px - cxRing, -(py - cyRing)) * 180 / Math.PI;
            while (ang < sDeg - 15) ang += 360;
            while (ang > eDeg + 345) ang -= 360;
            frac = Math.max(0, Math.min(1, (ang - sDeg) / Math.max(1, eDeg - sDeg)));
          } else if (bb && bb.height > bb.width * 1.35) {
            // Vertical bar segment: bottom = 0 (start), top = 1 (far/max)
            frac = Math.max(0, Math.min(1, 1 - (py - bb.y) / Math.max(1, bb.height)));
          } else {
            frac = Math.max(0, Math.min(1, (px - (bb ? bb.x : 0)) / Math.max(1, bb ? bb.width : 1)));
          }
          const sMin = Number(padCfg.sliderMin ?? 0);
          const sMax = Number(padCfg.sliderMax ?? 100);
          const mappedVal = Math.round(sMin + frac * (sMax - sMin));
          const badge = `${padCfg.label || pKey}: ${mappedVal}% (${sMin}%→${sMax}%)`;
          showFingerPuck(px, py, `${mappedVal}%`, false, 'ui_btn');
          if (typeof opts.onAction === 'function') opts.onAction(baseAct, mappedVal, zNext, badge);
          return;
        }
        if (mf) {
          const maxS = Math.max(2, Number(mf.steps || 4));
          const st = stepCounters[pKey] || { step: 0, on: true };
          st.on = true;
          st.step = (st.step % maxS) + 1;
          stepCounters[pKey] = st;
          const badge = `${padCfg.label || pKey}: ${mf.unit || 'Step'} ${st.step}/${maxS}`;
          showFingerPuck(px, py, `${st.step}/${maxS}`, false, 'ui_btn');
          if (typeof opts.onAction === 'function') opts.onAction(baseAct, Math.round((st.step / maxS) * 100), zNext, badge);
          return;
        }
        showFingerPuck(px, py, padCfg.label || (baseAct === 'zone' ? `Z${zNext}` : baseAct.toUpperCase()), false, 'ui_btn');
        if (baseAct === 'zone') return;
        if (typeof opts.onAction === 'function') opts.onAction(baseAct, fixedVal !== null ? fixedVal : 100, zNext, padCfg.label || undefined);
      });
    }

    // Bind Segmented Ring/Bar Cells
    svgEl.querySelectorAll('.mbx-seg-hit').forEach(el => {
      const segAct = el.getAttribute('data-seg-act') || '';
      const pKey = el.getAttribute('data-pad-key') || segAct;
      attachPadInteraction(el, pKey, segAct, null, 1);
    });

    // Bind Continuous Sliders/Wheels + Discrete Buttons
    svgEl.querySelectorAll('.mbx-hit').forEach(el => {
      const act = el.getAttribute('data-act') || 'on';
      const pKey = el.getAttribute('data-pad-key') || act;
      const zAttr = el.getAttribute('data-zone');
      const fixedZ = (zAttr !== null && zAttr !== '') ? Number(zAttr) : null;
      const fixedVal = el.hasAttribute('data-val') ? Number(el.getAttribute('data-val')) : null;
      const tag = el.tagName.toLowerCase();
      const isDiscreteRgbBtn = (act === 'hue' && (fixedVal === 0 || fixedVal === 120 || fixedVal === 240) && tag === 'rect');
      const isContinuous = (act === 'hue' || act === 'brightness' || act === 'kelvin' || act === 'saturation') && !isDiscreteRgbBtn;

      if (isContinuous) {
        let dragging = false, lastTxMs = 0;
        const scrub = (ev, forceTx) => {
          if (el.getAttribute('data-blanked') === '1') return;
          const bb = el.getBBox();
          const sp = clientToSvgPoint(ev.clientX, ev.clientY);
          let outVal = 0, px = sp.x, py = sp.y, lbl = '';
          if (act === 'hue' && bb.height > bb.width * 0.75) {
            const cx = bb.x + bb.width / 2, cy = bb.y + bb.height / 2, r = Math.max(bb.width, bb.height) * 0.39;
            let deg = ((Math.atan2(sp.y - cy, sp.x - cx) * 180) / Math.PI + 90 + 360) % 360;
            const snap = polarPt(cx, cy, r, deg);
            px = snap.x; py = snap.y;
            let calDeg = (deg - Number(cal.hue_offset || 0) + 360) % 360;
            if (cal.hue_invert) calDeg = (360 - calDeg) % 360;
            outVal = Math.round(calDeg) % 360; lbl = `${outVal}°`;
          } else {
            const vert = bb.height > bb.width * 1.3;
            let frac = Math.max(0, Math.min(1, vert ? (1 - (sp.y - bb.y) / bb.height) : ((sp.x - bb.x) / bb.width)));
            px = vert ? (bb.x + bb.width / 2) : (bb.x + frac * bb.width);
            py = vert ? (bb.y + (1 - frac) * bb.height) : (bb.y + bb.height / 2);
            const inv = act === 'brightness' ? cal.bri_invert : act === 'kelvin' ? cal.cct_invert : cal.sat_invert;
            if (inv) frac = 1 - frac;
            outVal = Math.round(frac * 100); lbl = `${outVal}%`;
          }
          showFingerPuck(px, py, lbl, false, 'ui_analog');
          if (typeof opts.onScrubPreview === 'function') opts.onScrubPreview(act, outVal);
          const now = Date.now();
          if (forceTx || now - lastTxMs >= 135) {
            lastTxMs = now;
            if (typeof opts.onAction === 'function') opts.onAction(act, outVal, fixedZ !== null ? fixedZ : activeZone);
          }
        };
        el.addEventListener('pointerdown', (ev) => { ev.preventDefault(); ev.stopPropagation(); dragging = true; try { el.setPointerCapture(ev.pointerId); } catch (_) {} scrub(ev, true); });
        el.addEventListener('pointermove', (ev) => { if (dragging) scrub(ev, false); });
        el.addEventListener('pointerup', (ev) => { if (dragging) { dragging = false; scrub(ev, true); } });
        el.addEventListener('pointercancel', () => { dragging = false; });
        return;
      }

      attachPadInteraction(el, pKey, act, fixedZ, fixedVal);
    });

    return { pulseAction, setActiveZone: (z) => { activeZone = Number(z); updateZoneHighlight(); } };
  }

  // ============================================================================
  // 2. 1:1 PRINT / CUT STENCIL SHEET BUILDER
  // ============================================================================
  function buildPodOrderPayload(remoteName, hexId, model, facia, touchZones, activeZone) {
    const Cat = root.MiBoxerCatalog;
    const dims = Cat.getPhysicalDims(model);
    const f = facia || {};
    const preset = (Cat.FACIA_THEMES && Cat.FACIA_THEMES[f.theme]) || {};
    const pads = f.pads || {};
    const lum = Object.assign({ enabled: false, border: false, header: false, slots: false }, f.luminous || {});
    const luminousSlots = Object.entries(pads)
      .filter(([, cfg]) => Boolean(cfg && cfg.luminous))
      .map(([slotKey]) => slotKey);
    const sliderSegments = Object.entries(pads)
      .filter(([, cfg]) => Boolean(cfg && cfg.segmentMode === 'slider'))
      .map(([slotKey, cfg]) => ({
        slot: slotKey,
        label: cfg.label || slotKey,
        min_pct: Number(cfg.sliderMin ?? 0),
        max_pct: Number(cfg.sliderMax ?? 100),
        track_pitch_mm: Number(cfg.sliderPitch ?? f.sliderPitch ?? 2.2),
        track_arrows: cfg.sliderArrows || f.sliderArrows || 'chevron'
      }));

    return {
      schema: 'milight_remote_studio.pod_order.v1',
      created_at: new Date().toISOString(),
      remote_name: remoteName || model.name || model.id,
      device_id: hexId || '',
      hardware_model: model.id,
      fit_mode: Cat.getStencilFitMode ? Cat.getStencilFitMode(model) : 'single_sheet',
      dimensions_mm: {
        width_mm: dims.width_mm,
        height_mm: dims.height_mm,
        corner_radius_mm: dims.corner_radius_mm || 0
      },
      appearance: {
        theme: f.theme || 'pure_white',
        material: f.material || 'matte_vinyl_peelable',
        monochrome: Boolean(f.monochrome),
        background_color: f.bgColor || (f.colors && f.colors.bg) || preset.bg || '#ffffff',
        boundary_line_color: f.boundaryColor || (f.colors && f.colors.padStroke) || preset.padStroke || '#0f172a',
        default_font: f.fontFamily || 'sans',
        default_font_scale_pct: Number(f.fontScale || 100),
        panel_title: f.panelTitle || '',
        show_led_pinhole: f.showLedPinhole !== false,
        background_image: (f.bgImage && f.bgImage.dataUrl) ? { fit: f.bgImage.fit || 'cover', scale_pct: Number(f.bgImage.scale ?? 100), offset_x_pct: Number(f.bgImage.x ?? 0), offset_y_pct: Number(f.bgImage.y ?? 0), opacity_pct: Number(f.bgImage.opacity ?? 88), pad_alpha_pct: Number(f.bgImage.padAlpha ?? 72), name: f.bgImage.name || 'custom_artwork', data_url: f.bgImage.dataUrl } : null
      },
      luminous_glow: {
        enabled: Boolean(lum.enabled || luminousSlots.length > 0),
        pigment: 'strontium_aluminate',
        outer_boundary: Boolean(lum.enabled && lum.border),
        header_title: Boolean(lum.enabled && lum.header),
        all_slots: Boolean(lum.enabled && lum.slots),
        individual_slots: luminousSlots
      },
      slider_segments: sliderSegments,
      facia: f,
      touch_zones: touchZones || null
    };
  }

  function buildOneToOnePrintSvg(model, facia, touchZones, activeZone) {
    const Cat = root.MiBoxerCatalog;
    const dims = Cat.getPhysicalDims(model);
    const podMeta = buildPodOrderPayload(model.name || model.id, '', model, facia, touchZones, activeZone);
    const rendered = Cat.renderCapacitiveStencilSvg(model, {
      size: 'large', uid: 'print_1to1',
      facia: Object.assign({}, facia || {}, { enabled: true }),
      touchZones, activeZone: activeZone || 1, stencilMode: true
    });
    const vbMatch = rendered.match(/viewBox="([^"]+)"/);
    const vb = vbMatch ? vbMatch[1] : '0 0 210 210';
    const inner = rendered.replace(/^<svg[^>]*>/, '').replace(/<\/svg>$/, '');
    const safeJson = JSON.stringify(podMeta).replace(/]]>/g, ']]&gt;');
    return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="${dims.width_mm}mm" height="${dims.height_mm}mm" viewBox="${vb}" data-model="${model.id}" data-bg-color="${podMeta.appearance.background_color}" data-boundary-color="${podMeta.appearance.boundary_line_color}" data-luminous="${podMeta.luminous_glow.enabled ? '1' : '0'}">\n<metadata><pod_order><![CDATA[${safeJson}]]></pod_order></metadata>\n${inner}\n</svg>`;
  }

  function openPrintSheetWindow(remoteName, hexId, model, facia, touchZones, activeZone) {
    const Cat = root.MiBoxerCatalog;
    const dims = Cat.getPhysicalDims(model);
    const svg1to1 = buildOneToOnePrintSvg(model, facia, touchZones, activeZone);
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>1:1 Capacitive Stencil — ${remoteName} (${model.id})</title>
      <style>
        @page { size: A4 portrait; margin: 12mm; }
        body { font-family: Inter, system-ui, sans-serif; color: #0f172a; margin: 0; padding: 16px; background: #f8fafc; }
        .no-print { background: #0f172a; color: #fff; padding: 12px 18px; border-radius: 10px; margin-bottom: 18px; display: flex; justify-content: space-between; align-items: center; }
        .no-print button { background: #0284c7; color: #fff; border: none; padding: 8px 16px; border-radius: 6px; font-weight: 700; cursor: pointer; }
        .sheet { background: #fff; border: 1px dashed #94a3b8; padding: 16mm; display: flex; flex-direction: column; align-items: center; gap: 10mm; }
        .crop-wrap { padding: 3mm; border: 0.25mm dashed #64748b; display: inline-block; }
        .ruler-row { display: flex; align-items: center; gap: 14px; border-top: 1px solid #cbd5e1; padding-top: 8mm; width: 100%; justify-content: center; font-size: 11px; }
        .box-10mm { width: 10mm; height: 10mm; border: 0.4mm solid #000; display: inline-block; flex-shrink: 0; }
        @media print { body { background: #fff; padding: 0; } .no-print { display: none; } .sheet { border: none; padding: 4mm; } }
      </style></head><body>
      <div class="no-print">
        <div><strong>1:1 Capacitive Glass Overlay Sheet</strong> — Set Printer Scale to <b>100% / Actual Size</b></div>
        <button onclick="window.print()">Print / Save 1:1 PDF</button>
      </div>
      <div class="sheet">
        <div style="text-align:center">
          <div style="font-size:15px;font-weight:800">${remoteName} • ${model.name || model.id} (${hexId})</div>
          <div style="font-size:11px;color:#475569;margin-top:3px">Exact Outer Cut: <b>${dims.width_mm} mm × ${dims.height_mm} mm</b> • Inner Glass: ${dims.glass_w_mm} × ${dims.glass_h_mm} mm</div>
        </div>
        <div class="crop-wrap">${svg1to1}</div>
        <div class="ruler-row">
          <span class="box-10mm"></span>
          <div><b>10 mm × 10 mm Scale Verification Square</b> — Confirm 10.0 mm with a ruler before applying to capacitive panel.</div>
        </div>
      </div></body></html>`;
    const w = window.open('', '_blank');
    if (w) { w.document.open(); w.document.write(html); w.document.close(); }
  }

  // ============================================================================
  // 3. WYSIWYG CAPACITIVE PANEL STENCIL DESIGNER (Presets + Segments + Rooms)
  // ============================================================================
  function slugifyCustomId(baseId, nameStr) {
    const clean = String(nameStr || 'Custom').toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 14);
    const sfx = Math.random().toString(36).slice(2, 5).toUpperCase();
    return `CUST_${baseId.replace(/[^A-Z0-9]/gi, '').toUpperCase()}_${clean || 'PANEL'}_${sfx}`;
  }

  const WIP_STORAGE_KEY = 'mlrs_wip_drafts_v1';

  function loadWipDrafts() {
    try {
      const raw = localStorage.getItem(WIP_STORAGE_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch (_) {
      return [];
    }
  }

  function saveWipDraftRecord(entry) {
    const list = loadWipDrafts().filter(d => d && d.id !== entry.id);
    list.unshift(entry);
    while (list.length > 12) list.pop();
    try {
      localStorage.setItem(WIP_STORAGE_KEY, JSON.stringify(list));
      return { ok: true, count: list.length };
    } catch (e) {
      // Quota fallback: keep latest 4 drafts
      try {
        localStorage.setItem(WIP_STORAGE_KEY, JSON.stringify(list.slice(0, 4)));
        return { ok: true, count: Math.min(4, list.length) };
      } catch (err2) {
        return { ok: false, error: String(err2) };
      }
    }
  }

  function deleteWipDraftRecord(draftId) {
    const list = loadWipDrafts().filter(d => d && d.id !== draftId);
    try { localStorage.setItem(WIP_STORAGE_KEY, JSON.stringify(list)); } catch (_) {}
    return list;
  }

  function compressImageFileToDataUrl(file, maxDim) {
    return new Promise((resolve, reject) => {
      if (!file) return reject(new Error('No file'));
      const reader = new FileReader();
      reader.onerror = () => reject(new Error('File read error'));
      reader.onload = () => {
        const rawUrl = String(reader.result || '');
        if (/^data:image\/svg/i.test(rawUrl) && rawUrl.length < 350000) {
          return resolve(rawUrl);
        }
        const img = new Image();
        img.onerror = () => resolve(rawUrl);
        img.onload = () => {
          const cap = maxDim || 880;
          let w = img.naturalWidth || img.width || 600;
          let h = img.naturalHeight || img.height || 800;
          if (w > cap || h > cap) {
            const sc = cap / Math.max(w, h);
            w = Math.max(1, Math.round(w * sc));
            h = Math.max(1, Math.round(h * sc));
          }
          const cv = document.createElement('canvas');
          cv.width = w; cv.height = h;
          const ctx = cv.getContext('2d');
          ctx.drawImage(img, 0, 0, w, h);
          // Preserve alpha if PNG/WebP, otherwise compact high-quality JPEG
          const outMime = /png|webp/i.test(file.type) ? 'image/webp' : 'image/jpeg';
          let outUrl = cv.toDataURL(outMime, 0.84);
          if (outUrl.length > 480000) outUrl = cv.toDataURL('image/jpeg', 0.74);
          resolve(outUrl);
        };
        img.src = rawUrl;
      };
      reader.readAsDataURL(file);
    });
  }

  function openFaciaDesigner(opts) {
    injectStudioStyles();
    const Cat = root.MiBoxerCatalog;
    const rawModel = typeof opts.model === 'string' ? (Cat.MODELS.find(m => m.id === opts.model) || Cat.MODELS[0]) : opts.model;
    if (!Cat.isCapacitiveFlatPanel(rawModel)) {
      alert(`${rawModel.id} uses mechanical buttons/sliders. Full-surface stencil stickers are currently for flat capacitive glass panels (handheld slider decals coming in v2).`);
      return;
    }

    const isEditingExistingCustom = Boolean(rawModel.isCustom && !opts.forceClone);
    const baseModel = Cat.resolveBaseModel ? Cat.resolveBaseModel(rawModel) : rawModel;
    const bp = Cat.getPanelBlueprint(baseModel);
    const dims = Cat.getPhysicalDims(baseModel);
    const presets = Cat.getSamplePresetsForModel(baseModel);
    const hexId = opts.hexId || '0x0000';
    const remoteName = opts.remoteName || rawModel.name || baseModel.id;
    const hubBase = (opts.hubUrl || '').replace(/\/$/, '');

    let customModelName = isEditingExistingCustom ? (rawModel.name || `${baseModel.id} Custom`) : `${baseModel.id} ${remoteName.replace(baseModel.id, '').trim() || 'Smart Room'}`.trim();
    let bindCurrentRemote = opts.bindRemoteByDefault !== false;

    const seedTz = (isEditingExistingCustom && rawModel.touchZones) ? rawModel.touchZones : opts.touchZones;
    const seedFacia = (isEditingExistingCustom && rawModel.facia) ? rawModel.facia : opts.facia;

    let tz = normalizeTouchZones(seedTz);
    let cal = Object.assign(defaultCalibration(), opts.calibration || {});
    const draft = Object.assign({
      v: 2, enabled: true,
      theme: baseModel.finish === 'black' ? 'matte_black' : 'pure_white',
      monochrome: false, bgPattern: 'clean', sliderStyle: 'factory',
      defaultPadStyle: 'keycap', hideLogo: true, showLedPinhole: true,
      panelTitle: '', material: 'matte_vinyl_peelable', colors: {}, pads: {}
    }, JSON.parse(JSON.stringify(seedFacia || {})), { enabled: true });
    const model = baseModel;

    // Available touch surfaces on this specific panel model
    const panelSurfaces = bp.slots.filter(s => Boolean(s.surf));
    let mode = 'edit';
    let iconTab = model.zones > 1 ? 'room' : 'device';
    let activeZone = 1;
    let selectedPadKey = tz.hue_ring.enabled ? 'hue_seg_1' : (bp.slots.find(s => s.key === 'zone_1') ? 'zone_1' : 'btn_on');
    let luminousPreview = false;
    let step1Confirmed = false;
    let currentDraftId = opts.draftId || null;
    let refreshTourState = null;
    let lastTestReadout = 'Load a Showcase Template above or click any stencil slot on the panel to customise.';

    if (opts.initialWorkflow === 'bare_walkthrough') {
      tz = normalizeTouchZones(null);
      draft.pads = {};
      draft.panelTitle = '';
      localStorage.setItem('mlrs_tour_stencil_build_path_v5_hide', '0');
      localStorage.setItem('mlrs_tour_stencil_build_path_v5_idx', '0');
      lastTestReadout = `Guided Bare-Panel Build started on ${baseModel.id} \u2014 start with Step 1 highlighted above!`;
    } else if (opts.initialWorkflow === 'template_edit' && presets && presets[0]) {
      tz = normalizeTouchZones(JSON.parse(JSON.stringify(presets[0].touch_zones)));
      Object.assign(draft, JSON.parse(JSON.stringify(presets[0].facia)));
      selectedPadKey = Object.keys(draft.pads || {})[0] || selectedPadKey;
      step1Confirmed = true;
      localStorage.setItem('mlrs_tour_stencil_build_path_v5_hide', '0');
      localStorage.setItem('mlrs_tour_stencil_build_path_v5_idx', '2');
      lastTestReadout = `Loaded "${presets[0].name}" \u2014 click any slot to customise its behaviour, text, icons & glow!`;
    } else if (opts.initialWorkflow === 'export_pod') {
      if ((!draft.pads || !Object.keys(draft.pads).length) && presets && presets[0]) {
        tz = normalizeTouchZones(JSON.parse(JSON.stringify(presets[0].touch_zones)));
        Object.assign(draft, JSON.parse(JSON.stringify(presets[0].facia)));
      }
      lastTestReadout = `Ready for Export \u2014 use Print 1:1 Stencil Sheet, Download 1:1 SVG, or Download POD Spec JSON at the bottom-right!`;
        } else if (opts.initialWorkflow === 'resume_draft') {
      const savedList = loadWipDrafts();
      const pick = (opts.draftId && savedList.find(d => d.id === opts.draftId)) || savedList.find(d => d.baseModelId === baseModel.id) || savedList[0];
      if (pick) {
        currentDraftId = pick.id;
        customModelName = pick.name || customModelName;
        tz = normalizeTouchZones(pick.touchZones);
        Object.keys(draft).forEach(k => delete draft[k]);
        Object.assign(draft, JSON.parse(JSON.stringify(pick.facia || { enabled: true, pads: {} })));
        selectedPadKey = pick.selectedPadKey || selectedPadKey;
        step1Confirmed = true;
      }
      lastTestReadout = currentDraftId ? `Resumed WIP Draft "${customModelName}" \u2014 continue editing or click Create Custom Remote when ready!` : 'No saved WIP drafts yet \u2014 click Save WIP Draft at the bottom anytime!';
    }
    const stepState = {};
    let isFullscreen = false;
    const onFsChange = () => {
      const nativeFs = Boolean(document.fullscreenElement === backdrop);
      if (!nativeFs && isFullscreen && document.fullscreenEnabled) { isFullscreen = false; }
      backdrop.classList.toggle('mlrs-backdrop-fs', isFullscreen || nativeFs);
      const m = backdrop.querySelector('.mlrs-modal');
      if (m) m.classList.toggle('mlrs-fullscreen', isFullscreen || nativeFs);
      const fb = backdrop.querySelector('#mlrsFullBtn');
      if (fb) fb.textContent = (isFullscreen || nativeFs) ? '❐ Exit Fullscreen' : '⤢ Fullscreen';
    };
    document.addEventListener('fullscreenchange', onFsChange);

    const backdrop = document.createElement('div');
    backdrop.className = 'mlrs-modal-backdrop' + (isHostDark() ? ' mlrs-dark' : '');

    function syncLabelToTouchZone(padKey, lbl) {
      const m = padKey.match(/^(hue|cct|sat|bri)_seg_(\d+)$/);
      if (!m) return;
      const map = { hue: 'hue_ring', cct: 'cct_bar', sat: 'sat_bar', bri: 'bri_bar' };
      const sk = map[m[1]], idx = Number(m[2]) - 1;
      if (tz[sk] && idx >= 0 && idx < 12) {
        while (tz[sk].labels.length <= idx) tz[sk].labels.push('');
        tz[sk].labels[idx] = lbl;
      }
    }

    function renderModal() {
      if (/^(hue|sat|bri|cct)_seg_/.test(selectedPadKey)) {
        const pref = selectedPadKey.split('_')[0];
        const surfKey = pref === 'hue' ? 'hue_ring' : (pref + '_bar');
        if (!tz[surfKey] || !tz[surfKey].enabled) {
          selectedPadKey = (bp.slots && bp.slots[0] && bp.slots[0].key) || 'zone_1';
        }
      }
      const presetTheme = Cat.FACIA_THEMES[draft.theme] || Cat.FACIA_THEMES.pure_white;
      const effColors = Object.assign({}, presetTheme, draft.colors || {});
      const curPad = draft.pads[selectedPadKey] || {};
      const curMf = curPad.multifunc || { enabled: false, steps: 4, unit: 'Spd' };

      const iconEntries = Object.entries(Cat.FACIA_ICONS).filter(([k, ic]) => k === 'none' || ic.group === iconTab);

      backdrop.innerHTML = `
        <div class="mlrs-modal ${isFullscreen ? 'mlrs-fullscreen' : ''}" onclick="event.stopPropagation()">
          <div class="mlrs-topbar">
            <div>
              <div style="font-size:16px;font-weight:700">Capacitive Panel Facia &amp; Stencil Studio — ${remoteName} (${model.id})</div>
              <div style="font-size:12px;color:var(--mlrs-muted-fg);margin-top:2px">${dims.width_mm} × ${dims.height_mm} mm Glass Stencil • Segment sliders into multi-function device pads &amp; standardised room icons</div>
            </div>
            <div style="display:flex;gap:10px;align-items:center">
              <div class="mlrs-pill-group" id="mlrsTourStepModeBar">
                <button type="button" class="mlrs-btn ${mode === 'edit' ? 'active-tab' : ''}" id="mlrsModeEdit">1. Design Stencil</button>
                <button type="button" class="mlrs-btn ${mode === 'test' ? 'active-tab' : ''}" id="mlrsModeTest">2. Interactive Test (Tap / Scrub)</button>
              </div>
              <button type="button" class="mlrs-btn ${luminousPreview ? 'active-tab' : ''}" id="mlrsLumPreviewBtn" title="Simulate a dark room at night to preview Strontium Aluminate glow-in-the-dark ink!">
                <span class="mlrs-lum-swatch"></span> ${luminousPreview ? '☀️ Exit Dark Room' : '🌙 Dark-Room Glow'}
              </button>
              ${luminousPreview ? `<button type="button" class="mlrs-btn" id="mlrsTopGlowAllBtn" style="border-color:#10b981;color:#059669;font-weight:700" title="Turn on Luminous Glow for every button, ring &amp; slider at once">✨ Glow All</button>` : ''}
              ${opts.onOpenGestures ? `<button type="button" class="mlrs-btn" id="mlrsOpenGestBtn">🎛️ Gestures &amp; Segments</button>` : ''}
              <button type="button" class="mlrs-btn ${isFullscreen ? 'active-tab' : ''}" id="mlrsFullBtn">${isFullscreen ? '❐ Exit Fullscreen' : '⤢ Fullscreen'}</button>
              <button type="button" class="mlrs-btn" id="mlrsCloseBtn">✕ Close</button>
            </div>
          </div>

          <div class="mlrs-preset-bar" id="mlrsTourStepIdentity" style="justify-content:space-between">
            <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
              <span style="padding:3px 8px;border-radius:5px;background:var(--mlrs-bg);border:1px solid var(--mlrs-border);font-weight:700">
                ${isEditingExistingCustom ? `Editing Custom Type: ${rawModel.id}` : `Base Hardware: ${baseModel.id} (Read-Only)`}
              </span>
              <label style="font-weight:600;margin:0">Custom Remote Name:</label>
              <input type="text" class="mlrs-input" id="mlrsCustomModelName" style="width:230px;padding:4px 8px" value="${customModelName.replace(/"/g, '&quot;')}" placeholder="e.g. Master Suite B0"/>
              ${opts.hexId ? `<label style="display:flex;align-items:center;gap:5px;margin-left:6px;cursor:pointer;font-weight:500"><input type="checkbox" id="mlrsBindNowChk" ${bindCurrentRemote ? 'checked' : ''}/> Assign to ${hexId} now</label>` : ''}
            </div>
            <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">
              ${(() => {
                const allWips = loadWipDrafts();
                const matchingWips = allWips.filter(d => !d.baseModelId || d.baseModelId === baseModel.id);
                if (!matchingWips.length) return '';
                return `<span style="display:inline-flex;align-items:center;gap:4px;background:rgba(2,132,199,0.09);border:1px solid rgba(2,132,199,0.35);padding:2px 6px;border-radius:6px">
                  <select class="mlrs-select" id="mlrsResumeWipSel" style="width:auto;max-width:205px;padding:2px 6px;font-size:11.5px;font-weight:600">
                    <option value="">📂 WIP Drafts (${matchingWips.length})…</option>
                    ${matchingWips.map(d => `<option value="${d.id}" ${currentDraftId === d.id ? 'selected' : ''}>📝 ${d.name} (${d.savedAtShort || 'saved'})</option>`).join('')}
                  </select>
                  ${currentDraftId ? `<button type="button" class="mlrs-btn danger-outline" id="mlrsDelWipBtn" style="padding:2px 6px;font-size:11px" title="Delete this WIP draft">✕</button>` : ''}
                </span>`;
              })()}
              <button type="button" class="mlrs-btn" id="mlrsResetBareBtn" title="Reset to a bare factory panel so you can build from scratch">🧼 Bare Panel</button><span style="font-weight:600;color:var(--mlrs-muted-fg)">Templates:</span>
              ${presets.map((pr, idx) => `<button type="button" class="mlrs-btn" data-preset-idx="${idx}" title="${pr.desc}">✨ ${pr.name.split(' (')[0]}</button>`).join('')}
            </div>
          </div>

          <div id="mlrsStudioTourMount" style="padding:8px 20px 0;background:var(--mlrs-bg)"></div>
          <div class="mlrs-body">
            <!-- LEFT: Touch Bar/Ring Segmentation + Surface Theme -->
            <div class="mlrs-col">
              <div id="mlrsTourStepSplit">${panelSurfaces.length ? `
                <div class="mlrs-sec-title">1. Segment Wheels &amp; Bars (Buttons or Sliders)</div>
                <div style="background:var(--mlrs-muted);border:1px solid var(--mlrs-border);border-left:3px solid var(--mlrs-primary);border-radius:6px;padding:7px 9px;margin-bottom:9px;font-size:11px;line-height:1.42;color:var(--mlrs-fg)">
                  <b>💡 Segmented Slider Pro-Tips:</b> Any slice on a <b>360° Ring</b> or <b>Straight Bar</b> can act independently as a <b>Tap/Hold Button</b> <i>or</i> a <b>Variable Slider</b> with custom <b>X% → Y%</b> endpoints (e.g. <code>15–80%</code> night-safe dimmer, <code>100–0%</code> inverted blind drop, or two half-bars for Sheer &amp; Blockout).
                </div>
                <div class="mlrs-box-sub">
                  ${panelSurfaces.map(ps => {
                    const sc = tz[ps.surf];
                    const maxS = ps.surf === 'hue_ring' ? 8 : 5;
                    const minS = ps.surf === 'hue_ring' ? 3 : 2;
                    const friendly = ps.surf === 'hue_ring' ? (ps.type === 'ring' ? 'Colour Ring' : 'Top Colour Strip') : ps.surf === 'cct_bar' ? 'CCT Strip' : ps.surf === 'sat_bar' ? 'Left Touch Bar' : 'Dimmer Bar';
                    return `<div style="display:flex;align-items:center;justify-content:space-between;gap:6px;margin-bottom:6px;font-size:12px">
                      <label style="display:flex;align-items:center;gap:6px;margin:0;cursor:pointer;font-weight:600">
                        <input type="checkbox" data-seg-toggle="${ps.surf}" ${sc.enabled ? 'checked' : ''}/> ${friendly}
                      </label>
                      <select class="mlrs-select" style="width:108px;padding:3px 6px;font-size:11.5px" data-seg-count="${ps.surf}" ${!sc.enabled ? 'disabled' : ''}>
                        ${Array.from({ length: maxS - minS + 1 }, (_, k) => minS + k).map(n => `<option value="${n}" ${sc.segments === n ? 'selected' : ''}>${n} Buttons</option>`).join('')}
                      </select>
                    </div>`;
                  }).join('')}
                  <div style="font-size:11px;color:var(--mlrs-muted-fg);margin-top:4px">Enabled bars split into individual icon buttons on both the stencil &amp; ESP32 Hub!</div>
                </div>
              ` : ''}</div>

              <div class="mlrs-sec-title" style="margin-top:14px">2. Surface Theme &amp; Print Palette</div>
              <div class="mlrs-field">
                <label>Theme Preset</label>
                <select class="mlrs-select" id="mlrsThemeSel">
                  ${Object.entries(Cat.FACIA_THEMES).map(([k, v]) => `<option value="${k}" ${draft.theme === k ? 'selected' : ''}>${v.name}</option>`).join('')}
                </select>
              </div>
              <div class="mlrs-field" style="display:grid;grid-template-columns:1fr 1fr;gap:7px">
                <div><label>Glass</label><input type="color" class="mlrs-input mlrs-swatch" id="mlrsColGlass" value="${effColors.glass}"/></div>
                <div><label>Keycap Fill</label><input type="color" class="mlrs-input mlrs-swatch" id="mlrsColPad" value="${effColors.padFill}"/></div>
                <div><label>Cut/Border</label><input type="color" class="mlrs-input mlrs-swatch" id="mlrsColStroke" value="${effColors.padStroke}"/></div>
                <div><label>Icon/Text Ink</label><input type="color" class="mlrs-input mlrs-swatch" id="mlrsColInk" value="${effColors.ink}"/></div>
              </div>
              <div class="mlrs-field">
                <label>Default Pad Style</label>
                <select class="mlrs-select" id="mlrsDefPadStyle">
                  <option value="keycap" ${draft.defaultPadStyle === 'keycap' ? 'selected' : ''}>Filled Keycap</option>
                  <option value="outline" ${draft.defaultPadStyle === 'outline' ? 'selected' : ''}>Crisp Stencil Outline</option>
                  <option value="minimal" ${draft.defaultPadStyle === 'minimal' ? 'selected' : ''}>Frameless Icon + Label</option>
                </select>
              </div>
              <div class="mlrs-field" style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
                <div>
                  <label>Background Colour</label>
                  <input type="color" class="mlrs-input" id="mlrsBgColor" style="height:32px;padding:2px" value="${draft.bgColor || '#111827'}"/>
                </div>
                <div>
                  <label>Boundary Line Colour</label>
                  <input type="color" class="mlrs-input" id="mlrsBoundaryColor" style="height:32px;padding:2px" value="${draft.boundaryColor || '#94a3b8'}"/>
                </div>
              </div>
              <div class="mlrs-box-sub" style="margin-bottom:10px;border-left:3px solid #0284c7">
                <div style="display:flex;align-items:center;justify-content:space-between;gap:6px;margin-bottom:5px">
                  <label style="font-size:12px;font-weight:700;margin:0">🖼️ Custom Background Graphic</label>
                  <div style="display:flex;gap:4px">
                    <input type="file" id="mlrsBgImgFile" accept="image/*" style="display:none"/>
                    <button type="button" class="mlrs-btn" id="mlrsBgImgPickBtn" style="padding:2px 8px;font-size:11px;font-weight:600">${(draft.bgImage && draft.bgImage.dataUrl) ? '🔄 Change' : '+ Upload Image'}</button>
                    ${(draft.bgImage && draft.bgImage.dataUrl) ? `<button type="button" class="mlrs-btn danger-outline" id="mlrsBgImgClearBtn" style="padding:2px 6px;font-size:11px" title="Remove background graphic">✕</button>` : ''}
                  </div>
                </div>
                ${(draft.bgImage && draft.bgImage.dataUrl) ? `
                  <div style="font-size:10.5px;color:var(--mlrs-muted-fg);margin-bottom:6px">Artwork: <b>${(draft.bgImage.name || 'Custom Graphic').replace(/[<>&"]/g, '')}</b> — align button overlays onto your graphic:</div>
                  <div style="display:grid;grid-template-columns:1.1fr 0.9fr;gap:6px;margin-bottom:6px">
                    <div>
                      <label style="font-size:10.5px;font-weight:600">Fit Mode</label>
                      <select class="mlrs-select" id="mlrsBgImgFit" style="padding:3px 6px;font-size:11px">
                        <option value="cover" ${(draft.bgImage.fit || 'cover') === 'cover' ? 'selected' : ''}>Cover (Fill Glass)</option>
                        <option value="contain" ${draft.bgImage.fit === 'contain' ? 'selected' : ''}>Contain (Whole Image)</option>
                        <option value="stretch" ${draft.bgImage.fit === 'stretch' ? 'selected' : ''}>Stretch 1:1</option>
                      </select>
                    </div>
                    <div>
                      <label style="font-size:10.5px;font-weight:600">Zoom (${draft.bgImage.scale ?? 100}%)</label>
                      <input type="range" min="40" max="250" step="2" id="mlrsBgImgScale" value="${draft.bgImage.scale ?? 100}" style="width:100%;accent-color:#0284c7"/>
                    </div>
                  </div>
                  <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-bottom:6px">
                    <div>
                      <label style="font-size:10.5px;font-weight:600">Pan X (${draft.bgImage.x ?? 0}%)</label>
                      <input type="range" min="-60" max="60" step="1" id="mlrsBgImgX" value="${draft.bgImage.x ?? 0}" style="width:100%;accent-color:#0284c7"/>
                    </div>
                    <div>
                      <label style="font-size:10.5px;font-weight:600">Pan Y (${draft.bgImage.y ?? 0}%)</label>
                      <input type="range" min="-60" max="60" step="1" id="mlrsBgImgY" value="${draft.bgImage.y ?? 0}" style="width:100%;accent-color:#0284c7"/>
                    </div>
                  </div>
                  <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px">
                    <div>
                      <label style="font-size:10.5px;font-weight:600" title="Opacity of the background artwork">Image Opacity (${draft.bgImage.opacity ?? 88}%)</label>
                      <input type="range" min="10" max="100" step="2" id="mlrsBgImgOp" value="${draft.bgImage.opacity ?? 88}" style="width:100%;accent-color:#0284c7"/>
                    </div>
                    <div>
                      <label style="font-size:10.5px;font-weight:600" title="0% = transparent button outlines over photo; 100% = solid keycaps">Button Backing (${draft.bgImage.padAlpha ?? 72}%)</label>
                      <input type="range" min="0" max="100" step="4" id="mlrsBgImgPadAlpha" value="${draft.bgImage.padAlpha ?? 72}" style="width:100%;accent-color:#0284c7"/>
                    </div>
                  </div>
                ` : `<div style="font-size:10.5px;color:var(--mlrs-muted-fg);line-height:1.35">Upload any room photo, floorplan, wood/marble texture, or custom artwork and fit your translucent button overlays right onto it.</div>`}
              </div>
              <div class="mlrs-field">
                <label>Panel Header Title</label>
                <input type="text" class="mlrs-input" id="mlrsPanelTitle" placeholder="e.g. MASTER SUITE" value="${draft.panelTitle || ''}"/>
              </div>
              <div class="mlrs-field" style="display:grid;grid-template-columns:1.35fr 0.85fr;gap:8px">
                <div>
                  <label>Default Stencil Font</label>
                  <select class="mlrs-select" id="mlrsPanelFont">
                    ${Object.entries(Cat.FACIA_FONTS || { sans: { name: 'Clean Sans' } }).map(([fk, fv]) => `<option value="${fk}" ${(draft.fontFamily || 'sans') === fk ? 'selected' : ''}>${fv.name}</option>`).join('')}
                  </select>
                </div>
                <div>
                  <label>Font Size (%)</label>
                  <input type="number" min="65" max="145" step="5" class="mlrs-input" id="mlrsPanelFontScale" value="${draft.fontScale || 100}"/>
                </div>
              </div>
              <div class="mlrs-box-sub" id="mlrsTourStepLuminous" style="margin-bottom:8px;border-left:3px solid #10b981">
                <div style="display:flex;align-items:center;justify-content:space-between;gap:6px;margin-bottom:5px">
                  <label style="display:flex;align-items:center;gap:6px;font-size:12px;font-weight:700;cursor:pointer;margin:0">
                    <input type="checkbox" id="mlrsLumMaster" ${(draft.luminous && draft.luminous.enabled) ? 'checked' : ''}/> <span class="mlrs-lum-swatch"></span> Luminous Glow Ink (POD)
                  </label>
                  <button type="button" class="mlrs-btn ${luminousPreview ? 'active-tab' : ''}" id="mlrsLumCardPreviewBtn" style="padding:2px 7px;font-size:10.5px">${luminousPreview ? '☀️ Day View' : '🌙 Test in Dark'}</button>
                </div>
                <div style="font-size:10.5px;color:var(--mlrs-muted-fg);margin-bottom:6px;line-height:1.35">Strontium Aluminate pigment looks subtle off-white by day and emits soft <b>aqua-green glow</b> in total darkness:</div>
                <div style="display:flex;gap:5px;margin-bottom:6px">
                  <button type="button" class="mlrs-btn" id="mlrsGlowAllBtn" style="flex:1;justify-content:center;padding:3px 6px;font-size:11px;border-color:#10b981;color:#059669;font-weight:700">✨ Glow Everything</button>
                  <button type="button" class="mlrs-btn" id="mlrsGlowNoneBtn" style="padding:3px 8px;font-size:11px">✕ Clear Glow</button>
                </div>
                <div style="display:flex;flex-wrap:wrap;gap:10px;font-size:11px">
                  <label style="display:flex;align-items:center;gap:4px;cursor:pointer"><input type="checkbox" id="mlrsLumBorder" ${(draft.luminous && draft.luminous.border) ? 'checked' : ''}/> Outer Boundary</label>
                  <label style="display:flex;align-items:center;gap:4px;cursor:pointer"><input type="checkbox" id="mlrsLumHeader" ${(draft.luminous && draft.luminous.header) ? 'checked' : ''}/> Header / Title</label>
                  <label style="display:flex;align-items:center;gap:4px;cursor:pointer"><input type="checkbox" id="mlrsLumSlots" ${(draft.luminous && draft.luminous.slots) ? 'checked' : ''}/> All Buttons, Wheel &amp; Sliders</label>
                </div>
              </div>
              <div class="mlrs-field" style="display:flex;flex-direction:column;gap:5px">
                <label style="display:flex;align-items:center;gap:6px;font-weight:500;cursor:pointer"><input type="checkbox" id="mlrsMonoChk" ${draft.monochrome ? 'checked' : ''}/> Pure Monochrome / B&amp;W Ink</label>
                <label style="display:flex;align-items:center;gap:6px;font-weight:500;cursor:pointer"><input type="checkbox" id="mlrsLedHole" ${draft.showLedPinhole ? 'checked' : ''}/> Show Status LED Pinhole</label>
              </div>
            </div>

            <!-- CENTER: Accurate 1:1 Capacitive Stencil Canvas -->
            <div class="mlrs-stage-wrap ${luminousPreview ? 'mlrs-night-room' : ''}">
              <div style="margin-bottom:10px;font-size:12px;color:var(--mlrs-muted-fg);text-align:center">
                ${mode === 'edit' ? '👆 <b>Design Mode:</b> Click any button, room rocker, or segmented wheel/bar slot to assign its icon &amp; function' : '🧪 <b>Interactive Test:</b> Short-tap multi-function pads to step (1→6), or <b>Hold 0.6s</b> to toggle ON/OFF!'}
              </div>
              <div class="mlrs-stage-card">
                <div id="mlrsCanvasStage" style="display:flex;align-items:center;justify-content:center;min-height:415px"></div>
                <div id="mlrsTestBanner" style="margin-top:12px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11.5px;color:var(--mlrs-fg);background:var(--mlrs-muted);padding:6px 12px;border-radius:6px;border:1px solid var(--mlrs-border);text-align:center">
                  ${lastTestReadout}
                </div>
              </div>
            </div>

            <!-- RIGHT: Selected Slot Inspector + Standardised Room & Device Icons -->
            <div class="mlrs-col">
              <div class="mlrs-sec-title" style="margin-bottom:6px">3. Selected Slot: <code style="padding:2px 6px;border-radius:4px;background:var(--mlrs-muted);border:1px solid var(--mlrs-border)">${selectedPadKey}</code></div>
              ${(() => {
                const surfMap = { hue_ring: 'hue_ring', hue: 'hue_ring', sat_bar: 'sat_bar', saturation: 'sat_bar', bri_bar: 'bri_bar', brightness: 'bri_bar', cct_bar: 'cct_bar', kelvin: 'cct_bar' };
                const targetSurf = surfMap[selectedPadKey];
                if (targetSurf && tz[targetSurf] && !tz[targetSurf].enabled) {
                  return `<div class="mlrs-box-sub" style="margin-bottom:10px;border-left:3px solid var(--mlrs-primary)">
                    <div style="font-size:11.5px;font-weight:700;margin-bottom:4px">Continuous Touch Surface Selected</div>
                    <div style="font-size:11px;color:var(--mlrs-muted-fg);margin-bottom:7px">Split this surface into 2–8 discrete buttons or custom <b>X% → Y% variable sliders</b>:</div>
                    <div style="display:flex;gap:6px;flex-wrap:wrap">
                      <button type="button" class="mlrs-btn primary" id="mlrsQuickSplitSlider" data-surf="${targetSurf}">⚡ Split as Variable Sliders</button>
                      <button type="button" class="mlrs-btn" id="mlrsQuickSplitBtn" data-surf="${targetSurf}">Split as Tap/Hold Buttons</button>
                    </div>
                  </div>`;
                }
                return '';
              })()}

              ${(() => {
                const isSegSlot = /^(hue|bri|cct|sat)_seg_\d+$/.test(selectedPadKey);
                const slotDef = bp.slots.find(sl => sl.key === selectedPadKey);
                const isUnsplitBar = Boolean(slotDef && (slotDef.type === 'vbar' || slotDef.type === 'hbar') && (!slotDef.surf || !tz[slotDef.surf] || !tz[slotDef.surf].enabled));
                const supportsSlider = isSegSlot || isUnsplitBar;
                const effMode = isUnsplitBar
                  ? (curPad.segmentMode || 'slider')
                  : ((isSegSlot && curPad.segmentMode === 'slider') ? 'slider' : (curMf.enabled ? 'multistep' : 'button'));
                return `
                <div class="mlrs-box-sub" id="mlrsTourStepBehaviour" style="margin-bottom:10px">
                  <label style="display:block;font-size:11.5px;font-weight:700;margin-bottom:6px">Slot Function &amp; Touch Behaviour</label>
                  <div style="display:grid;grid-template-columns:${supportsSlider ? '1fr 1fr 1fr' : '1fr 1fr'};gap:5px;margin-bottom:7px">
                    <button type="button" class="mlrs-btn ${effMode === 'button' ? 'active-tab' : ''}" style="justify-content:center;padding:5px 6px;font-size:11.5px" data-slot-mode="button">🔘 Tap / Toggle</button>
                    <button type="button" class="mlrs-btn ${effMode === 'multistep' ? 'active-tab' : ''}" style="justify-content:center;padding:5px 6px;font-size:11.5px" data-slot-mode="multistep">🔢 Step Cycle</button>
                    ${supportsSlider ? `<button type="button" class="mlrs-btn ${effMode === 'slider' ? 'active-tab' : ''}" style="justify-content:center;padding:5px 6px;font-size:11.5px" data-slot-mode="slider">🎚️ ${isUnsplitBar ? 'Slider &amp; Arrows' : 'X–Y% Slider'}</button>` : ''}
                  </div>
                  ${effMode === 'button' ? `
                    <div style="font-size:11px;color:var(--mlrs-muted-fg);line-height:1.38">Standard button pad (<b>1× Tap</b>, <b>2× Double</b>, <b>Hold</b>). Save stencil below to bind any HA/Homebridge entity in the Visual Mapper.</div>
                  ` : ''}
                  ${effMode === 'multistep' ? `
                    <div style="font-size:11px;color:var(--mlrs-muted-fg);margin-bottom:6px">Short tap steps <b>1 → N</b> (e.g. Fan Speed / Blind Pos); <b>Long Hold</b> toggles OFF.</div>
                    <div style="display:grid;grid-template-columns:1fr 1fr;gap:7px">
                      <div><label style="font-size:11px">Cycle Steps (2–8)</label><input type="number" min="2" max="8" class="mlrs-input" id="mlrsMfSteps" value="${curMf.steps || 5}"/></div>
                      <div><label style="font-size:11px">Step Unit</label><input type="text" class="mlrs-input" id="mlrsMfUnit" placeholder="Spd / Pos / Temp" value="${curMf.unit || 'Spd'}"/></div>
                    </div>
                  ` : ''}
                  ${effMode === 'slider' ? `
                    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:2px">
                      <div>
                        <label style="font-size:11px">Left / Start End (%)</label>
                        <input type="number" min="0" max="100" class="mlrs-input" id="mlrsSegMin" value="${curPad.sliderMin ?? 0}"/>
                      </div>
                      <div>
                        <label style="font-size:11px">Right / Far End (%)</label>
                        <input type="number" min="0" max="100" class="mlrs-input" id="mlrsSegMax" value="${curPad.sliderMax ?? 100}"/>
                      </div>
                    </div>
                    <div style="display:grid;grid-template-columns:0.88fr 1.12fr;gap:8px;margin-top:7px">
                      <div>
                        <label style="font-size:11px" title="0 = Solid line, 1.2 = Fine dots, 2.2 = Standard, 3.8 = Wide dash">Dot Pitch (mm)</label>
                        <input type="number" min="0" max="8" step="0.2" class="mlrs-input" id="mlrsSegPitch" value="${curPad.sliderPitch ?? draft.sliderPitch ?? 2.2}"/>
                      </div>
                      <div>
                        <label style="font-size:11px">Track End Arrows</label>
                        <select class="mlrs-select" id="mlrsSegArrows">
                          ${(() => {
                            const ar = curPad.sliderArrows || draft.sliderArrows || 'chevron';
                            return `
                              <option value="chevron" ${ar === 'chevron' ? 'selected' : ''}>‹ ⋯⋯ › Open Chevrons</option>
                              <option value="triangle" ${ar === 'triangle' ? 'selected' : ''}>◄ ⋯⋯ ► Solid Arrows</option>
                              <option value="dots" ${ar === 'dots' ? 'selected' : ''}>• ⋯⋯ ● Min/Max Dots</option>
                              <option value="ticks" ${ar === 'ticks' ? 'selected' : ''}>| ⋯⋯ | Scale End Ticks</option>
                              <option value="none" ${ar === 'none' ? 'selected' : ''}>⋯⋯⋯ Dots Only (No Caps)</option>
                              <option value="factory" ${ar === 'factory' ? 'selected' : ''}>🎨 Factory Gradient Bar</option>
                            `;
                          })()}
                        </select>
                      </div>
                    </div>
                    <div style="font-size:10.5px;color:var(--mlrs-muted-fg);margin-top:5px">Use <code>100 → 0</code> to invert (e.g. Blinds) or <code>15 → 85</code> to cap brightness.</div>
                  ` : ''}
                </div>`;
              })()}

              <div id="mlrsTourStepTypography">
              <div class="mlrs-field" style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
                <div>
                  <label>Main Label (Line 1)</label>
                  <input type="text" class="mlrs-input" id="mlrsPadLabel" placeholder="e.g. Blinds, Living" value="${curPad.label !== undefined ? curPad.label : ''}"/>
                </div>
                <div>
                  <label>Sub-Label (Line 2)</label>
                  <input type="text" class="mlrs-input" id="mlrsPadSub" placeholder="Auto (X→Y% / Hold) or custom" value="${curPad.sublabel !== undefined ? curPad.sublabel : ''}"/>
                </div>
              </div>

              <div class="mlrs-field" style="display:grid;grid-template-columns:1.2fr 0.95fr 0.65fr;gap:6px">
                <div>
                  <label title="Place icon beside text (Left/Right/Both Ends) so Main + Sub text stay centered!">Icon Placement</label>
                  <select class="mlrs-select" id="mlrsPadIconPos">
                    ${(() => {
                      const isVBarSel = Boolean((bp.slots.find(sl => sl.key === selectedPadKey) || {}).type === 'vbar'); const defPos = isVBarSel ? 'both' : (/^hue_seg_/.test(selectedPadKey) ? 'left' : 'top');
                      const pos = curPad.iconPos || defPos;
                      return `
                        <option value="left" ${pos === 'left' ? 'selected' : ''}>⬅️ Left of Text</option>
                        <option value="right" ${pos === 'right' ? 'selected' : ''}>➡️ Right of Text</option>
                        <option value="both" ${pos === 'both' ? 'selected' : ''}>↔️ Dual (Left &amp; Right Ends)</option>
                        <option value="top" ${pos === 'top' ? 'selected' : ''}>⬆️ Above Text</option>
                        <option value="bottom" ${pos === 'bottom' ? 'selected' : ''}>⬇️ Below Text</option>
                        <option value="none" ${pos === 'none' ? 'selected' : ''}>🔤 Text Only (No Icon)</option>
                      `;
                    })()}
                  </select>
                </div>
                <div>
                  <label>Slot Font</label>
                  <select class="mlrs-select" id="mlrsPadFont">
                    <option value="" ${!curPad.fontFamily ? 'selected' : ''}>Panel Default</option>
                    ${Object.entries(Cat.FACIA_FONTS || {}).map(([fk, fv]) => `<option value="${fk}" ${curPad.fontFamily === fk ? 'selected' : ''}>${fv.name.split(' (')[0]}</option>`).join('')}
                  </select>
                </div>
                <div>
                  <label>Size %</label>
                  <input type="number" min="65" max="145" step="5" class="mlrs-input" id="mlrsPadFontScale" placeholder="${draft.fontScale || 100}" value="${curPad.fontScale || ''}"/>
                </div>
              </div>

              ${((curPad.iconPos || ((bp.slots.find(sl => sl.key === selectedPadKey) || {}).type === 'vbar' ? 'both' : '')) === 'both') ? `
              <div class="mlrs-field">
                <label>Right / Far-End Secondary Icon (Dual Mode)</label>
                <select class="mlrs-select" id="mlrsPadIconEnd">
                  ${Object.entries(Cat.FACIA_ICONS || {}).map(([ik, iv]) => `<option value="${ik}" ${(curPad.iconEnd || curPad.icon || 'sun') === ik ? 'selected' : ''}>${iv.name || ik}</option>`).join('')}
                </select>
              </div>` : ''}
              </div>

              <div class="mlrs-field" style="display:grid;grid-template-columns:1.15fr 1fr;gap:8px;align-items:end">
                <div>
                  <label>Slot Visibility / Style</label>
                  <select class="mlrs-select" id="mlrsPadStyle">
                    <option value="" ${!curPad.style ? 'selected' : ''}>Use Panel Default (${draft.defaultPadStyle})</option>
                    <option value="keycap" ${curPad.style === 'keycap' ? 'selected' : ''}>Filled Keycap</option>
                    <option value="outline" ${curPad.style === 'outline' ? 'selected' : ''}>Crisp Outline</option>
                    <option value="minimal" ${curPad.style === 'minimal' ? 'selected' : ''}>Icon + Label Only</option>
                    <option value="blank" ${curPad.style === 'blank' ? 'selected' : ''}>Mask / Blank Unused Slot</option>
                  </select>
                </div>
                <label style="display:flex;align-items:center;gap:6px;font-weight:600;cursor:pointer;padding-bottom:7px">
                  <input type="checkbox" id="mlrsPadLuminous" ${(curPad.luminous || (draft.luminous && draft.luminous.enabled && draft.luminous.slots)) ? 'checked' : ''}/> Glow Slot (POD)
                </label>
              </div>

              <div class="mlrs-field">
                <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px">
                  <label style="margin:0">Standardised Icons</label>
                  <div class="mlrs-pill-group">
                    <button type="button" class="mlrs-btn ${iconTab === 'room' ? 'active-tab' : ''}" style="padding:3px 8px;font-size:11px" id="mlrsTabRoom">Rooms (12)</button>
                    <button type="button" class="mlrs-btn ${iconTab === 'device' ? 'active-tab' : ''}" style="padding:3px 8px;font-size:11px" id="mlrsTabDev">Devices (20)</button>
                  </div>
                </div>
                <div class="mlrs-icon-grid" id="mlrsIconGrid">
                  ${iconEntries.map(([k, ic]) => `
                    <button type="button" class="mlrs-icon-cell ${(curPad.icon || 'none') === k ? 'sel' : ''}" data-ico="${k}" title="${ic.name}">
                      ${ic.svg ? `<svg viewBox="0 0 24 24" width="18" height="18">${ic.svg}</svg>` : '<span style="font-size:10px;color:var(--mlrs-muted-fg)">None</span>'}
                    </button>
                  `).join('')}
                </div>
              </div>
            </div>
          </div>

          <div class="mlrs-footer ${opts.initialWorkflow === 'export_pod' ? 'mlrs-tour-focus' : ''}">
            <div style="display:flex;gap:8px;align-items:center">
              ${isEditingExistingCustom ? `<button type="button" class="mlrs-btn danger-outline" id="mlrsDeleteCustomBtn">Delete Custom Remote (${rawModel.id})</button>` : `<span style="font-size:12px;color:var(--mlrs-muted-fg)">Factory ${baseModel.id} is read-only — saving creates a reusable Custom Remote type.</span>`}
            </div>
            <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
              <button type="button" class="mlrs-btn" id="mlrsPrintBtn">Print 1:1 Stencil Sheet</button>
              <button type="button" class="mlrs-btn" id="mlrsDlSvgBtn">Download 1:1 SVG</button>
              <button type="button" class="mlrs-btn" id="mlrsDlPodBtn">Download POD Spec JSON</button>
              ${isEditingExistingCustom ? `<button type="button" class="mlrs-btn" id="mlrsSaveCopyBtn">Save as New Copy</button>` : ''}
              <button type="button" class="mlrs-btn" id="mlrsSaveWipBtn" style="border-color:#0284c7;color:#0284c7;font-weight:700" title="Save your work-in-progress draft so you can close and come back later without overwriting live remotes">📝 Save WIP Draft</button>
              <button type="button" class="mlrs-btn" id="mlrsCancelBtn">Cancel</button>
              <button type="button" class="mlrs-btn primary" id="mlrsDeployBtn">${isEditingExistingCustom ? 'Update Custom Remote' : '+ Create Custom Remote'}</button>
            </div>
          </div>
        </div>
      `;

      const stageBox = backdrop.querySelector('#mlrsCanvasStage');
      const refreshStageOnly = () => {
        mountInteractiveStage(stageBox, {
          model, uid: 'facia_editor_svg', maxHeight: isFullscreen ? 'min(78vh, 820px)' : 'min(66vh, 590px)',
          squareHeight: isFullscreen ? 'min(70vh, 720px)' : 'min(56vh, 500px)',
          facia: draft, touchZones: tz, calibration: cal, activeZone,
          editMode: mode === 'edit', selectedPadKey: mode === 'edit' ? selectedPadKey : null,
          luminousPreview, stepState,
          onSelectPad: (pk) => { selectedPadKey = pk; renderModal(); },
          onZoneChange: (z) => { activeZone = z; },
          onAction: (act, val, z, customMsg) => {
            lastTestReadout = customMsg ? `🟢 ${customMsg}  →  Hub TX (${act}=${val}, Z${z})` : `🟠 TX → Zone ${z} • ${act}(${val})`;
            const b = backdrop.querySelector('#mlrsTestBanner');
            if (b) b.textContent = lastTestReadout;
            if (typeof opts.onTestAction === 'function') opts.onTestAction(act, val, z);
          }
        });
        const b = backdrop.querySelector('#mlrsTestBanner');
        if (b) b.textContent = lastTestReadout;
        if (typeof refreshTourState === 'function') refreshTourState();
      };
      refreshStageOnly();

      // Mode & Close buttons
      backdrop.querySelector('#mlrsModeEdit').onclick = () => { mode = 'edit'; renderModal(); };
      backdrop.querySelector('#mlrsModeTest').onclick = () => { mode = 'test'; lastTestReadout = 'Tap any multi-function device button to cycle steps (1→6), or Hold 0.6s to toggle ON/OFF!'; renderModal(); };
      backdrop.querySelector('#mlrsCloseBtn').onclick = () => backdrop.remove();
      const cleanClose = () => {
        document.removeEventListener('fullscreenchange', onFsChange);
        if (document.fullscreenElement === backdrop && document.exitFullscreen) {
          document.exitFullscreen().catch(() => {});
        }
        backdrop.remove();
      };
      backdrop.querySelector('#mlrsCloseBtn').onclick = cleanClose;
      backdrop.querySelector('#mlrsCancelBtn').onclick = cleanClose;

      const fb = backdrop.querySelector('#mlrsFullBtn');
      if (fb) {
        fb.onclick = async () => {
          const currentlyFs = isFullscreen || (document.fullscreenElement === backdrop);
          if (!currentlyFs) {
            isFullscreen = true;
            backdrop.classList.add('mlrs-backdrop-fs');
            if (backdrop.requestFullscreen) {
              try { await backdrop.requestFullscreen(); } catch (_) {}
            }
          } else {
            isFullscreen = false;
            backdrop.classList.remove('mlrs-backdrop-fs');
            if (document.fullscreenElement && document.exitFullscreen) {
              try { await document.exitFullscreen(); } catch (_) {}
            }
          }
          renderModal();
        };
      }
      const gb = backdrop.querySelector('#mlrsOpenGestBtn');
      if (gb && typeof opts.onOpenGestures === 'function') {
        gb.onclick = () => { backdrop.remove(); opts.onOpenGestures(); };
      }
      const tourBox = backdrop.querySelector('#mlrsStudioTourMount');
      if (tourBox) {
        const hasSegSurfaces = panelSurfaces.length > 0;
        const hasBothRingAndBar = panelSurfaces.some(p => p.type === 'ring') && panelSurfaces.some(p => p.type !== 'ring');
        const surfFriendlyList = panelSurfaces.map(ps =>
          ps.surf === 'hue_ring' ? (ps.type === 'ring' ? 'Colour Ring' : 'Top Colour Strip')
          : ps.surf === 'cct_bar' ? 'CCT Strip'
          : ps.surf === 'sat_bar' ? 'Left Touch Bar' : 'Dimmer Bar'
        );
        const primarySurfLabel = surfFriendlyList[0] || 'Button Pad';

        const tourCtrl = mountShowcaseTour(tourBox, {
          tourId: 'stencil_build_path_v5',
          scopeEl: backdrop,
          steps: [
            {
              title: `Step 1 (${baseModel.id}) \u2014 Name Your Custom Stencil & Pick Starting Point`,
              hintShort: 'Edit Custom Remote Name above or click Start Bare & Next',
              targetSelector: '#mlrsTourStepIdentity',
              isComplete: () => step1Confirmed,
              body: `You are editing <b>${baseModel.id}</b> (${surfFriendlyList.length ? 'supports splitting: <b>' + surfFriendlyList.join(' + ') + '</b>' : 'discrete button pads'}). ` +
                    (!hasBothRingAndBar ? `<i>Tip: Want to test <b>both</b> a 360\u00b0 Arc Slider and a Straight Bar Slider together? Close &amp; pick <b>B8</b> or <b>B0</b>, or <a href="#" id="mlrsSwitchToB8Link" style="color:var(--mlrs-primary);font-weight:700;text-decoration:underline">click here to switch this session to B8 Showcase</a>!</i> ` : '') +
                    `Otherwise type a <b>Custom Remote Name</b> above (keep <b>Assign to ${hexId}</b> ticked) or click <b>\u2705 Start Bare &amp; Next \u25B6</b>.`,
              actionLabel: '\u2705 Start Bare & Go to Step 2 \u25B6',
              onAction: () => {
                step1Confirmed = true;
                tz = normalizeTouchZones(null);
                draft.pads = {};
                selectedPadKey = (bp.slots && bp.slots[0] && bp.slots[0].key) || 'zone_1';
                localStorage.setItem('mlrs_tour_stencil_build_path_v5_idx', '1');
                renderModal();
              }
            },
            {
              title: hasSegSurfaces ? `Step 2 \u2014 Split ${baseModel.id}'s ${primarySurfLabel} Into Segments` : `Step 2 \u2014 Select a Button Pad on ${baseModel.id}`,
              hintShort: hasSegSurfaces ? `Tick ${primarySurfLabel} in Section 1 (left)` : 'Click a button on the center remote',
              targetSelector: hasSegSurfaces ? '#mlrsTourStepSplit' : '#mlrsCanvasStage',
              isComplete: () => !hasSegSurfaces || Object.values(tz || {}).some(s => Boolean(s && s.enabled)),
              body: hasSegSurfaces
                ? `In the highlighted <b>1. Segment Wheels &amp; Bars</b> box on the left, tick <b>${surfFriendlyList.join('</b> or <b>')}</b> and choose how many segments (2\u20138) to create.`
                : `<b>${baseModel.id}</b> uses dedicated buttons rather than continuous sliders \u2014 click any button pad on the center faceplate to configure it.`,
              actionLabel: hasSegSurfaces ? `\u26A1 Split ${primarySurfLabel} & Next \u25B6` : 'Select Pad #1 & Next \u25B6',
              onAction: () => {
                if (hasSegSurfaces) {
                  const sk = panelSurfaces[0].surf;
                  tz[sk].enabled = true;
                  tz[sk].segments = sk === 'hue_ring' ? 4 : 2;
                  selectedPadKey = sk === 'hue_ring' ? 'hue_seg_1' : (sk.split('_')[0] + '_seg_1');
                }
                localStorage.setItem('mlrs_tour_stencil_build_path_v5_idx', '2');
                mode = 'edit';
                renderModal();
              }
            },
            {
              title: 'Step 3 \u2014 Choose Tap/Toggle, Step-Cycle, or X\u2013Y% Variable Slider',
              hintShort: 'Pick a mode pill + Dot Pitch / Arrows on the right',
              targetSelector: '#mlrsTourStepBehaviour',
              onEnter: () => {
                const activeSurf = panelSurfaces.find(ps => tz[ps.surf] && tz[ps.surf].enabled);
                if (activeSurf && !/^(hue|sat|bri|cct)_seg_/.test(selectedPadKey)) {
                  const sk = activeSurf.surf;
                  selectedPadKey = sk === 'hue_ring' ? 'hue_seg_1' : (sk.split('_')[0] + '_seg_1');
                  renderModal();
                }
              },
              isComplete: () => Object.values(draft.pads || {}).some(p => Boolean(p && (p.segmentMode === 'slider' || (p.multifunc && p.multifunc.enabled)))),
              body: hasSegSurfaces
                ? 'In the highlighted <b>Slot Function</b> card (right), click <b>\uD83C\uDF9A\uFE0F X\u2013Y% Slider</b> to set custom <b>Start/End %</b> (e.g. <code>100 \u2192 0</code>), <b>Dot Pitch (mm)</b>, and <b>Track End Arrows</b> \u2014 or pick <b>\uD83D\uDD22 Step Cycle</b>!'
                : 'In the highlighted <b>Slot Function</b> card (right), click <b>\uD83D\uDD22 Step Cycle</b> (tap steps 1\u2192N, hold = OFF) or <b>\uD83D\uDD18 Tap / Toggle</b>.',
              actionLabel: hasSegSurfaces ? '\uD83C\uDF9A\uFE0F Set 100\u21920% Slider & Next \u25B6' : '\uD83D\uDD22 Set 5-Step Cycle & Next \u25B6',
              onAction: () => {
                if (hasSegSurfaces) {
                  if (!Object.values(tz).some(s => s && s.enabled)) {
                    const sk = panelSurfaces[0].surf;
                    tz[sk].enabled = true; tz[sk].segments = sk === 'hue_ring' ? 4 : 2;
                    selectedPadKey = sk === 'hue_ring' ? 'hue_seg_1' : (sk.split('_')[0] + '_seg_1');
                  }
                  const p = ensurePad();
                  p.segmentMode = 'slider'; p.sliderMin = 100; p.sliderMax = 0; p.sliderPitch = 2.2; p.sliderArrows = 'chevron';
                } else {
                  const p = ensurePad();
                  p.multifunc = { enabled: true, steps: 5, unit: 'Spd' };
                }
                localStorage.setItem('mlrs_tour_stencil_build_path_v5_idx', '3');
                renderModal();
              }
            },
            {
              title: 'Step 4 \u2014 Set Main/Sub Text & Left / Right / Dual Icons',
              hintShort: 'Type Main Label + pick Left, Right, or Dual Icons',
              targetSelector: '#mlrsTourStepTypography',
              isComplete: () => {
                const p = draft.pads && draft.pads[selectedPadKey];
                return Boolean(p && p.label && p.icon && p.icon !== 'none');
              },
              body: 'In the highlighted <b>Labels &amp; Icon Placement</b> section (right), enter <b>Main + Sub Labels</b> and place icons to the <b>Left</b>, <b>Right</b>, or <b>Dual (Left &amp; Right Ends)</b> so text stays centered.',
              actionLabel: '\u2194\uFE0F Demo Dual Icons & Next \u25B6',
              onAction: () => {
                const p = ensurePad();
                p.label = p.label || 'Blinds'; p.sublabel = p.sublabel || '100\u21920% Slide';
                p.iconPos = 'both'; p.icon = 'blinds'; p.iconEnd = 'sun';
                localStorage.setItem('mlrs_tour_stencil_build_path_v5_idx', '4');
                renderModal();
              }
            },
            {
              title: 'Step 5 \u2014 Preview Nighttime Luminous Ink & Scrub Live',
              hintShort: 'Click Test in Dark or 2. Interactive Test',
              targetSelector: '#mlrsTourStepLuminous',
              isComplete: () => Boolean(luminousPreview || mode === 'test' || (draft.luminous && draft.luminous.enabled)),
              body: 'Tick <b>Luminous Glow Ink</b> in the highlighted box and click <b>\uD83C\uDF19 Test in Dark</b> to see how Strontium Aluminate glows at night \u2014 and try <b>2. Interactive Test</b> at the top to scrub your slider live!',
              actionLabel: '\uD83C\uDF19 Preview Night Glow & Next \u25B6',
              onAction: () => {
                luminousPreview = true;
                draft.luminous = Object.assign({ enabled: true, border: true, header: true, slots: false }, draft.luminous || {}, { enabled: true, border: true });
                localStorage.setItem('mlrs_tour_stencil_build_path_v5_idx', '5');
                renderModal();
              }
            },
            {
              title: 'Step 6 \u2014 Save Stencil & Map Real HA / Homebridge Devices',
              hintShort: 'Click Create / Update Custom Remote at bottom-right',
              targetSelector: '#mlrsDeployBtn',
              isComplete: () => false,
              body: `Click the highlighted <b>${isEditingExistingCustom ? 'Update Custom Remote' : '+ Create Custom Remote'}</b> button at the bottom-right! That attaches this stencil to <b>${hexId}</b> and returns you to the Visual Mapper to bind lights, blinds, fans, or scenes.`,
              actionLabel: '\uD83D\uDCBE Save & Return to Mapper',
              onAction: () => backdrop.querySelector('#mlrsDeployBtn')?.click()
            }
          ]
        });
        const switchB8Link = backdrop.querySelector('#mlrsSwitchToB8Link');
        if (switchB8Link) {
          switchB8Link.onclick = (ev) => {
            ev.preventDefault();
            backdrop.remove();
            const b8Mod = Cat.MODELS.find(m => m.id === 'CUST_B8_SLIDER_SHOWCASE') || Cat.MODELS.find(m => m.id === 'B8');
            if (b8Mod) openFaciaDesigner(Object.assign({}, opts, { model: b8Mod, remoteName: 'B8 Hybrid Slider Showcase', bindRemoteByDefault: false }));
          };
        }
        refreshTourState = tourCtrl ? tourCtrl.refresh : null;
      }
      backdrop.querySelector('#mlrsCancelBtn').onclick = () => backdrop.remove();

      // Preset Showcase Loader buttons
      backdrop.querySelectorAll('[data-preset-idx]').forEach(btn => {
        btn.onclick = () => {
          const pr = presets[Number(btn.getAttribute('data-preset-idx'))];
          if (!pr) return;
          tz = normalizeTouchZones(JSON.parse(JSON.stringify(pr.touch_zones)));
          Object.assign(draft, JSON.parse(JSON.stringify(pr.facia)));
          selectedPadKey = Object.keys(draft.pads || {})[0] || selectedPadKey;
          step1Confirmed = true;
          lastTestReadout = `Loaded "${pr.name}" — inspect any slot or click 2. Interactive Test to scrub sliders live!`;
          renderModal();
        };
      });

      const qsSlider = backdrop.querySelector('#mlrsQuickSplitSlider');
      if (qsSlider) qsSlider.onclick = () => {
        const sk = qsSlider.getAttribute('data-surf');
        tz[sk].enabled = true;
        tz[sk].segments = sk === 'hue_ring' ? 4 : 2;
        const pref = sk === 'hue_ring' ? 'hue_seg_1' : sk === 'cct_bar' ? 'cct_seg_1' : sk === 'sat_bar' ? 'sat_seg_1' : 'bri_seg_1';
        selectedPadKey = pref;
        const p = ensurePad();
        p.segmentMode = 'slider';
        if (p.sliderMin === undefined) p.sliderMin = 0;
        if (p.sliderMax === undefined) p.sliderMax = 100;
        renderModal();
      };
      const qsBtn = backdrop.querySelector('#mlrsQuickSplitBtn');
      if (qsBtn) qsBtn.onclick = () => {
        const sk = qsBtn.getAttribute('data-surf');
        tz[sk].enabled = true;
        selectedPadKey = sk === 'hue_ring' ? 'hue_seg_1' : sk === 'cct_bar' ? 'cct_seg_1' : sk === 'sat_bar' ? 'sat_seg_1' : 'bri_seg_1';
        renderModal();
      };

      // Segmentation toggles & counts
      backdrop.querySelectorAll('[data-seg-toggle]').forEach(chk => {
        chk.onchange = () => {
          const sk = chk.getAttribute('data-seg-toggle');
          tz[sk].enabled = chk.checked;
          if (chk.checked) {
            const pref = sk === 'hue_ring' ? 'hue_seg_1' : sk === 'cct_bar' ? 'cct_seg_1' : sk === 'sat_bar' ? 'sat_seg_1' : 'bri_seg_1';
            selectedPadKey = pref;
          }
          renderModal();
        };
      });
      backdrop.querySelectorAll('[data-seg-count]').forEach(sel => {
        sel.onchange = () => {
          const sk = sel.getAttribute('data-seg-count');
          tz[sk].segments = Number(sel.value);
          while (tz[sk].labels.length < tz[sk].segments) tz[sk].labels.push('');
          renderModal();
        };
      });

      // Surface Theme & Colors
      backdrop.querySelector('#mlrsThemeSel').onchange = (e) => {
        draft.theme = e.target.value; draft.colors = {};
        draft.monochrome = Boolean((Cat.FACIA_THEMES[draft.theme] || {}).mono);
        renderModal();
      };
      [['#mlrsColGlass','glass'],['#mlrsColPad','padFill'],['#mlrsColStroke','padStroke'],['#mlrsColInk','ink']].forEach(([id, k]) => {
        backdrop.querySelector(id).oninput = (e) => { draft.colors = draft.colors || {}; draft.colors[k] = e.target.value; refreshStageOnly(); };
      });
      backdrop.querySelector('#mlrsDefPadStyle').onchange = (e) => { draft.defaultPadStyle = e.target.value; renderModal(); };
      backdrop.querySelector('#mlrsPanelTitle').oninput = (e) => { draft.panelTitle = e.target.value; refreshStageOnly(); };
      const bgColEl = backdrop.querySelector('#mlrsBgColor');
      if (bgColEl) bgColEl.oninput = (e) => { draft.bgColor = e.target.value; refreshStageOnly(); };
      const bdrColEl = backdrop.querySelector('#mlrsBoundaryColor');
      if (bdrColEl) bdrColEl.oninput = (e) => { draft.boundaryColor = e.target.value; refreshStageOnly(); };
      const ensureLum = () => { if (!draft.luminous) draft.luminous = { enabled: false, border: true, header: false, slots: false }; return draft.luminous; };
      const lumMasterEl = backdrop.querySelector('#mlrsLumMaster');
      if (lumMasterEl) lumMasterEl.onchange = (e) => { const l = ensureLum(); l.enabled = e.target.checked; if (e.target.checked && !l.border && !l.header && !l.slots) l.border = true; refreshStageOnly(); };
      const lumBorderEl = backdrop.querySelector('#mlrsLumBorder');
      if (lumBorderEl) lumBorderEl.onchange = (e) => { const l = ensureLum(); l.border = e.target.checked; if (e.target.checked) l.enabled = true; refreshStageOnly(); };
      const lumHeaderEl = backdrop.querySelector('#mlrsLumHeader');
      if (lumHeaderEl) lumHeaderEl.onchange = (e) => { const l = ensureLum(); l.header = e.target.checked; if (e.target.checked) l.enabled = true; refreshStageOnly(); };
      const lumSlotsEl = backdrop.querySelector('#mlrsLumSlots');
      if (lumSlotsEl) lumSlotsEl.onchange = (e) => { const l = ensureLum(); l.slots = e.target.checked; if (e.target.checked) l.enabled = true; renderModal(); };
      const applyGlowAll = () => {
        draft.luminous = { enabled: true, border: true, header: true, slots: true };
        luminousPreview = true;
        renderModal();
      };
      const glowAllBtn = backdrop.querySelector('#mlrsGlowAllBtn');
      if (glowAllBtn) glowAllBtn.onclick = applyGlowAll;
      const topGlowAllBtn = backdrop.querySelector('#mlrsTopGlowAllBtn');
      if (topGlowAllBtn) topGlowAllBtn.onclick = applyGlowAll;
      const glowNoneBtn = backdrop.querySelector('#mlrsGlowNoneBtn');
      if (glowNoneBtn) glowNoneBtn.onclick = () => {
        draft.luminous = { enabled: false, border: false, header: false, slots: false };
        Object.values(draft.pads || {}).forEach(p => { if (p) delete p.luminous; });
        renderModal();
      };
      const padLumEl = backdrop.querySelector('#mlrsPadLuminous');
      if (padLumEl) padLumEl.onchange = (e) => { const p = ensurePad(); p.luminous = e.target.checked; refreshStageOnly(); };
      backdrop.querySelector('#mlrsMonoChk').onchange = (e) => { draft.monochrome = e.target.checked; renderModal(); };
      backdrop.querySelector('#mlrsLedHole').onchange = (e) => { draft.showLedPinhole = e.target.checked; refreshStageOnly(); };

      // Right Column Inspector
      const ensurePad = () => {
        if (!draft.pads[selectedPadKey]) draft.pads[selectedPadKey] = {};
        const slDef = bp.slots.find(sl => sl.key === selectedPadKey);
        if (slDef && (slDef.type === 'vbar' || slDef.type === 'hbar') && draft.pads[selectedPadKey].sliderArrows !== 'factory') {
          draft.pads[selectedPadKey].customTrack = true;
        }
        return draft.pads[selectedPadKey];
      };
      backdrop.querySelector('#mlrsPadStyle').onchange = (e) => { const p = ensurePad(); if (e.target.value) p.style = e.target.value; else delete p.style; renderModal(); };
      const segModeEl = backdrop.querySelector('#mlrsSegMode');
      if (segModeEl) segModeEl.onchange = (e) => {
        const p = ensurePad();
        p.segmentMode = e.target.value;
        if (p.segmentMode === 'slider' && p.multifunc) p.multifunc.enabled = false;
        renderModal();
      };
      const segMinEl = backdrop.querySelector('#mlrsSegMin');
      if (segMinEl) segMinEl.oninput = (e) => {
        const p = ensurePad();
        p.sliderMin = Math.max(0, Math.min(100, Number(e.target.value || 0)));
        refreshStageOnly();
      };
            const toggleNightPreview = () => {
        luminousPreview = !luminousPreview;
        if (luminousPreview && !(draft.luminous && (draft.luminous.enabled || Object.values(draft.pads || {}).some(p => p && p.luminous)))) {
          draft.luminous = Object.assign({ enabled: true, border: true, header: true, slots: false }, draft.luminous || {}, { enabled: true, border: true });
        }
        renderModal();
      };
      const lumPrevBtn = backdrop.querySelector('#mlrsLumPreviewBtn');
      if (lumPrevBtn) lumPrevBtn.onclick = toggleNightPreview;
      const lumCardPrevBtn = backdrop.querySelector('#mlrsLumCardPreviewBtn');
      if (lumCardPrevBtn) lumCardPrevBtn.onclick = toggleNightPreview;

      const bareBtn = backdrop.querySelector('#mlrsResetBareBtn');
      if (bareBtn) bareBtn.onclick = () => {
        tz = normalizeTouchZones(null);
        draft.pads = {};
        draft.panelTitle = '';
        draft.luminous = { enabled: false, border: false, header: false, slots: false };
        luminousPreview = false;
        selectedPadKey = (bp.slots && bp.slots[0] && bp.slots[0].key) || 'zone_1';
        step1Confirmed = true;
        lastTestReadout = `Reset to bare ${baseModel.id} panel — now click Next ▶ in the Guided Path to split a wheel or bar!`;
        renderModal();
      };

      const segPitchEl = backdrop.querySelector('#mlrsSegPitch');
      if (segPitchEl) segPitchEl.oninput = (e) => {
        const p = ensurePad();
        p.sliderPitch = Math.max(0, Math.min(8, Number(e.target.value ?? 2.2)));
        refreshStageOnly();
      };
      const segArrowsEl = backdrop.querySelector('#mlrsSegArrows');
      if (segArrowsEl) segArrowsEl.onchange = (e) => {
        const p = ensurePad();
        p.sliderArrows = e.target.value || 'chevron';
        if (p.sliderArrows === 'factory') delete p.customTrack;
        else p.customTrack = true;
        refreshStageOnly();
      };

      const segMaxEl = backdrop.querySelector('#mlrsSegMax');
      if (segMaxEl) segMaxEl.oninput = (e) => {
        const p = ensurePad();
        p.sliderMax = Math.max(0, Math.min(100, Number(e.target.value || 100)));
        refreshStageOnly();
      };
      const pFontEl = backdrop.querySelector('#mlrsPanelFont');
      if (pFontEl) pFontEl.onchange = (e) => { draft.fontFamily = e.target.value || 'sans'; refreshStageOnly(); };
      const pScaleEl = backdrop.querySelector('#mlrsPanelFontScale');
      if (pScaleEl) pScaleEl.oninput = (e) => { draft.fontScale = Math.max(65, Math.min(145, Number(e.target.value || 100))); refreshStageOnly(); };

            backdrop.querySelectorAll('[data-slot-mode]').forEach(b => {
        b.onclick = () => {
          const mVal = b.getAttribute('data-slot-mode');
          const p = ensurePad();
          if (mVal === 'slider') {
            p.segmentMode = 'slider';
            if (p.sliderMin === undefined) p.sliderMin = 0;
            if (p.sliderMax === undefined) p.sliderMax = 100;
            if (p.multifunc) p.multifunc.enabled = false;
          } else if (mVal === 'multistep') {
            p.segmentMode = 'button';
            p.multifunc = Object.assign({ steps: 5, unit: 'Spd' }, p.multifunc || {}, { enabled: true });
          } else {
            p.segmentMode = 'button';
            if (p.multifunc) p.multifunc.enabled = false;
          }
          renderModal();
        };
      });
      const iconEndEl = backdrop.querySelector('#mlrsPadIconEnd');
      if (iconEndEl) iconEndEl.onchange = (e) => { ensurePad().iconEnd = e.target.value || 'none'; refreshStageOnly(); };

      const iconPosEl = backdrop.querySelector('#mlrsPadIconPos');
      if (iconPosEl) iconPosEl.onchange = (e) => { ensurePad().iconPos = e.target.value || 'left'; renderModal(); };
      const padFontEl = backdrop.querySelector('#mlrsPadFont');
      if (padFontEl) padFontEl.onchange = (e) => { const p = ensurePad(); if (e.target.value) p.fontFamily = e.target.value; else delete p.fontFamily; refreshStageOnly(); };
      const padScaleEl = backdrop.querySelector('#mlrsPadFontScale');
      if (padScaleEl) padScaleEl.oninput = (e) => { const p = ensurePad(); const v = Number(e.target.value); if (v >= 65 && v <= 145) p.fontScale = v; else delete p.fontScale; refreshStageOnly(); };

      backdrop.querySelector('#mlrsPadLabel').oninput = (e) => { const p = ensurePad(); p.label = e.target.value; syncLabelToTouchZone(selectedPadKey, e.target.value); refreshStageOnly(); };
      backdrop.querySelector('#mlrsPadSub').oninput = (e) => { const p = ensurePad(); p.sublabel = e.target.value; refreshStageOnly(); };
      const mfChkLegacy = backdrop.querySelector('#mlrsMfChk'); if (mfChkLegacy) mfChkLegacy.onchange = (e) => {
        const p = ensurePad();
        p.multifunc = Object.assign({ steps: 6, unit: 'Spd' }, p.multifunc || {}, { enabled: e.target.checked });
        renderModal();
      };
      const mfS = backdrop.querySelector('#mlrsMfSteps');
      if (mfS) mfS.oninput = (e) => { ensurePad().multifunc.steps = Number(e.target.value || 4); refreshStageOnly(); };
      const mfU = backdrop.querySelector('#mlrsMfUnit');
      if (mfU) mfU.oninput = (e) => { ensurePad().multifunc.unit = e.target.value; refreshStageOnly(); };

      backdrop.querySelector('#mlrsTabRoom').onclick = () => { iconTab = 'room'; renderModal(); };
      backdrop.querySelector('#mlrsTabDev').onclick = () => { iconTab = 'device'; renderModal(); };
      backdrop.querySelectorAll('#mlrsIconGrid .mlrs-icon-cell').forEach(btn => {
        btn.onclick = () => {
          const p = ensurePad();
          const icoKey = btn.getAttribute('data-ico');
          p.icon = icoKey;
          // Auto-fill clean room/device name if label wasn't set yet
          if (icoKey !== 'none' && !p.label) {
            const icObj = Cat.FACIA_ICONS[icoKey];
            if (icObj) {
              p.label = icObj.name.split(' (')[0].split(' / ')[0];
              syncLabelToTouchZone(selectedPadKey, p.label);
            }
          }
          renderModal();
        };
      });

      // Print & Export
      backdrop.querySelector('#mlrsPrintBtn').onclick = () => openPrintSheetWindow(remoteName, hexId, model, draft, tz, activeZone);
      backdrop.querySelector('#mlrsDlSvgBtn').onclick = (ev) => {
        if (ev) { ev.preventDefault(); ev.stopPropagation(); }
        const svgStr = buildOneToOnePrintSvg(model, draft, tz, activeZone);
        const fName = `${model.id.toLowerCase()}_${hexId.toLowerCase()}_stencil_1to1.svg`;
        downloadTextFile(fName, svgStr, 'image/svg+xml', { hubBase });
      };
      const podBtn = backdrop.querySelector('#mlrsDlPodBtn');
      if (podBtn) podBtn.onclick = (ev) => {
        if (ev) { ev.preventDefault(); ev.stopPropagation(); }
        const podObj = buildPodOrderPayload(remoteName, hexId, model, draft, tz, activeZone);
        const fName = `${model.id.toLowerCase()}_${hexId.toLowerCase()}_pod_order.json`;
        downloadTextFile(fName, JSON.stringify(podObj, null, 2), 'application/json', { hubBase });
      };

            // Background Graphic Upload, Fit, Zoom, Pan & Frosted Keycap Alpha handlers
      const bgFileInp = backdrop.querySelector('#mlrsBgImgFile');
      const bgPickBtn = backdrop.querySelector('#mlrsBgImgPickBtn');
      if (bgPickBtn && bgFileInp) {
        bgPickBtn.onclick = () => bgFileInp.click();
        bgFileInp.onchange = async (ev) => {
          const f = ev.target.files && ev.target.files[0];
          if (!f) return;
          bgPickBtn.textContent = '⏳ Loading…';
          try {
            const dUrl = await compressImageFileToDataUrl(f, 880);
            draft.bgImage = Object.assign({ fit: 'cover', scale: 100, x: 0, y: 0, opacity: 88, padAlpha: 72 }, draft.bgImage || {}, {
              dataUrl: dUrl,
              name: f.name || 'custom_graphic'
            });
            lastTestReadout = `Loaded background graphic "${f.name}" — adjust Zoom, Pan & Button Backing opacity on the left!`;
            renderModal();
          } catch (err) {
            bgPickBtn.textContent = '+ Upload Image';
            alert('Could not load image: ' + err);
          }
        };
      }
      const bgClearBtn = backdrop.querySelector('#mlrsBgImgClearBtn');
      if (bgClearBtn) bgClearBtn.onclick = () => { delete draft.bgImage; renderModal(); };
      const bgFitEl = backdrop.querySelector('#mlrsBgImgFit');
      if (bgFitEl) bgFitEl.onchange = (e) => { if (draft.bgImage) { draft.bgImage.fit = e.target.value; refreshStageOnly(); } };
      [['#mlrsBgImgScale', 'scale', 'Zoom'], ['#mlrsBgImgX', 'x', 'Pan X'], ['#mlrsBgImgY', 'y', 'Pan Y'], ['#mlrsBgImgOp', 'opacity', 'Image Opacity'], ['#mlrsBgImgPadAlpha', 'padAlpha', 'Button Backing']].forEach(([sel, prop, lblTxt]) => {
        const el = backdrop.querySelector(sel);
        if (el) el.oninput = (e) => {
          if (!draft.bgImage) return;
          draft.bgImage[prop] = Number(e.target.value);
          const lbl = el.previousElementSibling;
          if (lbl) lbl.textContent = `${lblTxt} (${draft.bgImage[prop]}%)`;
          refreshStageOnly();
        };
      });

      // Glow Everything / Clear Glow handlers (safe idempotent bind)
      const glowAllB = backdrop.querySelector('#mlrsGlowAllBtn');
      if (glowAllB && !glowAllB.onclick) glowAllB.onclick = () => { draft.luminous = { enabled: true, border: true, header: true, slots: true }; luminousPreview = true; renderModal(); };
      const glowNoneB = backdrop.querySelector('#mlrsGlowNoneBtn');
      if (glowNoneB && !glowNoneB.onclick) glowNoneB.onclick = () => { draft.luminous = { enabled: false, border: false, header: false, slots: false }; Object.values(draft.pads || {}).forEach(p => { if (p) delete p.luminous; }); renderModal(); };

      // Save & Resume Work-in-Progress (WIP) Draft handlers
      const saveWipBtn = backdrop.querySelector('#mlrsSaveWipBtn');
      if (saveWipBtn) {
        saveWipBtn.onclick = () => {
          const cleanName = (customModelName || '').trim() || `${baseModel.id} Draft`;
          const dId = currentDraftId || `WIP_${baseModel.id}_${Date.now().toString(36).toUpperCase()}`;
          currentDraftId = dId;
          const now = new Date();
          const savedAtShort = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
          const res = saveWipDraftRecord({
            id: dId,
            name: cleanName,
            baseModelId: baseModel.id,
            hexId,
            facia: JSON.parse(JSON.stringify(draft)),
            touchZones: JSON.parse(JSON.stringify(tz)),
            selectedPadKey,
            savedAt: now.toISOString(),
            savedAtShort
          });
          if (res.ok) {
            lastTestReadout = `📝 Saved WIP Draft "${cleanName}" (${savedAtShort}) — safe to close and resume anytime from the top bar!`;
            renderModal();
            const freshBtn = backdrop.querySelector('#mlrsSaveWipBtn');
            if (freshBtn) {
              freshBtn.textContent = `✅ Draft Saved (${savedAtShort})!`;
              freshBtn.style.background = '#059669';
              freshBtn.style.color = '#ffffff';
              freshBtn.style.borderColor = '#059669';
              setTimeout(() => { if (freshBtn.isConnected) { freshBtn.textContent = '📝 Save WIP Draft'; freshBtn.style.background = ''; freshBtn.style.color = '#0284c7'; freshBtn.style.borderColor = '#0284c7'; } }, 2400);
            }
          } else {
            alert('Could not save draft locally: ' + res.error);
          }
        };
      }
      const resumeWipSel = backdrop.querySelector('#mlrsResumeWipSel');
      if (resumeWipSel) {
        resumeWipSel.onchange = (e) => {
          const pickId = e.target.value;
          const found = loadWipDrafts().find(d => d.id === pickId);
          if (!found) return;
          currentDraftId = found.id;
          customModelName = found.name || customModelName;
          tz = normalizeTouchZones(found.touchZones);
          Object.keys(draft).forEach(k => delete draft[k]);
          Object.assign(draft, JSON.parse(JSON.stringify(found.facia || { enabled: true, pads: {} })));
          selectedPadKey = found.selectedPadKey || selectedPadKey;
          step1Confirmed = true;
          lastTestReadout = `📂 Loaded WIP Draft "${found.name}" (${found.savedAtShort || 'saved'})!`;
          renderModal();
        };
      }
      const delWipBtn = backdrop.querySelector('#mlrsDelWipBtn');
      if (delWipBtn) {
        delWipBtn.onclick = () => {
          if (!currentDraftId) return;
          deleteWipDraftRecord(currentDraftId);
          currentDraftId = null;
          lastTestReadout = 'Removed saved WIP draft.';
          renderModal();
        };
      }

      const nameInp = backdrop.querySelector('#mlrsCustomModelName');
      if (nameInp) nameInp.oninput = (e) => { customModelName = e.target.value; step1Confirmed = Boolean(customModelName.trim().length >= 2); if (typeof refreshTourState === 'function') refreshTourState(); };
      const bindChk = backdrop.querySelector('#mlrsBindNowChk');
      if (bindChk) bindChk.onchange = (e) => { bindCurrentRemote = e.target.checked; };

      const persistCustomModel = async (forceNewCopy) => {
        const cleanName = (customModelName || '').trim() || `${baseModel.id} Custom`;
        const targetId = (isEditingExistingCustom && !forceNewCopy) ? rawModel.id : slugifyCustomId(baseModel.id, cleanName);
        const payload = {
          id: targetId,
          name: forceNewCopy ? `${cleanName} Copy` : cleanName,
          base_model: baseModel.id,
          stencil_mode: 'full_panel',
          facia: draft,
          touch_zones: tz
        };
        if (typeof opts.onSaveCustomModel === 'function') {
          // Host integration (Home Assistant / Homebridge) handles persistence & Hub proxy!
          if (hubBase) {
            fetch(`${hubBase}/api/remotes/custom_models`, {
              method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
            }).then(() => Cat.syncCustomModelsFromHub(hubBase)).catch(() => {});
          }
          if (Cat.upsertCustomModel) Cat.upsertCustomModel(payload);
          await opts.onSaveCustomModel({ customModel: payload, bindNow: bindCurrentRemote, calibration: cal, touchZones: tz, facia: draft });
        } else {
          const res = await fetch(`${hubBase}/api/remotes/custom_models`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
          });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          await Cat.syncCustomModelsFromHub(hubBase);
          if (bindCurrentRemote && typeof opts.onSave === 'function') {
            await opts.onSave(draft, cal, tz, targetId);
          }
        }
        backdrop.remove();
      };

      const delBtn = backdrop.querySelector('#mlrsDeleteCustomBtn');
      if (delBtn) {
        delBtn.onclick = async () => {
          if (!confirm(`Delete custom remote "${rawModel.name}" (${rawModel.id})? Any bound remotes will safely revert to factory ${baseModel.id}.`)) return;
          await fetch(`${hubBase}/api/remotes/custom_models/delete`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: rawModel.id })
          });
          await Cat.syncCustomModelsFromHub(hubBase);
          if (typeof opts.onDeleteCustomModel === 'function') await opts.onDeleteCustomModel(rawModel.id, baseModel.id);
          backdrop.remove();
        };
      }

      const copyBtn = backdrop.querySelector('#mlrsSaveCopyBtn');
      if (copyBtn) copyBtn.onclick = () => persistCustomModel(true);

      backdrop.querySelector('#mlrsDeployBtn').onclick = async () => {
        const btn = backdrop.querySelector('#mlrsDeployBtn');
        btn.textContent = 'Saving Custom Remote...';
        try {
          await persistCustomModel(false);
        } catch (err) {
          btn.textContent = isEditingExistingCustom ? 'Update Custom Remote' : '+ Create Custom Remote';
          alert('Save failed: ' + err);
        }
      };
    }

    document.body.appendChild(backdrop);
    renderModal();
    return backdrop;
  }

  function normalizeSliderPct(rawVal, act) {
    if (rawVal === undefined || rawVal === null || rawVal === '') return 0;
    const n = Number(rawVal);
    if (Number.isNaN(n)) return 0;
    let pct = n > 100 ? (n / 255) * 100 : n;
    const a = String(act || '').toLowerCase();
    if (a === 'brightness' || a === 'level') {
      // Physical MiBoxer brightness sliders report ~26 at the bottom stop and ~98-100 at the top
      if (pct <= 26.5) return 0;
      if (pct >= 98) return 100;
      pct = ((pct - 26.5) / (98 - 26.5)) * 100;
    }
    return Math.max(0, Math.min(100, pct));
  }

  // Physical RF hue -> clockwise degrees from 12 o'clock (0=top, 90=3h, 180=6h, 270=9h)
  function physicalHueToWheelDeg(rawHue, cal) {
    let h = Number(rawHue || 0);
    if (h > 360) h = (h / 255) * 360;
    h = ((h % 360) + 360) % 360;
    let deg = (270 - h + 360) % 360;
    if (cal && cal.hue_invert) deg = (360 - deg) % 360;
    if (cal && cal.hue_offset) deg = (deg + Number(cal.hue_offset) + 360) % 360;
    return deg;
  }

  function resolvePhysicalToCustomAction(action, value, zone, touchZones, calibration) {
    const tz = normalizeTouchZones(touchZones);
    const cal = Object.assign(defaultCalibration(), calibration || {});
    const z = Number(zone || 0);
    const zBit = z < 16 ? (1 << z) : 0x8000;
    const act = String(action || '').toLowerCase();
    const numVal = (value !== undefined && value !== null && value !== '') ? Number(value) : -1;

    if (act === 'hue' && numVal >= 0 && tz.hue_ring.enabled && (tz.hue_ring.zone_mask & zBit)) {
      const n = Math.min(12, Math.max(2, Number(tz.hue_ring.segments || 4)));
      const span = 360 / n;
      const deg = physicalHueToWheelDeg(numVal, cal);
      const rel = ((deg - Number(tz.hue_ring.offset_deg || 0)) % 360 + 360) % 360;
      const idx = Math.min(n - 1, Math.max(0, Math.floor(rel / span)));
      return {
        action: `hue_seg_${idx + 1}`,
        value: idx + 1,
        label: tz.hue_ring.labels[idx] || `Slice ${idx + 1}`,
        converted: true
      };
    }

    let targetBar = null, pref = '';
    if (act === 'saturation' && tz.sat_bar.enabled && (tz.sat_bar.zone_mask & zBit)) {
      targetBar = tz.sat_bar; pref = 'sat_seg_';
    } else if ((act === 'color_temp' || act === 'kelvin') && tz.cct_bar.enabled && (tz.cct_bar.zone_mask & zBit)) {
      targetBar = tz.cct_bar; pref = 'cct_seg_';
    } else if ((act === 'color_temp' || act === 'kelvin') && tz.sat_bar.enabled && !tz.cct_bar.enabled && (tz.sat_bar.zone_mask & zBit)) {
      targetBar = tz.sat_bar; pref = 'sat_seg_';
    } else if ((act === 'brightness' || act === 'level') && tz.bri_bar.enabled && (tz.bri_bar.zone_mask & zBit)) {
      targetBar = tz.bri_bar; pref = 'bri_seg_';
    }

    if (targetBar && numVal >= 0) {
      const n = Math.min(6, Math.max(2, Number(targetBar.segments || 4)));
      const rawPct = numVal > 100 ? (numVal / 255) * 100 : Math.max(0, Math.min(100, numVal));
      // Physical B8 saturation bar outputs 0 at TOP and 100 at BOTTOM:
      // In miboxer_catalog.js, sat_seg_1 is drawn at BOTTOM (idx=0) and sat_seg_N at TOP (idx=n-1).
      // So 0% (top touch) -> sat_seg_N (top button), 50% -> middle, 100% (bottom touch) -> sat_seg_1 (bottom button)!
      if (pref === 'sat_seg_') {
        const fromTopIdx = Math.min(n - 1, Math.max(0, Math.floor((rawPct / 100.0001) * n)));
        const idx = (n - 1) - fromTopIdx;
        return {
          action: `${pref}${idx + 1}`,
          value: idx + 1,
          label: targetBar.labels[idx] || `Slot ${idx + 1}`,
          converted: true
        };
      }
      const effPct = (pref === 'bri_seg_') ? normalizeSliderPct(numVal, 'brightness') : rawPct;
      const idx = Math.min(n - 1, Math.max(0, Math.floor((effPct / 100.0001) * n)));
      return {
        action: `${pref}${idx + 1}`,
        value: idx + 1,
        label: targetBar.labels[idx] || `Slot ${idx + 1}`,
        converted: true
      };
    }

    return { action, value: numVal, label: '', converted: false };
  }


  function resolveCustomToPhysicalAction(action, value, zone, touchZones, cal) {
    const act = String(action || '');
    const m = act.match(/^(hue|sat|cct|bri)_seg_(\d+)$/);
    if (!m) return { action: act, value: value, visDeg: undefined, pct: undefined, converted: false };
    const kind = m[1];
    const segNum = Math.max(1, Number(m[2] || value || 1));
    const tz = normalizeTouchZones(touchZones);
    if (kind === 'hue') {
      const n = Math.min(12, Math.max(2, Number(tz.hue_ring.segments || 6)));
      const span = 360 / n;
      const off = Number(tz.hue_ring.offset_deg || 0);
      const visDeg = (((off + (segNum - 0.5) * span) % 360) + 360) % 360;
      const c = Object.assign(defaultCalibration(), cal || {});
      const topRaw = typeof c.hueTopRaw === 'number' ? c.hueTopRaw : (c.wheel_top_raw ?? 0);
      const dir = (c.hueDir === -1 || c.wheel_dir === -1) ? -1 : 1;
      const rawHue = Math.round((((topRaw + dir * visDeg) % 360) + 360) % 360);
      return { action: 'hue', value: rawHue, visDeg, converted: true };
    }
    const cfg = kind === 'sat' ? tz.sat_bar : (kind === 'cct' ? tz.cct_bar : tz.bri_bar);
    const n = Math.min(6, Math.max(2, Number((cfg && cfg.segments) || 4)));
    const pct = Math.max(0, Math.min(100, Math.round(((segNum - 0.5) / n) * 100)));
    if (kind === 'sat') return { action: 'saturation', value: Math.max(0, Math.min(100, Math.round(100 - pct))), pct, converted: true };
    if (kind === 'cct') return { action: 'color_temp', value: Math.round(370 - (pct / 100) * 217), pct, converted: true };
    return { action: 'brightness', value: pct, pct, converted: true };
  }


  function computePeelClipPolygons(peelPct) {
    const p = Math.max(0, Math.min(100, Number(peelPct) || 0));
    if (p <= 0.5) return { overClip: 'polygon(0% 0%, 100% 0%, 100% 100%, 0% 100%)', flapClip: 'polygon(100% 0%, 100% 0%, 100% 0%)', flapOpacity: 0 };
    if (p >= 99.5) return { overClip: 'polygon(0% 100%, 0% 100%, 0% 100%)', flapClip: 'polygon(0% 0%, 0% 0%, 0% 0%)', flapOpacity: 0 };
    const d = (p / 100) * 200;
    if (d <= 100) {
      const xCut = 100 - d, yCut = d;
      const fx = Math.max(0, xCut - d * 0.28), fy = Math.min(100, yCut + d * 0.28);
      return {
        overClip: `polygon(0% 0%, ${xCut.toFixed(1)}% 0%, 100% ${yCut.toFixed(1)}%, 100% 100%, 0% 100%)`,
        flapClip: `polygon(${xCut.toFixed(1)}% 0%, 100% ${yCut.toFixed(1)}%, ${fx.toFixed(1)}% ${fy.toFixed(1)}%)`,
        flapOpacity: 0.92
      };
    }
    const rem = 200 - d, xBot = rem, yLeft = 100 - rem;
    const fx = Math.max(0, xBot * 0.55), fy = Math.min(100, yLeft + (100 - yLeft) * 0.45);
    return {
      overClip: `polygon(0% ${yLeft.toFixed(1)}%, ${xBot.toFixed(1)}% 100%, 0% 100%)`,
      flapClip: `polygon(0% ${yLeft.toFixed(1)}%, ${xBot.toFixed(1)}% 100%, ${fx.toFixed(1)}% ${fy.toFixed(1)}%)`,
      flapOpacity: Math.max(0.18, rem / 110)
    };
  }

  function mountPeelableStage(containerEl, opts) {
    injectStudioStyles(containerEl);
    const Cat = root.MiBoxerCatalog;
    if (!containerEl || !Cat) return null;
    const overlayModel = typeof opts.overlayModel === 'string' ? (Cat.MODELS.find(m => m.id === opts.overlayModel) || Cat.MODELS[0]) : opts.overlayModel;
    const baseId = (overlayModel && (overlayModel.baseModel || overlayModel.base)) || opts.physicalModelId || 'B8';
    const candPhys = opts.physicalModel
      ? (typeof opts.physicalModel === 'string' ? Cat.MODELS.find(m => m.id === opts.physicalModel) : opts.physicalModel)
      : null;
    const physicalModel = (candPhys && (!Cat.areModelsPhysicallyCompatible || Cat.areModelsPhysicallyCompatible(overlayModel, candPhys)))
      ? candPhys
      : (Cat.MODELS.find(m => m.id === baseId && !m.isCustom) || Cat.MODELS.find(m => (m.base || m.id) === String(baseId).replace(/-B$/, '') && !m.isCustom) || Cat.MODELS[0]);

    let peelPct = Math.max(0, Math.min(100, Number(opts.initialPeelPct || 0)));
    const maxH = opts.maxHeight || 'clamp(370px, 56vh, 620px)';
    const linkedTitle = opts.linkedBadgeText || `Custom Stencil ⇄ Bare ${physicalModel.id}`;

    containerEl.innerHTML = `
      <div class="mlrs-peel-wrap">
        <div class="mlrs-peel-bar">
          <button type="button" class="mlrs-peel-btn" data-role="peel-toggle">🩹 Peel Back Stencil</button>
          <input type="range" min="0" max="100" value="${peelPct}" data-role="peel-range" style="width:105px;cursor:pointer;accent-color:#0284c7"/>
          <span data-role="peel-lbl" style="font-weight:700;min-width:110px;text-align:left">Stencil On (0%)</span>
          <span style="color:#0284c7;font-weight:700">${linkedTitle}</span>
        </div>
        <div class="mlrs-peel-stack" data-role="peel-stack">
          <div class="mlrs-peel-under" data-role="under-stage"></div>
          <div class="mlrs-peel-over" data-role="over-stage"></div>
          <div class="mlrs-peel-flap" data-role="peel-flap"></div>
          <div class="mlrs-peel-corner-hit" data-role="peel-corner" title="Click corner to peel back custom stencil"></div>
        </div>
      </div>
    `;

    const stackEl = containerEl.querySelector('[data-role="peel-stack"]');
    const underEl = containerEl.querySelector('[data-role="under-stage"]');
    const overEl  = containerEl.querySelector('[data-role="over-stage"]');
    const flapEl  = containerEl.querySelector('[data-role="peel-flap"]');
    const cornerEl = containerEl.querySelector('[data-role="peel-corner"]');
    const btnEl   = containerEl.querySelector('[data-role="peel-toggle"]');
    const rangeEl = containerEl.querySelector('[data-role="peel-range"]');
    const lblEl   = containerEl.querySelector('[data-role="peel-lbl"]');

    const underCtrl = mountInteractiveStage(underEl, {
      model: physicalModel, uid: `${opts.uid || 'peel'}_phys`, maxHeight: maxH,
      facia: null, touchZones: null,
      calibration: opts.physicalCalibration || opts.calibration, activeZone: opts.activeZone ?? 1,
      onZoneChange: (z) => { if (opts.onZoneChange) opts.onZoneChange(z); },
      onScrubPreview: opts.onScrubPreview,
      onAction: (act, val, z, lbl) => { if (opts.onPhysicalAction) opts.onPhysicalAction(act, val, z, lbl); else if (opts.onAction) opts.onAction(act, val, z, lbl); }
    });

    const overCtrl = mountInteractiveStage(overEl, {
      model: overlayModel, uid: `${opts.uid || 'peel'}_cust`, maxHeight: maxH,
      facia: opts.facia || (overlayModel && overlayModel.facia),
      touchZones: opts.touchZones || (overlayModel && overlayModel.touchZones),
      calibration: opts.calibration, activeZone: opts.activeZone ?? 1,
      onZoneChange: (z) => { if (opts.onZoneChange) opts.onZoneChange(z); },
      onScrubPreview: opts.onScrubPreview,
      onAction: (act, val, z, lbl) => { if (opts.onCustomAction) opts.onCustomAction(act, val, z, lbl); else if (opts.onAction) opts.onAction(act, val, z, lbl); }
    });

    function applyPeel(nextPct, isScrub) {
      peelPct = Math.max(0, Math.min(100, Number(nextPct) || 0));
      if (stackEl) stackEl.classList.toggle('scrubbing', Boolean(isScrub));
      const clips = computePeelClipPolygons(peelPct);
      if (overEl) { overEl.style.clipPath = clips.overClip; overEl.style.pointerEvents = peelPct >= 85 ? 'none' : 'auto'; }
      if (flapEl) { flapEl.style.clipPath = clips.flapClip; flapEl.style.opacity = String(clips.flapOpacity); }
      if (rangeEl && Number(rangeEl.value) !== Math.round(peelPct)) rangeEl.value = String(Math.round(peelPct));
      if (btnEl) {
        btnEl.classList.toggle('peeled', peelPct >= 50);
        btnEl.textContent = peelPct >= 85 ? '🩹 Re-Apply Stencil' : (peelPct > 10 ? '🩹 Peel Fully (100%)' : '🩹 Peel Back Stencil');
      }
      if (lblEl) lblEl.textContent = peelPct === 0 ? 'Stencil On (0%)' : (peelPct >= 98 ? `Bare ${physicalModel.id}` : `Peeled ${Math.round(peelPct)}%`);
    }
    const cyclePeel = () => applyPeel(peelPct < 40 ? 52 : (peelPct < 92 ? 100 : 0), false);
    if (btnEl) btnEl.onclick = cyclePeel;
    if (cornerEl) cornerEl.onclick = (e) => { e.stopPropagation(); cyclePeel(); };
    if (rangeEl) { rangeEl.oninput = (e) => applyPeel(e.target.value, true); rangeEl.onchange = (e) => applyPeel(e.target.value, false); }
    applyPeel(peelPct, false);

    return {
      underCtrl, overCtrl,
      setPeel: (p) => applyPeel(p, false),
      pulseAction: (action, zone, isRf, val, sourceLayer) => {
        if (sourceLayer === 'physical') {
          if (underCtrl && underCtrl.pulseAction) underCtrl.pulseAction(action, zone, isRf, val);
          const conv = resolvePhysicalToCustomAction(action, val ?? -1, zone, opts.touchZones || (overlayModel && overlayModel.touchZones), opts.calibration);
          if (overCtrl && overCtrl.pulseAction) overCtrl.pulseAction(conv.converted ? conv.action : action, zone, isRf, conv.converted ? conv.value : val);
        } else {
          if (overCtrl && overCtrl.pulseAction) overCtrl.pulseAction(action, zone, isRf, val);
          const rev = resolveCustomToPhysicalAction(action, val, zone, opts.touchZones || (overlayModel && overlayModel.touchZones), opts.physicalCalibration || opts.calibration);
          if (underCtrl && underCtrl.pulseAction) underCtrl.pulseAction(rev.action, zone, isRf, rev.value);
        }
      }
    };
  }


  function submitPostDownloadForm(actionUrl, safeName, text) {
    let ifr = document.getElementById('mlrs_hidden_dl_iframe');
    if (!ifr) {
      ifr = document.createElement('iframe');
      ifr.id = 'mlrs_hidden_dl_iframe';
      ifr.name = 'mlrs_hidden_dl_iframe';
      ifr.style.display = 'none';
      document.body.appendChild(ifr);
    }
    const form = document.createElement('form');
    form.method = 'POST';
    form.action = actionUrl;
    form.target = 'mlrs_hidden_dl_iframe';
    form.enctype = 'application/x-www-form-urlencoded';
    form.style.display = 'none';
    const fnInput = document.createElement('input');
    fnInput.type = 'hidden'; fnInput.name = 'filename'; fnInput.value = safeName;
    const ctInput = document.createElement('input');
    ctInput.type = 'hidden'; ctInput.name = 'content'; ctInput.value = text;
    form.appendChild(fnInput);
    form.appendChild(ctInput);
    document.body.appendChild(form);
    form.submit();
    setTimeout(() => form.remove(), 5000);
  }

  async function downloadTextFile(filename, content, mimeType, opts) {
    const safeName = String(filename || 'stencil_1to1.svg').replace(/[^a-zA-Z0-9._-]/g, '_');
    const mime = mimeType || 'image/svg+xml';
    const text = String(content || '');
    if (root.__MLRS_STAGE_DOWNLOAD) {
      try {
        const dlUrl = await root.__MLRS_STAGE_DOWNLOAD(safeName, text, mime);
        if (dlUrl) {
          const iframe = document.createElement('iframe');
          iframe.style.display = 'none';
          iframe.src = dlUrl;
          document.body.appendChild(iframe);
          setTimeout(() => iframe.remove(), 60000);
          return true;
        }
      } catch (_) {}
    }
    const postEndpoint = (opts && opts.downloadEndpoint)
      || (opts && opts.hubBase ? `${String(opts.hubBase).replace(/\/+$/, '')}/api/remotes/download` : '/api/remotes/download');
    if (postEndpoint && !root.__MLRS_STAGE_DOWNLOAD) {
      submitPostDownloadForm(postEndpoint, safeName, text);
      return true;
    }
    if (typeof window !== 'undefined' && typeof window.showSaveFilePicker === 'function') {
      try {
        const ext = safeName.endsWith('.json') ? '.json' : '.svg';
        const handle = await window.showSaveFilePicker({
          suggestedName: safeName,
          types: [{ description: ext === '.json' ? 'POD JSON' : '1:1 Vector SVG', accept: { [mime]: [ext] } }]
        });
        const writable = await handle.createWritable();
        await writable.write(text);
        await writable.close();
        return true;
      } catch (err) {
        if (err && err.name === 'AbortError') return false;
      }
    }
    try {
      const b64 = btoa(unescape(encodeURIComponent(text)));
      const a = document.createElement('a');
      a.href = `data:application/octet-stream;base64,${b64}`;
      a.setAttribute('download', safeName);
      a.style.display = 'none';
      document.body.appendChild(a);
      a.click();
      setTimeout(() => a.remove(), 4000);
      return true;
    } catch (_) {
      const blob = new Blob([text], { type: 'application/octet-stream' });
      const bUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = bUrl;
      a.setAttribute('download', safeName);
      document.body.appendChild(a);
      a.click();
      setTimeout(() => { a.remove(); URL.revokeObjectURL(bUrl); }, 120000);
      return true;
    }
  }

  function mountShowcaseTour(containerEl, opts) {
    injectStudioStyles(containerEl);
    if (!containerEl || !opts || !Array.isArray(opts.steps) || !opts.steps.length) return null;
    const scopeRoot = opts.scopeEl || document;
    const storageKey = `mlrs_tour_${opts.tourId || 'default'}`;
    let idx = Number(localStorage.getItem(storageKey + '_idx') || 0);
    if (idx < 0 || idx >= opts.steps.length) idx = 0;
    let hidden = localStorage.getItem(storageKey + '_hide') === '1';

    function clearHighlights() {
      scopeRoot.querySelectorAll('.mlrs-tour-focus').forEach(el => el.classList.remove('mlrs-tour-focus'));
    }

    function applyHighlight(step) {
      clearHighlights();
      if (hidden || !step || !step.targetSelector) return;
      const target = scopeRoot.querySelector(step.targetSelector);
      if (target) {
        target.classList.add('mlrs-tour-focus');
        if (opts.autoScroll !== false && typeof target.scrollIntoView === 'function') {
          try { target.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); } catch (_) {}
        }
      }
    }

    function render(skipScroll) {
      if (hidden) {
        clearHighlights();
        containerEl.innerHTML = `<div style="display:flex;justify-content:flex-end;margin-bottom:8px"><button type="button" class="mlrs-tour-reopen" data-tour="open">🧭 Guided Build Path (${opts.steps.length} Steps: Bare Remote → Device-Linked Stencil)</button></div>`;
        const ob = containerEl.querySelector('[data-tour="open"]');
        if (ob) ob.onclick = () => { hidden = false; localStorage.setItem(storageKey + '_hide', '0'); render(); };
        return;
      }
      const step = opts.steps[idx];
      const hasValidator = typeof step.isComplete === 'function';
      const done = hasValidator ? Boolean(step.isComplete()) : false;
      const dotsHtml = opts.steps.map((st, di) => {
        const stDone = typeof st.isComplete === 'function' && st.isComplete();
        return `<span class="mlrs-tour-dot ${di === idx ? 'on' : ''}" style="${stDone && di !== idx ? 'background:#10b981;opacity:0.85' : ''}"></span>`;
      }).join('');

      const statusBadge = hasValidator
        ? (done
            ? `<span class="mlrs-tour-done-badge">✅ Step Validated — Click Next ▶</span>`
            : `<span class="mlrs-tour-pending-badge">🎯 Highlighted Area Active: ${step.hintShort || 'Complete highlighted control'}</span>`)
        : '';

      containerEl.innerHTML = `
        <div class="mlrs-tour-bar" style="${done ? 'border-color:#86efac;background:linear-gradient(90deg,rgba(220,252,231,0.45),var(--mlrs-bg))' : ''}">
          <div style="display:flex;align-items:flex-start;gap:10px;min-width:0;flex:1">
            <span style="font-size:18px;line-height:1;margin-top:2px">${done ? '✅' : '🧭'}</span>
            <div style="min-width:0;flex:1">
              <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:2px">
                <span style="font-size:10.5px;font-weight:800;text-transform:uppercase;letter-spacing:0.5px;color:var(--mlrs-primary)">GUIDED PATH ${idx + 1} OF ${opts.steps.length}</span>
                <span style="font-size:12.5px;font-weight:700;color:var(--mlrs-fg)">${step.title}</span>
                <span style="display:inline-flex;gap:4px;align-items:center">${dotsHtml}</span>
                ${statusBadge}
              </div>
              <div style="font-size:11.5px;color:var(--mlrs-muted-fg);line-height:1.38">${step.body}</div>
            </div>
          </div>
          <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;flex-shrink:0">
            <button type="button" class="mlrs-btn" data-tour="prev" style="padding:4px 9px;font-size:11.5px">◀ Prev</button>
            ${step.actionLabel ? `<button type="button" class="mlrs-btn ${done ? '' : 'primary'}" data-tour="act" style="padding:4px 10px;font-size:11.5px">${step.actionLabel}</button>` : ''}
            <button type="button" class="mlrs-btn ${done ? 'primary' : ''}" data-tour="next" style="padding:4px 10px;font-size:11.5px">${idx === opts.steps.length - 1 ? 'Finish ✓' : 'Next ▶'}</button>
            <button type="button" class="mlrs-btn" data-tour="hide" style="padding:4px 8px;font-size:11.5px">✕ Hide</button>
          </div>
        </div>`;

      if (!skipScroll) applyHighlight(step);
      else {
        clearHighlights();
        const t = step.targetSelector ? scopeRoot.querySelector(step.targetSelector) : null;
        if (t) t.classList.add('mlrs-tour-focus');
      }

      containerEl.querySelector('[data-tour="prev"]').onclick = () => {
        idx = (idx - 1 + opts.steps.length) % opts.steps.length;
        localStorage.setItem(storageKey + '_idx', String(idx));
        if (opts.steps[idx].onEnter) opts.steps[idx].onEnter();
        render();
      };
      containerEl.querySelector('[data-tour="next"]').onclick = () => {
        if (idx === opts.steps.length - 1) {
          hidden = true;
          localStorage.setItem(storageKey + '_hide', '1');
          render();
          return;
        }
        idx = (idx + 1) % opts.steps.length;
        localStorage.setItem(storageKey + '_idx', String(idx));
        if (opts.steps[idx].onEnter) opts.steps[idx].onEnter();
        render();
      };
      containerEl.querySelector('[data-tour="hide"]').onclick = () => {
        hidden = true;
        localStorage.setItem(storageKey + '_hide', '1');
        render();
      };
      const actBtn = containerEl.querySelector('[data-tour="act"]');
      if (actBtn && typeof step.onAction === 'function') {
        actBtn.onclick = () => { step.onAction(); };
      }
    }

    render();
    return { refresh: () => render(true), clearHighlights };
  }

  // ============================================================================
  // 4. SMART DEVICE-TO-REMOTE RECOMMENDER & AUTO-BUILDER WIZARD
  // ============================================================================
  function inferDeviceProfile(dev) {
    const dom = String(dev.domain || 'light').toLowerCase();
    const nm = String(dev.name || dev.entity_id || 'Device').trim();
    const low = nm.toLowerCase();
    // Pick best icon + preferred interaction style ('slider' | 'multistep' | 'button')
    if (dom === 'cover' || /blind|shade|shutter|roller|awning/.test(low)) {
      const isCurt = /curtain|drape|sheer/.test(low);
      return { kind: 'slider', icon: isCurt ? 'curtains' : 'blinds', iconEnd: 'sun', sMin: isCurt ? 0 : 100, sMax: isCurt ? 100 : 0, arrows: 'chevron', badge: 'Slider (100\u21920%)' };
    }
    if (dom === 'fan' || /\bfan\b|ventil|exhaust/.test(low)) {
      return { kind: 'multistep', icon: /exhaust|vent/.test(low) ? 'extractor' : 'fan', steps: 6, unit: 'Spd', badge: 'Step 1\u20136 + Hold' };
    }
    if (dom === 'climate' || /\bac\b|aircon|split|climate|heat|hvac/.test(low)) {
      return { kind: 'multistep', icon: /heat|towel/.test(low) ? 'heater' : 'ac', steps: 5, unit: 'Temp', badge: 'Step 1\u20135 + Hold' };
    }
    if (dom === 'media_player' || /sonos|speaker|tv|cinema|audio|amp/.test(low)) {
      const isTv = /\btv\b|cinema|projector/.test(low);
      return isTv
        ? { kind: 'button', icon: 'tv', badge: 'Tap Toggle' }
        : { kind: 'slider', icon: 'speaker', iconEnd: 'music', sMin: 0, sMax: 80, arrows: 'dots', badge: 'Vol Slider (0\u219280%)' };
    }
    if (dom === 'scene' || dom === 'script') {
      return { kind: 'button', icon: /night|sleep/.test(low) ? 'moon' : (/morning|coffee/.test(low) ? 'coffee' : 'sparkles'), badge: 'Scene Tap' };
    }
    if (dom === 'light') {
      const ic = /strip|cove|led/.test(low) ? 'strip' : (/pendant|chandelier/.test(low) ? 'pendant' : (/lamp|bed/.test(low) ? 'lamp' : (/downlight|spot/.test(low) ? 'downlight' : 'bulb')));
      const dimmable = dev.dimmable !== false;
      return dimmable
        ? { kind: 'slider_or_zone', icon: ic, iconEnd: 'sun', sMin: 5, sMax: 100, arrows: 'dots', badge: 'Dimmer / Zone' }
        : { kind: 'button', icon: ic, badge: 'Light Toggle' };
    }
    const roomIco = /garag/.test(low) ? 'garage' : (/garden|patio|lawn/.test(low) ? 'garden' : (/lock|away/.test(low) ? 'lock' : 'power'));
    return { kind: 'button', icon: roomIco, badge: 'Tap Toggle' };
  }

  function cleanShortLabel(rawName) {
    return String(rawName || 'Device')
      .replace(/^\[Virtual\]\s*/i, '')
      .replace(/^MiBoxer 3D Smart Home Twin\s*/i, '')
      .replace(/\b(Z\d+|Light|Switch|Cover|Entity|Smart)\b/gi, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 11) || 'Device';
  }

  function synthesizeRemoteForDevices(modelId, selectedDevs) {
    const Cat = root.MiBoxerCatalog;
    const baseModel = Cat.MODELS.find(m => m.id === modelId && !m.isCustom) || Cat.MODELS[0];
    const bp = Cat.getPanelBlueprint(baseModel);
    const dims = Cat.getPhysicalDims(baseModel);
    const tz = normalizeTouchZones(null);
    const pads = {};
    const bindings = [];

    const sliders = [];
    const stepsAndBtns = [];
    selectedDevs.forEach(d => {
      const prof = Object.assign({}, inferDeviceProfile(d), d.overrideKind ? { kind: d.overrideKind } : {});
      const item = { dev: d, prof, shortLbl: cleanShortLabel(d.name) };
      if (prof.kind === 'slider') sliders.push(item);
      else if (prof.kind === 'slider_or_zone') {
        // Put up to 3 primary dimmable lights onto sliders if space allows, rest onto zone rockers/buttons
        if (sliders.length < 3 && selectedDevs.length <= 8) sliders.push(Object.assign({}, item, { prof: Object.assign({}, prof, { kind: 'slider' }) }));
        else stepsAndBtns.push(item);
      } else {
        stepsAndBtns.push(item);
      }
    });

    // Discover physical surfaces on this candidate model
    const ringSlot = bp.slots.find(s => s.surf === 'hue_ring' && s.type === 'ring');
    const hHueSlot = bp.slots.find(s => s.surf === 'hue_ring' && s.type === 'hbar');
    const barSlots = bp.slots.filter(s => s.surf && s.surf !== 'hue_ring');
    const allSegSurfaces = [];
    if (ringSlot) allSegSurfaces.push({ surf: 'hue_ring', pref: 'hue_seg_', maxSlider: 4, maxBtn: 6, isRing: true });
    if (hHueSlot) allSegSurfaces.push({ surf: 'hue_ring', pref: 'hue_seg_', maxSlider: 3, maxBtn: 4, isRing: false });
    barSlots.forEach(bs => {
      const pref = bs.surf.split('_')[0] + '_seg_';
      allSegSurfaces.push({ surf: bs.surf, pref, maxSlider: 2, maxBtn: 4, isRing: false, slotKey: bs.key });
    });

    const discreteSlots = bp.slots.filter(s => !s.surf && s.key !== 'btn_on' && s.key !== 'btn_off');
    const onOffSlots = bp.slots.filter(s => s.key === 'btn_on' || s.key === 'btn_off');

    // Allocate sliders first across unsplit bars (if 1 slider fits a bar cleanly) or segmented rings/bars!
    const sliderQueue = sliders.slice();
    const btnQueue = stepsAndBtns.slice();

    allSegSurfaces.forEach(sf => {
      if (!sliderQueue.length && btnQueue.length <= discreteSlots.length) return;
      if (sliderQueue.length >= 1 && !sf.isRing && sliderQueue.length === 1 && sf.slotKey) {
        // Use full unsplit bar as a sleek dedicated Custom Stencil Slider!
        const it = sliderQueue.shift();
        pads[sf.slotKey] = {
          customTrack: true, segmentMode: 'slider',
          label: it.shortLbl, sublabel: `${it.prof.sMin ?? 0}\u2192${it.prof.sMax ?? 100}%`,
          icon: it.prof.icon, iconEnd: it.prof.iconEnd || 'sun', iconPos: 'both',
          sliderMin: it.prof.sMin ?? 0, sliderMax: it.prof.sMax ?? 100,
          sliderPitch: 2.0, sliderArrows: it.prof.arrows || 'chevron', luminous: true
        };
        bindings.push({ slot: sf.slotKey, gesture: 'slider', entity_id: it.dev.entity_id, label: it.dev.name });
        return;
      }
      // Otherwise segment this ring/bar to hold sliders + overflow step/toggle buttons
      const wantFromSliders = Math.min(sf.maxSlider, sliderQueue.length);
      const overflowBtns = Math.max(0, btnQueue.length - discreteSlots.length);
      const wantTotal = Math.min(sf.maxBtn, Math.max(wantFromSliders > 0 ? Math.max(2, wantFromSliders) : 0, wantFromSliders + Math.min(sf.maxBtn - wantFromSliders, overflowBtns)));
      if (wantTotal >= 2) {
        tz[sf.surf].enabled = true;
        tz[sf.surf].segments = wantTotal;
        if (sf.isRing) tz[sf.surf].offset_deg = wantTotal === 4 ? -45 : -30;
        tz[sf.surf].labels = [];
        for (let i = 0; i < wantTotal; i++) {
          const sKey = `${sf.pref}${i + 1}`;
          const it = sliderQueue.shift() || btnQueue.shift();
          if (!it) {
            pads[sKey] = { style: 'blank' };
            tz[sf.surf].labels.push('');
            continue;
          }
          tz[sf.surf].labels.push(it.shortLbl);
          if (it.prof.kind === 'slider') {
            pads[sKey] = {
              segmentMode: 'slider', label: it.shortLbl,
              sublabel: `${it.prof.sMin ?? 0}\u2192${it.prof.sMax ?? 100}%`,
              icon: it.prof.icon, iconEnd: it.prof.iconEnd || 'sun', iconPos: 'both',
              sliderMin: it.prof.sMin ?? 0, sliderMax: it.prof.sMax ?? 100,
              sliderPitch: 2.1, sliderArrows: it.prof.arrows || 'chevron', luminous: i === 0
            };
            bindings.push({ slot: sKey, gesture: 'slider', entity_id: it.dev.entity_id, label: it.dev.name });
          } else if (it.prof.kind === 'multistep') {
            pads[sKey] = {
              icon: it.prof.icon, iconPos: sf.isRing ? 'left' : 'top', label: it.shortLbl,
              sublabel: `1-${it.prof.steps || 5} \u2022 Hold`,
              multifunc: { enabled: true, steps: it.prof.steps || 5, unit: it.prof.unit || 'Spd' }
            };
            bindings.push({ slot: sKey, gesture: 'single_tap', entity_id: it.dev.entity_id, label: it.dev.name });
          } else {
            pads[sKey] = { icon: it.prof.icon, iconPos: sf.isRing ? 'left' : 'top', label: it.shortLbl };
            bindings.push({ slot: sKey, gesture: 'single_tap', entity_id: it.dev.entity_id, label: it.dev.name });
          }
        }
      }
    });

    // Any remaining slider items degrade gracefully to multi-step pads on discrete buttons
    const remAll = sliderQueue.concat(btnQueue);
    const allBtnTargets = discreteSlots.concat(onOffSlots);
    if (onOffSlots.find(s => s.key === 'btn_on') && remAll.length <= discreteSlots.length) {
      pads.btn_on = { icon: 'power', label: 'All ON', luminous: true };
    }
    if (onOffSlots.find(s => s.key === 'btn_off') && remAll.length <= discreteSlots.length) {
      pads.btn_off = { icon: 'moon', label: 'All OFF' };
    }

    allBtnTargets.forEach(sl => {
      if (pads[sl.key]) return;
      const it = remAll.shift();
      if (!it) {
        // Mask unused extra buttons cleanly so the stencil looks bespoke!
        pads[sl.key] = { style: 'blank' };
        return;
      }
      if (it.prof.kind === 'multistep' || it.prof.kind === 'slider') {
        pads[sl.key] = {
          icon: it.prof.icon, label: it.shortLbl,
          multifunc: { enabled: true, steps: it.prof.steps || 5, unit: it.prof.unit || 'Lvl' }
        };
      } else {
        pads[sl.key] = { icon: it.prof.icon, label: it.shortLbl };
      }
      bindings.push({ slot: sl.key, gesture: 'single_tap', entity_id: it.dev.entity_id, label: it.dev.name });
    });

    const unplacedCount = remAll.length;
    const totalCap = allBtnTargets.length + allSegSurfaces.reduce((acc, s) => acc + s.maxBtn, 0);
    // Score fit quality (0..99)
    let score = 96;
    if (unplacedCount > 0) score -= unplacedCount * 18;
    const ratio = selectedDevs.length / Math.max(1, discreteSlots.length + allSegSurfaces.length * 3);
    if (ratio < 0.32) score -= Math.round((0.32 - ratio) * 45); // Penalize oversized remote for 1-2 devices
    if (sliders.length > 0 && allSegSurfaces.length === 0) score -= 25;
    if (sliders.length >= 3 && baseModel.id === 'B8') score += 5;
    if (selectedDevs.length <= 5 && (baseModel.id === 'B0' || baseModel.id === 'B3' || baseModel.id === 'K6')) score += 4;
    score = Math.max(35, Math.min(99, score));

    const facia = {
      v: 2, enabled: true,
      theme: baseModel.finish === 'black' ? 'matte_black' : 'pure_white',
      fontFamily: 'geometric', fontScale: 100,
      panelTitle: `${selectedDevs.length}-DEVICE SMART PANEL`,
      defaultPadStyle: 'keycap', showLedPinhole: true, hideLogo: true,
      luminous: { enabled: true, border: true, header: true, slots: false },
      pads
    };

    const summaryReason = unplacedCount === 0
      ? `Fits all ${selectedDevs.length} selected device(s) (${sliders.length} variable slider${sliders.length === 1 ? '' : 's'} + ${selectedDevs.length - sliders.length} tap/step pad${selectedDevs.length - sliders.length === 1 ? '' : 's'}) on ${dims.width_mm}\u00d7${dims.height_mm} mm ${dims.form_factor || 'glass'}.`
      : `Places ${selectedDevs.length - unplacedCount} of ${selectedDevs.length} devices (${unplacedCount} overflow \u2014 pick B8 or FUT089 for higher capacity).`;

    return { model: baseModel, dims, score, unplacedCount, totalCap, tz, facia, bindings, summaryReason };
  }

  function openDeviceRecommenderWizard(opts) {
    injectStudioStyles();
    const o = opts || {};
    const Cat = root.MiBoxerCatalog;

    // Seed device list from HA / Homebridge entities (or rich starter catalog if standalone/empty)
    let rawDevs = Array.isArray(o.devices) ? o.devices.slice() : [];
    if (!rawDevs.length) {
      rawDevs = [
        { entity_id: 'cover.living_roller_blinds', name: 'Living Blinds', domain: 'cover' },
        { entity_id: 'cover.sheer_curtains', name: 'Sheer Curtains', domain: 'cover' },
        { entity_id: 'fan.ceiling_fan', name: 'Ceiling Fan', domain: 'fan' },
        { entity_id: 'climate.split_system_ac', name: 'Split AC', domain: 'climate' },
        { entity_id: 'light.lounge_downlights', name: 'Lounge Lights', domain: 'light', dimmable: true },
        { entity_id: 'light.kitchen_island', name: 'Kitchen Pendant', domain: 'light', dimmable: true },
        { entity_id: 'media_player.living_sonos', name: 'Living Sonos', domain: 'media_player' },
        { entity_id: 'scene.movie_night', name: 'Cinema Scene', domain: 'scene' }
      ];
    }

    const selectedMap = new Map();
    // Pre-select up to 5 diverse sample devices on first open so recommendations render live immediately!
    const seenDom = new Set();
    rawDevs.forEach(d => {
      if (selectedMap.size < 5 && !seenDom.has(d.domain)) {
        seenDom.add(d.domain);
        selectedMap.set(d.entity_id, Object.assign({}, d));
      }
    });
    if (selectedMap.size < 3) {
      rawDevs.slice(0, 4).forEach(d => selectedMap.set(d.entity_id, Object.assign({}, d)));
    }

    let filterDom = 'all';
    let searchTxt = '';
    const candidateModelIds = ['B8', 'B0', 'B4', 'B3', 'U3', 'M4', 'K6', 'FUT089'];

    const backdrop = document.createElement('div');
    backdrop.className = 'mlrs-modal-backdrop' + (isHostDark() ? ' mlrs-dark' : '');

    function renderWiz() {
      const selArr = Array.from(selectedMap.values());
      const recs = candidateModelIds
        .map(mid => synthesizeRemoteForDevices(mid, selArr))
        .sort((a, b) => b.score - a.score)
        .slice(0, 3);

      const domains = ['all', ...Array.from(new Set(rawDevs.map(d => d.domain)))];
      const filteredDevs = rawDevs.filter(d => {
        if (filterDom !== 'all' && d.domain !== filterDom) return false;
        if (searchTxt && !`${d.name} ${d.entity_id} ${d.domain}`.toLowerCase().includes(searchTxt.toLowerCase())) return false;
        return true;
      });

      backdrop.innerHTML = `
        <div class="mlrs-modal" style="max-width:1440px;height:90vh" onclick="event.stopPropagation()">
          <div class="mlrs-topbar">
            <div>
              <div style="font-size:16px;font-weight:800">\uD83E\uDE84 Smart Device-to-Remote Recommender &amp; Auto-Builder</div>
              <div style="font-size:12px;color:var(--mlrs-muted-fg);margin-top:2px">Tick the Home Assistant / Homebridge devices you want on one remote \u2014 we rank the best-fit MiBoxer hardware &amp; pre-build your custom stencil!</div>
            </div>
            <button type="button" class="mlrs-btn" id="mlrsWizClose">\u2715 Close</button>
          </div>

          <div style="display:grid;grid-template-columns:minmax(330px, 410px) 1fr;flex:1;min-height:0;overflow:hidden">
            <!-- LEFT: Device Picker & Custom Slot Adder -->
            <div class="mlrs-col" style="display:flex;flex-direction:column;gap:8px">
              <div class="mlrs-sec-title" style="margin:0">1. Select Devices to Put on One Remote (${selArr.length} chosen)</div>
              <div style="display:flex;gap:6px">
                <input type="text" class="mlrs-input" id="mlrsWizSearch" placeholder="Search lights, blinds, fans, AC, Sonos\u2026" value="${searchTxt.replace(/"/g, '&quot;')}"/>
                <button type="button" class="mlrs-btn" id="mlrsWizClearSel" style="white-space:nowrap;padding:4px 8px;font-size:11px">Clear</button>
              </div>
              <div style="display:flex;gap:4px;flex-wrap:wrap">
                ${domains.map(dm => `<button type="button" class="mlrs-btn ${filterDom === dm ? 'active-tab' : ''}" data-wiz-dom="${dm}" style="padding:3px 8px;font-size:11px;text-transform:capitalize">${dm === 'all' ? 'All (' + rawDevs.length + ')' : dm}</button>`).join('')}
              </div>

              <div style="flex:1;min-height:160px;overflow-y:auto;border:1px solid var(--mlrs-border);border-radius:8px;padding:6px;background:var(--mlrs-muted)">
                ${filteredDevs.slice(0, 80).map(d => {
                  const checked = selectedMap.has(d.entity_id);
                  const chosenObj = selectedMap.get(d.entity_id) || d;
                  const prof = inferDeviceProfile(chosenObj);
                  const effKind = chosenObj.overrideKind || (prof.kind === 'slider_or_zone' ? 'slider' : prof.kind);
                  return `<div style="display:flex;align-items:center;justify-content:space-between;gap:6px;padding:6px 7px;margin-bottom:4px;border-radius:6px;background:var(--mlrs-bg);border:1px solid ${checked ? '#0284c7' : 'var(--mlrs-border)'}">
                    <label style="display:flex;align-items:center;gap:7px;cursor:pointer;min-width:0;flex:1;margin:0">
                      <input type="checkbox" data-wiz-chk="${d.entity_id.replace(/"/g, '&quot;')}" ${checked ? 'checked' : ''}/>
                      <span style="min-width:0;flex:1">
                        <span style="display:block;font-size:12px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${d.name}</span>
                        <span style="display:block;font-size:10px;color:var(--mlrs-muted-fg)">${d.domain} \u2022 ${d.entity_id}</span>
                      </span>
                    </label>
                    ${checked ? `
                      <select class="mlrs-select" data-wiz-kind="${d.entity_id.replace(/"/g, '&quot;')}" style="width:108px;padding:2px 5px;font-size:10.5px">
                        <option value="slider" ${effKind === 'slider' ? 'selected' : ''}>\uD83C\uDF9A\uFE0F Slider</option>
                        <option value="multistep" ${effKind === 'multistep' ? 'selected' : ''}>\uD83D\uDD22 Step Cycle</option>
                        <option value="button" ${effKind === 'button' ? 'selected' : ''}>\uD83D\uDD18 Tap Button</option>
                      </select>
                    ` : `<span style="font-size:10px;color:var(--mlrs-muted-fg);white-space:nowrap">${prof.badge}</span>`}
                  </div>`;
                }).join('')}
              </div>

              <div class="mlrs-box-sub" style="margin:0">
                <div style="font-size:11px;font-weight:700;margin-bottom:4px">Planning ahead? Add a custom device slot:</div>
                <div style="display:flex;gap:5px">
                  <input type="text" class="mlrs-input" id="mlrsWizCustomName" placeholder="e.g. Patio Pergola Louvres" style="padding:4px 7px;font-size:11.5px"/>
                  <select class="mlrs-select" id="mlrsWizCustomDom" style="width:98px;padding:4px 5px;font-size:11px">
                    <option value="cover">Blinds</option>
                    <option value="light">Light</option>
                    <option value="fan">Fan</option>
                    <option value="climate">AC</option>
                    <option value="media_player">Audio</option>
                    <option value="scene">Scene</option>
                  </select>
                  <button type="button" class="mlrs-btn primary" id="mlrsWizAddCustom" style="padding:4px 9px;font-size:11.5px">+ Add</button>
                </div>
              </div>
            </div>

            <!-- RIGHT: Top 3 Ranked MiBoxer Remotes + Live Pre-Configured Stencil Previews -->
            <div style="padding:14px 18px;overflow-y:auto;background:var(--mlrs-muted)">
              <div class="mlrs-sec-title">2. Best-Fit MiBoxer Remotes &amp; Auto-Built Stencil Layouts (Click to Use or Edit)</div>
              ${selArr.length === 0 ? `<div class="mlrs-box-sub" style="background:var(--mlrs-bg);padding:24px;text-align:center">Tick one or more devices on the left to generate ranked hardware &amp; stencil recommendations!</div>` : `
                <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(290px, 1fr));gap:12px">
                  ${recs.map((rc, rIdx) => {
                    const svgHtml = Cat.renderCapacitiveStencilSvg(rc.model, {
                      size: 'large', uid: `wiz_rec_${rIdx}`, facia: rc.facia, touchZones: rc.tz, activeZone: 1
                    });
                    return `<div style="background:var(--mlrs-bg);border:${rIdx === 0 ? '2px solid #0284c7' : '1px solid var(--mlrs-border)'};border-radius:12px;padding:12px 14px;display:flex;flex-direction:column;justify-content:space-between;box-shadow:0 3px 10px rgba(15,23,42,0.05)">
                      <div>
                        <div style="display:flex;align-items:center;justify-content:space-between;gap:6px;margin-bottom:4px">
                          <span style="font-size:13.5px;font-weight:800">${rIdx === 0 ? '\uD83C\uDFC6 #1 Best Match: ' : '#' + (rIdx + 1) + ' '}MiBoxer ${rc.model.id}</span>
                          <span style="padding:2px 8px;border-radius:999px;font-size:11px;font-weight:800;background:${rIdx === 0 ? '#dcfce7' : '#e0f2fe'};color:${rIdx === 0 ? '#166534' : '#0369a1'}">${rc.score}% Fit</span>
                        </div>
                        <div style="font-size:11px;color:var(--mlrs-muted-fg);margin-bottom:8px;line-height:1.38">${rc.summaryReason}</div>
                        <div style="display:flex;align-items:center;justify-content:center;background:var(--mlrs-muted);border:1px solid var(--mlrs-border);border-radius:9px;padding:10px;height:275px;overflow:hidden">
                          <div style="height:100%;display:flex;align-items:center;justify-content:center">${svgHtml.replace(/<svg /, '<svg style="max-height:252px;width:auto;max-width:100%" ')}</div>
                        </div>
                        <div style="margin-top:8px;font-size:10.5px;color:var(--mlrs-muted-fg)">
                          <b>Auto-mapped (${rc.bindings.length}):</b> ${rc.bindings.slice(0, 6).map(b => `<code style="background:var(--mlrs-muted);padding:1px 4px;border-radius:3px">${b.slot}\u2192${cleanShortLabel(b.label)}</code>`).join(' ')}${rc.bindings.length > 6 ? ` +${rc.bindings.length - 6} more` : ''}
                        </div>
                      </div>
                      <div style="display:flex;gap:6px;margin-top:10px;flex-wrap:wrap">
                        <button type="button" class="mlrs-btn primary" data-wiz-edit="${rIdx}" style="flex:1;justify-content:center;font-size:11.5px">\uD83C\uDFA8 Open &amp; Edit in Stencil Studio</button>
                        <button type="button" class="mlrs-btn" data-wiz-apply="${rIdx}" style="justify-content:center;font-size:11.5px;border-color:#059669;color:#059669;font-weight:700">\u2705 Use As-Is</button>
                      </div>
                    </div>`;
                  }).join('')}
                </div>
              `}
            </div>
          </div>
        </div>`;

      backdrop.querySelector('#mlrsWizClose').onclick = () => backdrop.remove();
      const sInp = backdrop.querySelector('#mlrsWizSearch');
      if (sInp) {
        sInp.oninput = (e) => { searchTxt = e.target.value; renderWiz(); const el2 = backdrop.querySelector('#mlrsWizSearch'); if (el2) { el2.focus(); el2.setSelectionRange(searchTxt.length, searchTxt.length); } };
      }
      backdrop.querySelector('#mlrsWizClearSel').onclick = () => { selectedMap.clear(); renderWiz(); };
      backdrop.querySelectorAll('[data-wiz-dom]').forEach(b => {
        b.onclick = () => { filterDom = b.getAttribute('data-wiz-dom'); renderWiz(); };
      });
      backdrop.querySelectorAll('[data-wiz-chk]').forEach(chk => {
        chk.onchange = () => {
          const eid = chk.getAttribute('data-wiz-chk');
          const dObj = rawDevs.find(x => x.entity_id === eid);
          if (chk.checked && dObj) selectedMap.set(eid, Object.assign({}, dObj));
          else selectedMap.delete(eid);
          renderWiz();
        };
      });
      backdrop.querySelectorAll('[data-wiz-kind]').forEach(sel => {
        sel.onchange = () => {
          const eid = sel.getAttribute('data-wiz-kind');
          const cur = selectedMap.get(eid);
          if (cur) { cur.overrideKind = sel.value; renderWiz(); }
        };
      });
      backdrop.querySelector('#mlrsWizAddCustom').onclick = () => {
        const nm = (backdrop.querySelector('#mlrsWizCustomName').value || '').trim();
        const dm = backdrop.querySelector('#mlrsWizCustomDom').value || 'light';
        if (!nm) return;
        const eid = `${dm}.custom_${nm.toLowerCase().replace(/[^a-z0-9]+/g, '_')}`;
        const newDev = { entity_id: eid, name: nm, domain: dm, dimmable: true };
        rawDevs.unshift(newDev);
        selectedMap.set(eid, newDev);
        renderWiz();
      };

      // Action 1: Open in Stencil Studio to fine-tune (background photo, glow, labels)
      backdrop.querySelectorAll('[data-wiz-edit]').forEach(btn => {
        btn.onclick = () => {
          const rc = recs[Number(btn.getAttribute('data-wiz-edit'))];
          if (!rc) return;
          backdrop.remove();
          openFaciaDesigner({
            model: rc.model,
            hexId: o.hexId || '',
            remoteName: `${rc.model.id} ${selArr.length}-Device Custom`,
            facia: rc.facia,
            touchZones: rc.tz,
            hubUrl: o.hubUrl || '',
            bindRemoteByDefault: Boolean(o.hexId),
            onSaveCustomModel: async (saveRes) => {
              saveRes.customModel.suggested_bindings = rc.bindings;
              if (typeof o.onSaveCustomModel === 'function') await o.onSaveCustomModel(saveRes, rc.bindings);
            }
          });
        };
      });

      // Action 2: Use As-Is right away!
      backdrop.querySelectorAll('[data-wiz-apply]').forEach(btn => {
        btn.onclick = async () => {
          const rc = recs[Number(btn.getAttribute('data-wiz-apply'))];
          if (!rc) return;
          const cleanName = `${rc.model.id} ${selArr.length}-Device Smart Panel`;
          const targetId = slugifyCustomId(rc.model.id, cleanName);
          const payload = {
            id: targetId,
            name: cleanName,
            base_model: rc.model.id,
            stencil_mode: 'full_panel',
            facia: rc.facia,
            touch_zones: rc.tz,
            suggested_bindings: rc.bindings
          };
          if (Cat.upsertCustomModel) Cat.upsertCustomModel(payload);
          if (typeof o.onSaveCustomModel === 'function') {
            await o.onSaveCustomModel({ customModel: payload, bindNow: Boolean(o.hexId), calibration: defaultCalibration(), touchZones: rc.tz, facia: rc.facia }, rc.bindings);
          }
          backdrop.remove();
        };
      });
    }

    document.body.appendChild(backdrop);
    renderWiz();
    return backdrop;
  }

  function mountWorkflowLauncher(containerEl, handlers) {
    injectStudioStyles(containerEl);
    if (!containerEl) return null;
    const h = handlers || {};
    const storeKey = `mlrs_wf_launcher_${h.launcherId || 'main'}_collapsed`;
    let collapsed = localStorage.getItem(storeKey) === '1';

    const wipCount = loadWipDrafts().length;
    const items = [
      {
        id: 'recommender',
        icon: '\uD83E\uDE84',
        title: 'Recommend Remote for My Devices',
        desc: 'Pick your lights, blinds, fans & AC \u2014 auto-ranks the best MiBoxer remotes & builds the stencil!',
        run: () => h.onOpenRecommender ? h.onOpenRecommender() : openDeviceRecommenderWizard({})
      },
      {
        id: 'bare',
        icon: '\uD83E\uDDFC',
        title: 'Build Remote from Bare Glass',
        desc: 'Validated 6-step walkthrough: add custom background artwork, X\u2013Y% sliders & dual icons.',
        run: () => h.onOpenStencil && h.onOpenStencil('bare_walkthrough')
      },
      {
        id: 'template_or_wip',
        icon: wipCount > 0 ? '\uD83D\uDCC2' : '\u2728',
        title: wipCount > 0 ? `Resume WIP Draft (${wipCount}) or Template` : 'Create from Starter Template',
        desc: wipCount > 0 ? `Jump right back into your saved work-in-progress stencil draft (or pick a template).` : 'Start from a Hybrid Arc + Bar Slider or Room Rocker template and customise labels & glow.',
        run: () => h.onOpenStencil && h.onOpenStencil(wipCount > 0 ? 'resume_draft' : 'template_edit')
      },
      {
        id: 'mapper',
        icon: '\uD83C\uDF9B\uFE0F',
        title: 'Map Buttons & Sliders to Devices',
        desc: 'Bind 1\u00d7 Tap, 2\u00d7 Double, Long Hold & variable slider ranges to HA / Homebridge entities.',
        run: () => h.onFocusMapper && h.onFocusMapper()
      },
      {
        id: 'showcase',
        icon: '\uD83E\uDDED',
        title: 'Guided Studio Showcase',
        desc: 'Interactive tour of live 2.4 GHz RF reticles, Peel-Back Stencil X-Ray & Dark-Room Glow.',
        run: () => h.onStartShowcase && h.onStartShowcase()
      },
      {
        id: 'export_pod',
        icon: '\uD83D\uDDA8\uFE0F',
        title: '1:1 Print Sheet & Luminous POD',
        desc: 'Generate a calibrated 1:1 mm cut sheet (with background graphic), SVG, or POD JSON.',
        run: () => h.onOpenStencil && h.onOpenStencil('export_pod')
      }
    ];

    function render() {
      if (collapsed) {
        containerEl.innerHTML = `
          <div style="display:flex;align-items:center;justify-content:space-between;background:var(--mlrs-bg,#fff);border:1px solid var(--mlrs-border,#e2e8f0);border-radius:8px;padding:6px 12px;margin-bottom:8px;font-size:12px">
            <span style="font-weight:700;color:var(--mlrs-fg,#0f172a)">\ud83e\udded What would you like to do today? <span style="font-weight:500;color:var(--mlrs-muted-fg,#64748b)">(Bare Build Walkthrough, Templates, Device Mapping, POD Export)</span></span>
            <button type="button" class="mlrs-tour-btn demo" data-wf-toggle="open" style="padding:3px 10px !important;font-size:11.5px !important">Show 6 Workflows \u25be</button>
          </div>`;
        const btn = containerEl.querySelector('[data-wf-toggle="open"]');
        if (btn) btn.onclick = () => { collapsed = false; localStorage.setItem(storeKey, '0'); render(); };
        return;
      }

      containerEl.innerHTML = `
        <div class="mlrs-launcher-card">
          <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap">
            <div>
              <span style="font-size:13.5px;font-weight:800;color:var(--mlrs-fg,#0f172a)">\ud83d\udc4b What would you like to do today?</span>
              <span style="font-size:11.5px;color:var(--mlrs-muted-fg,#64748b);margin-left:6px">Pick a guided workflow below to jump straight in:</span>
            </div>
            <button type="button" class="mlrs-tour-btn" data-wf-toggle="close" style="padding:3px 9px !important;font-size:11px !important">Hide Options \u25b4</button>
          </div>
          <div class="mlrs-launcher-grid">
            ${items.map(it => `
              <button type="button" class="mlrs-wf-item" data-wf-id="${it.id}">
                <span class="mlrs-wf-ico">${it.icon}</span>
                <span style="min-width:0;flex:1">
                  <span style="display:block;font-size:12px;font-weight:700;color:var(--mlrs-fg,#0f172a);margin-bottom:2px">${it.title}</span>
                  <span style="display:block;font-size:11px;color:var(--mlrs-muted-fg,#64748b);line-height:1.34">${it.desc}</span>
                </span>
              </button>
            `).join('')}
          </div>
        </div>`;

      const closeBtn = containerEl.querySelector('[data-wf-toggle="close"]');
      if (closeBtn) closeBtn.onclick = () => { collapsed = true; localStorage.setItem(storeKey, '1'); render(); };
      containerEl.querySelectorAll('[data-wf-id]').forEach(el => {
        el.onclick = () => {
          const found = items.find(x => x.id === el.getAttribute('data-wf-id'));
          if (found && found.run) found.run();
        };
      });
    }

    render();
    return { expand: () => { collapsed = false; localStorage.setItem(storeKey, '0'); render(); } };
  }

  root.MiLightRemoteStudio = {
    version: '2.5.0',
    normalizeTouchZones, defaultCalibration, resolvePhysicalToCustomAction, resolveCustomToPhysicalAction, mountInteractiveStage, mountPeelableStage, downloadTextFile, mountShowcaseTour, mountWorkflowLauncher,
    buildPodOrderPayload, buildOneToOnePrintSvg, openPrintSheetWindow, openFaciaDesigner, openDeviceRecommenderWizard, loadWipDrafts
  };
})(typeof window !== 'undefined' ? window : globalThis);
