# Everyday Household Guide: Mi-Light Remote for Homebridge & Apple Home

A plain-English guide to pairing physical Mi-Light / MiBoxer remotes and wall panels with Homebridge and Apple Home so household members can use simple physical buttons instead of pulling out an iPhone or speaking to Siri.

## Why Physical Remotes Complement Apple Home
* **Zero phone or voice friction:** A physical button or wall panel is always right where you expect it—great for quick room lights, blinds, fans, or scenes.
* **Practice safely first:** Test button behavior and timing in the virtual preview/simulator before wiring real household accessories.
* **Child lock safety:** Respects Hub child-lock state so idle remotes don't accidentally fire HomeKit scenes until the 3-tap unlock sequence is entered.

## Setup & Linking Steps
1. Install **homebridge-milight-remote** in Homebridge and open its settings UI.
2. Enter your Mi-Light Hub / MQTT connection details and save.
3. Pair your remote on the Hub (using the 3-tap verification flow) and map remote buttons or zones to Homebridge / Apple Home accessories or scenes.
4. Test single tap, hold, and multi-tap actions, and apply a single stick-on stencil (on flat wall panels or round touch pucks) with clear labels so anyone in the house knows what each button does at a glance.

---

## Printable 1-Page Household Button Cheat Sheet

Print this section at **100% actual scale** (A4 or Letter) and keep it handy for family, guests, and anyone who prefers simple physical buttons over a phone or voice assistant.

| Remote / Panel | Room / Area | Single Tap | Long Hold | Multi-Tap (2x / 3x) | Unlock Code (if Child Locked) |
| :--- | :--- | :--- | :--- | :--- | :--- |
| *Main Remote* | *Living / Kitchen* | *Lights ON / OFF* | *Hold OFF = All Off* | *2x = Relax / 3x = Bright* | *ON -> OFF -> ON* |
| *Wall Panel* | *Hallway / Entry* | *Zone / Switch toggle* | *Hold = Night / Off* | *2x = Scene* | *1 -> 2 -> 3 or ON -> OFF -> ON* |
| *Touch Puck* | *Bedroom / Study* | *Power / Dim / CCT* | *Hold = Sleep / Off* | *Optional shortcut* | *ON -> OFF -> ON* |

### Quick Notes
* **Single Stick-On Stencils:** Fit the **30 flat glass wall panels and flat circular touch pucks** (verify the **10 mm x 10 mm** scale box at 100% print scale); knobs, LCDs, rockers, and physical pushbuttons are held for individual cut stickers later.
* **Child Lock:** Prevents accidental triggers after idle time until the 3-tap unlock sequence is entered.
