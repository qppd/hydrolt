<div align="center">

# HYDROLYT / HydroLT

**IoT-Based Vertical Hydroponic System for Sustainable Off-Season Cultivation of *Cucumis melo* (Melon)**

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Next.js](https://img.shields.io/badge/Next.js-15-black?logo=next.js&logoColor=white)](https://nextjs.org/)
[![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=black)](https://react.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Firebase](https://img.shields.io/badge/Firebase-RTDB%20%2B%20Auth-FFCA28?logo=firebase&logoColor=black)](https://firebase.google.com/)
[![ESP32](https://img.shields.io/badge/ESP32-Arduino%20Framework-000000?logo=espressif&logoColor=white)](https://www.espressif.com/)
[![Arduino CLI](https://img.shields.io/badge/build-arduino--cli-blue)](https://arduino.github.io/arduino-cli/)

One greenhouse (4 × 5 m), two existing vertical hydroponic towers, one ESP32-based IoT
controller, automated nutrient dosing, water-flow management, environmental control,
hybrid solar/grid power, and a web-based monitoring and management system.

[Features](#features) · [Tech Stack](#tech-stack) · [Quick Start](#quick-start) · [Hardware](#hardware--bill-of-materials) · [Project Structure](#project-structure) · [Documentation](#documentation)

</div>

---

## Overview

HydroLT monitors and automates a soilless vertical-farm grow environment end to end: an ESP32
controller reads pH, EC, temperature, humidity, water flow and NPK from connected sensors, runs
local fail-safe automation, and streams telemetry to a Firebase Realtime Database
backend. A Next.js web app provides a real-time dashboard, historical trending, remote
controls and an alerts feed — usable from any browser, on desktop or mobile.

Automation keeps running **without an internet connection** (FR-10); the cloud layer is for
observability and remote override, not for keeping plants alive.

---

## Features

### Sensing & telemetry
- **pH** and **EC** (nutrient strength) with configurable target bands and safety alarms
- **NPK** (nitrogen / phosphorus / potassium) via a dedicated **RS485 Modbus RTU** probe — measured, never derived from pH/EC
- **Air temperature & humidity** (DHT22) with exhaust-fan and misting control
- **Water flow** (pulse sensor) with low-flow pump cutoff
- Telemetry streamed to **Firebase Realtime Database** (`devices/<device>/…`) with live state and device presence

### Automated dosing & control
- **Closed-loop pH/EC dosing** — one channel at a time, hard burst caps, cooldowns
- **Closed-loop NPK dosing** (FR-13) — bounded and interlocked; blocked whenever the probe, pH or EC is invalid, EC is above target, or the solution is not circulating
- **Exhaust fan** (temperature) and **misting** (humidity) automation
- **Irrigation pump** with flow-verified startup and fail-safe low-flow cutoff
- **Manual override** from the web app via RTDB command queue (`devices/<device>/commands`)

### Safety & reliability
- Invalid sensor readings **block dosing** — no uncontrolled nutrient/acid dosing
- Non-blocking, `millis()`-based main loop; watchdog recovery on the main loop
- Local automation continues with **no internet**; cloud is optional
- Security rules on the Firebase Realtime Database; **no secrets or credentials stored in the database**

### Web application
- Real-time **dashboard** with live stat cards and trend charts
- **History** page with time-window filters (6 h / 24 h / 7 d / 30 d) and CSV export
- **Controls** page for setpoints, NPK bands, kill switches and manual dose triggers
- **Alerts** feed with device health and event history
- **Demo mode** — runs with simulated data and no backend, so you can preview instantly
- **Password auth** (Firebase) protecting the dashboard and device controls

---

## Tech Stack

### Web application — `src/webapp/HydroLT`
| Layer | Technology |
|---|---|
| Framework | [Next.js 15](https://nextjs.org/) (App Router) + [React 19](https://react.dev/) |
| Language | [TypeScript 5.7](https://www.typescriptlang.org/) |
| Backend / DB | [Firebase](https://firebase.google.com/) — Realtime Database, Auth, security rules |
| Realtime | RTDB live queries; polling hooks in the client |
| Charts | Custom lightweight `LineChart` component |

### Controller firmware — `src/esp/HydroLT`
| Component | Detail |
|---|---|
| Board | ESP32 Dev Module (Arduino-ESP32 core **3.3.11**) |
| Framework | Arduino framework via `arduino-cli` / Arduino IDE |
| Libraries | `Firebase Arduino Client` (Mobizt) · `DHT sensor library` + `Adafruit Unified Sensor` · `ArduinoJson` 7.4.3 |
| Field bus | RS485 **Modbus RTU** master built into the sketch (no extra library) over UART2 via MAX485 |
| Verified build | `esp32:esp32:esp32` — 1,260,853 B flash (96 %), 53,688 B RAM (16 %) |

---

## Quick Start

### Prerequisites
- **Node.js 18+** and npm
- **arduino-cli** (or Arduino IDE) with the `esp32:esp32` board package — firmware only
- A Firebase project — *optional*; without it the app runs in demo mode

### 1. Web app (`src/webapp/HydroLT`)

```bash
cd src/webapp/HydroLT
npm install
npm run dev
```

Open <http://localhost:3000>.

The dashboard runs in **demo mode with simulated data** when no Firebase environment variables
are set, so you can preview it immediately. To connect a real backend, copy `.env.example` to
`.env.local` and fill in your Firebase project values — see [docs/setup.md](docs/setup.md).

With a real backend, the first-run flow is: **sign up** (or sign in) → **connect** to your
controller by entering its **unique device ID** → dashboard. The device ID is validated against
the `devices/{id}` node and remembered in the browser.

```bash
npm run build     # production build
npm start         # serve the production build
npm run typecheck # tsc --noEmit
```

### 2. ESP32 firmware (`src/esp/HydroLT`)

1. Open `src/esp/HydroLT/HydroLT.ino` in the Arduino IDE (or PlatformIO). The
   sketch is split into modules (`config.h`, `sensors.*`, `npk.*`, `automation.*`,
   `firebase_db.*`, `commands.*`, …) — the IDE compiles them automatically as long
   as the whole folder is kept together.
2. Install the board support **esp32 by Espressif Systems** and the libraries:
   - `Firebase Arduino Client Library for ESP8266 and ESP32` (Mobizt)
   - `DHT sensor library` (Adafruit) + `Adafruit Unified Sensor`
   - `ArduinoJson` (Benoit Blanchon)
   - *(the RS485 NPK probe needs no extra library — a Modbus RTU master is built into the firmware)*
3. Copy `secrets.h.example` to `secrets.h` (git-ignored) and set `HYDRO_WIFI_SSID`,
   `HYDRO_WIFI_PASS`, `HYDRO_FB_API_KEY`, `HYDRO_FB_DB_URL`, `HYDRO_FB_EMAIL`,
   `HYDRO_FB_PASSWORD`, `HYDRO_DEVICE_ID`, plus pin assignments for your actual wiring.
4. Select **ESP32 Dev Module**, compile, upload.
5. Serial monitor at **115200 baud** for boot and diagnostic logs.

Full wiring/setup guidance: [docs/setup.md](docs/setup.md).

---

## Hardware / Bill of Materials

> **Note:** the NPK probe and the three N/P/K dosing pumps are optional. The firmware, database
> and web app already support them, and the system runs fine without the hardware fitted.

| Category | Component | Role |
|---|---|---|
| **Controller** | ESP32 Dev Module | Main controller, Wi-Fi + Firebase RTDB |
| | MAX485 module | RS485 transceiver for the NPK probe |
| **Sensors** | pH sensor + analog module | Nutrient acidity (GPIO 34) |
| | EC sensor + module | Nutrient conductivity / strength (GPIO 35) |
| | DHT22 | Air temperature & humidity (GPIO 4) |
| | Water flow sensor | Irrigation flow (GPIO 27, interrupt) |
| | RS485 NPK probe *(optional)* | N / P / K via Modbus RTU (GPIO 16/17/13) |
| **Actuators** | 5× peristaltic dosing pumps | pH-up, pH-down, N, P, K (GPIO 32/14/18/19/21) |
| | Submersible pump | Irrigation (relay, GPIO 26) |
| | Exhaust fan | Cooling / VPD control (relay, GPIO 25) |
| | Misting pump | Humidity / cooling (relay, GPIO 33) |
| **Power** | Hybrid solar/grid supply | Controller + peripherals |

Full pin map and wiring: [docs/setup.md](docs/setup.md).

---

## Project Structure

```
hydrolyt/
├── README.md                     ← this file
├── LICENSE                       ← MIT
├── docs/                         ← project documentation
│   ├── requirements.md           ← full requirements & acceptance criteria
│   ├── database-schema.md        ← RTDB schema + security rules
│   └── setup.md                  ← firmware & web app setup guide
└── src/
    ├── esp/
    │   └── HydroLT/              ← ESP32 controller firmware (modular Arduino sketch)
    │       ├── HydroLT.ino       ← setup() + loop() entry point
    │       ├── config.h          ← pins, limits, timings, credential macros
    │       ├── sensors.* npk.*   ← pH/EC/climate/flow and RS485 NPK probe
    │       ├── actuators.* automation.*        ← relays and control loops
    │       ├── firebase_db.* commands.* connectivity.*  ← RTDB, commands, session
    │       └── state.* types.h util.* logging.* settings_store.*  ← support modules
    └── webapp/
        └── HydroLT/              ← Next.js + TypeScript web application
            ├── app/              ← App Router pages (dashboard, history, controls, alerts)
            ├── components/       ← reusable UI components
            ├── hooks/            ← telemetry polling hooks
            └── lib/              ← types, Firebase client, mock data
```

---

## Documentation

| Document | Contents |
|---|---|
| [docs/requirements.md](docs/requirements.md) | Functional/hardware requirements, automation logic, scope, 3-week plan, acceptance criteria |
| [docs/database-schema.md](docs/database-schema.md) | RTDB tree layout, security rules, retention, migration notes |
| [docs/setup.md](docs/setup.md) | Environment setup, firmware configuration, RTDB paths, deployment notes |

**RTDB layout:** `devices/<device_id>/` → `info`, `status`, `telemetry`, `history`, `state`, `settings`, `commands`, `acks`, `alerts`, `events` — plus `users/<uid>` for roles.

---

## Screenshots

<!-- TODO: add dashboard / history / controls screenshots once deployed.
     Drop the images in docs/assets/ and replace the paths below. -->

| Dashboard | Controls |
|---|---|
| ![Dashboard](docs/assets/dashboard.png) | ![Controls](docs/assets/controls.png) |

---

## Contributing

Contributions are welcome. This project is under active development for a client deployment, so
issues and pull requests are accepted but may be reviewed selectively.

1. Fork the repository and create a feature branch (`git checkout -b feature/my-feature`).
2. Make your changes and keep the build green — `npm run build` and `npm run typecheck` must pass;
   firmware must compile warning-free for `esp32:esp32:esp32`.
3. Open a pull request with a clear description of the change and its rationale.

Please keep safety-critical invariants intact: pH/EC must never be presented or derived as NPK,
invalid readings must continue to block dosing, and local automation must keep running offline.

---

## Author

**qppd** — [github.com/qppd](https://github.com/qppd)

---

## License

This project is licensed under the **MIT License** — see [LICENSE](LICENSE) for details.

---

## Acknowledgements

- [Espressif Systems](https://www.espressif.com/) — ESP32 platform and Arduino core
- [Arduino](https://www.arduino.cc/) — `arduino-cli` and the library ecosystem
- [Mobizt's Firebase Arduino Client](https://github.com/mobizt/Firebase-ESP-Client) — Firebase Auth + Realtime Database for ESP32
- [Adafruit](https://www.adafruit.com/) — DHT sensor library and Unified Sensor abstraction
- [ArduinoJson](https://github.com/bblanchon/ArduinoJson) by Benoit Blanchon — JSON for embedded
- [Firebase](https://firebase.google.com/) — Realtime Database, Auth and security rules

---

## Safety Notices

- **Mains (220 V) and the 3.3 V/5 V ESP32 domain must stay physically separated.** Use rated
  contactors/relays, fuses/breakers, grounding, and a protected enclosure.
- Never tie the grid and inverter outputs together without approved automatic transfer
  equipment and backfeed prevention.
- pH and EC **do not measure NPK**. Nitrogen, phosphorus and potassium are read only from
  the dedicated RS485 NPK probe — never derived from pH or EC, and shown as unavailable
  whenever the probe is faulted or not fitted.
- NPK dosing is **bounded and interlocked**: one channel at a time, hard burst cap,
  cooldown, and a 30-minute lockout with an alert if a reading stops responding. It is
  blocked whenever the NPK probe, pH or EC is invalid, EC is above target, or the
  solution is not circulating.
- Firmware enforces fail-safe behavior: invalid sensor readings block dosing, low flow
  stops the irrigation pump, and local automation keeps running without internet.

---

## Status

Three-week implementation target: **W1** foundation + dashboard + preliminary 3D model ·
**W2** firmware + integration · **W3** testing + handover.
