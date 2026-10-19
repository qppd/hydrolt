# HYDROLYT / HydroLT

**IoT-Based Vertical Hydroponic System for Sustainable Off-Season Cultivation of *Cucumis melo* (Melon)**

One greenhouse (4 × 5 m), two existing vertical hydroponic towers, one ESP32-based IoT
controller, automated nutrient dosing, water-flow management, environmental control,
hybrid solar/grid power, and a web-based monitoring and management system.

> **Budget / scope note:** total agreed budget is **₱40,000** (components, firmware, web app,
> wiring diagram, 3D model). Client supplies the pH/EC sensors and peristaltic pump; the
> submersible pump and exhaust fan are reused. Anything outside the approved BOM needs
> client approval before spending — this includes the NPK probe (RS485/MAX485) and the
> three N/P/K dosing pumps required for closed-loop NPK control (FR-13): the firmware,
> database and web app already support them, and the system runs fine without the
> hardware fitted. See [docs/requirements.md](docs/requirements.md).

---

## Repository layout

```
hydrolt/
├── README.md                     ← this file
├── docs/                         ← project documentation
│   ├── requirements.md           ← full requirements & acceptance criteria
│   ├── database-schema.md        ← Supabase schema + RLS policies
│   └── setup.md                  ← firmware & web app setup guide
└── src/
    ├── esp/
    │   └── HydroLT/
    │       └── HydroLT.ino       ← ESP32 controller firmware (Arduino)
    └── webapp/
        └── HydroLT/              ← Next.js + TypeScript web application
            ├── app/              ← App Router pages (dashboard, history, controls, alerts)
            ├── components/       ← reusable UI components
            ├── hooks/            ← telemetry polling hooks
            └── lib/              ← types, Supabase client, mock data
```

---

## Quick start

### 1. Web app (`src/webapp/HydroLT`)

```powershell
cd src\webapp\HydroLT
npm install
npm run dev
```

Open <http://localhost:3000>.

The dashboard runs in **demo mode with simulated data** when no Supabase environment
variables are set, so you can preview it immediately. To connect a real backend, copy
`.env.example` to `.env.local` and fill in your Supabase project values — see
[docs/setup.md](docs/setup.md).

Build for production:

```powershell
npm run build
npm start
```

### 2. ESP32 firmware (`src/esp/HydroLT`)

1. Open `src/esp/HydroLT/HydroLT.ino` in the Arduino IDE (or PlatformIO).
2. Install the board support **esp32 by Espressif Systems** and the libraries:
   - `PubSubClient` (Nick O'Leary)
   - `DHT sensor library` (Adafruit) + `Adafruit Unified Sensor`
   - `ArduinoJson` (Benoit Blanchon)
   - (RS485 NPK probe needs no extra library — a Modbus RTU master is built into the sketch)
3. Set `WIFI_SSID`, `WIFI_PASS`, `MQTT_HOST`, and pin assignments for your actual wiring.
4. Select **ESP32 Dev Module**, compile, upload.
5. Serial monitor at **115200 baud** for boot and diagnostic logs.

Full wiring/setup guidance: [docs/setup.md](docs/setup.md).

---

## Key documents

| Document | Contents |
|---|---|
| [docs/requirements.md](docs/requirements.md) | Functional/hardware requirements, automation logic, scope, 3-week plan, acceptance criteria |
| [docs/database-schema.md](docs/database-schema.md) | Supabase/PostgreSQL tables, indexes, RLS policies, retention |
| [docs/setup.md](docs/setup.md) | Environment setup, firmware configuration, MQTT topics, deployment notes |

---

## Safety notices

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
  solution is not circulating — and needs client-approved N/P/K pumps to be installed.
- Firmware enforces fail-safe behavior: invalid sensor readings block dosing, low flow
  stops the irrigation pump, and local automation keeps running without internet.

---

## Status

Three-week implementation target: **W1** foundation + dashboard + preliminary 3D model ·
**W2** firmware + integration · **W3** testing + handover.
