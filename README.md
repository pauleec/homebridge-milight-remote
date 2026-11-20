# homebridge-milight-remote

Companion Homebridge platform plugin for the **Dual-Radio ESP32 `esp8266_milight_hub` Remote Studio**. Auto-discovers physical Futlight / MiBoxer 2.4GHz handheld remotes and capacitive glass wall panels via MQTT, turning stateless RF remotes into stateful controllers for both virtual 3D and real-world smart home devices.

## Highlights
- **Zero-Config Auto-Discovery:** Subscribes to `milight/remotes_registry/#` and renders interactive 1:1 vector SVG faceplates (all 61 MiBoxer White & Black models) inside Homebridge UI.
- **Dual-Color Live Telemetry:** Distinguishes physical 2.4GHz RF presses (**Emerald Green**) from virtual plugin clicks (**Amber**).
- **Interactive 3D Cutaway Smart Home Sandbox:** Built-in Three.js cutaway home (embedded in Homebridge UI and standalone fullscreen on `:8588`) demonstrating curtains, blinds, split AC, ceiling fan, hydronic radiator, sectional garage door, sliding gate, lawn sprinklers, and `S+`/`S-` multi-function driveway bollard toggles—with physical `24%–100%` capacitive slider travel normalized cleanly to `0%–100%`.
- **Real-World Button -> Action Mapper:** One-click **"Learn Physical Remote Button"** binds any remote zone, button, color wheel, or slider directly to Homebridge HAP accessories, custom MQTT payloads, HTTP webhooks, or Home Assistant event triggers.
