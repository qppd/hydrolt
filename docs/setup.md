# HYDROLYT — Setup Guide

How to build, configure, and run both halves of the project.

---

## 1. Prerequisites

| Tool | Version / notes |
|---|---|
| Node.js | 20 LTS or newer |
| npm | ships with Node |
| Arduino IDE | 2.x (or PlatformIO) |
| ESP32 board package | `esp32 by Espressif Systems` |
| Firebase project | Realtime Database + Email/Password auth (optional — app runs in demo mode without it) |

---

## 2. Repository structure

```
hydrolyt/
├── README.md
├── docs/
├── src/
│   ├── esp/HydroLT/HydroLT.ino
│   └── webapp/HydroLT/          ← Next.js + TypeScript app
```

---

## 3. Web application

```powershell
cd src\webapp\HydroLT
npm install
npm run dev
```

Open <http://localhost:3000>.

### 3.1 Environment variables

Copy `.env.example` to `.env.local`:

```powershell
Copy-Item .env.example .env.local
```

| Variable | Purpose |
|---|---|
| `NEXT_PUBLIC_FB_API_KEY` | Firebase project web API key |
| `NEXT_PUBLIC_FB_AUTH_DOMAIN` | Firebase auth domain (`<project>.firebaseapp.com`) |
| `NEXT_PUBLIC_FB_DATABASE_URL` | Realtime Database URL (`<project>-default-rtdb.firebaseio.com`) |
| `NEXT_PUBLIC_FB_PROJECT_ID` | Firebase project ID |
| `NEXT_PUBLIC_DEVICE_ID` | Fallback device ID of the registered ESP32 (used only before a user connects a device) |
| `NEXT_PUBLIC_DEMO_MODE` | `true` forces simulated data even if Firebase is set |

If the Firebase variables are missing, the app automatically falls back to **demo mode**
(simulated live readings) so the UI can be reviewed before the backend exists.

### 3.2 Connecting Firebase

1. Create a project at <https://console.firebase.google.com>.
2. **Realtime Database** → Create database (start in **test mode**, then paste the
   rules from [database-schema.md](database-schema.md)).
3. **Authentication → Sign-in method** → enable **Email/Password**.
4. **Project settings → General** → copy the web app config into `.env.local`
   (`NEXT_PUBLIC_FB_*`).
5. **Authentication → Users → Add user** — create the account that the web app
   will sign in with. All accounts start as `viewer` (the app writes
   `users/{uid}` with `role: "viewer"` on sign-up); promote an account to
   `owner` in the database by editing its `role` field.

6. Register the device in the database. The device ID is whatever you set as
   `DEVICE_ID` in the firmware (e.g. `hydro-01`) — it is shown on the serial
   monitor at boot and is what users type on the Connect page:

```
devices/
└── hydro-01/
    ├── info/
    │   ├── name: "Greenhouse Controller"
    │   ├── location: "Greenhouse 4x5m"
    │   └── firmware_version: "0.1.0"
    └── status: "offline"
```

7. Restart `npm run dev`.

### 3.3 Signing in and connecting a device

The app gates all monitoring/control pages behind authentication and a linked device:

1. **Sign up / Sign in** — visitors create an account (Sign up tab) or sign in
   (Sign in tab) at `/login`.
2. **Connect** — after authenticating, the user is sent to `/connect` to enter the
   controller's **unique device ID**. The ID is validated against the
   `devices/{id}` node (security-rules protected) and, once accepted, is stored in
   the browser (`localStorage`) so every page reads telemetry for that machine.
3. **Dashboard** — with a device linked, `/`, `/history`, `/controls` and `/alerts`
   all scope their queries to the connected device.

`NEXT_PUBLIC_DEVICE_ID` is only a **fallback** used when no device has been connected
yet (e.g. first load, or a shared kiosk). In production each user links their own
device on `/connect`. If a signed-in user has no device linked, the app automatically
routes them to `/connect`.

### 3.3 Production build

```powershell
npm run build
npm start
```

---

## 4. ESP32 firmware

File: [`src/esp/HydroLT/HydroLT.ino`](../src/esp/HydroLT/HydroLT.ino)

### 4.1 Libraries

| Library | Author | Install via Library Manager |
|---|---|---|
| Firebase Arduino Client Library for ESP8266 and ESP32 | Mobizt | ✔ **v4.x** (Firebase Auth + Realtime Database) |
| DHT sensor library | Adafruit | ✔ |
| Adafruit Unified Sensor | Adafruit | ✔ |
| ArduinoJson | Benoit Blanchon | ✔ **v7.x required** (`JsonDocument` API) |

The NPK probe needs **no extra library** — a small Modbus RTU master (function 0x03,
CRC-16) runs on UART2 through a MAX485 transceiver, driven by the sketch itself.

### 4.1b NPK probe (RS485 / MAX485)

| Probe setting | Firmware constant | Default |
|---|---|---|
| Baud rate | `NPK_BAUD` | `4800` (some probes ship at 9600 — set to match) |
| Slave address | `NPK_SLAVE_ADDR` | `1` |
| Registers read | fixed | `0x0000`, count 3 → N, P, K as mg/kg |
| UART2 pins | `PIN_NPK_RX` / `PIN_NPK_TX` | `16` / `17` (not usable on PSRAM boards) |
| Driver enable | `PIN_NPK_DE` | `13` (MAX485 DE+RE tied together) |
| Enable/disable | `NPK_ENABLED` | `true` (set `false` if the probe is not fitted) |

Wiring: ESP32 GPIO17 (TX2) → MAX485 DI, GPIO16 (RX2) ← MAX485 RO, GPIO13 → MAX485
DE+RE, common GND. Probe side: A, B and the probe's supply (usually 9–30 V — check the
datasheet, and use a level/RS485-compatible module rated for it).

### 4.2 Configure

Edit the top of `HydroLT.ino`:

```cpp
const char* WIFI_SSID = "YOUR_SSID";
const char* WIFI_PASS = "YOUR_PASSWORD";
const char* FB_API_KEY  = "YOUR_WEB_API_KEY";       // Firebase project settings
const char* FB_DB_URL   = "https://<project>-default-rtdb.firebaseio.com";
const char* FB_EMAIL    = "device-hydro-01@your-project.example.com";
const char* FB_PASSWORD = "YOUR_DEVICE_PASSWORD";   // dedicated device account
const char* DEVICE_ID   = "hydro-01";               // unique machine ID for the web app
```

The device signs into Firebase with its **own email/password account** (create it in
Authentication → Users). Never put a database secret in the firmware.

Then set the pin map to match the actual wiring (see §6) and the default control
thresholds (`DEFAULT_PH_MIN`, `DEFAULT_TEMP_SETPOINT`, `DEFAULT_MIN_FLOW`, ...).

For NPK, review the `NPK_*` block near the top of the sketch: `NPK_ENABLED`,
`PIN_NPK_RX`/`PIN_NPK_TX`/`PIN_NPK_DE`, `NPK_BAUD`, `NPK_SLAVE_ADDR`, and the
`DEFAULT_NPK_*` target bands, burst cap and cooldown. **The default NPK bands are
placeholders** — set them to the values your probe reports (units, method and
calibration per its datasheet) and to the melon feeding schedule before leaving
automatic NPK dosing unattended. Pumps C/D/E (`PIN_DOSE_N`/`_P`/`_K`, GPIO 18/19/21)
must be wired to the N, P and K peristaltic pumps; if they are not, keep
`NPK_ENABLED = false` or switch the NPK kill switch off in the web app.

### 4.3 Flash

> **Note:** this machine's Arduino CLI sketchbook is set to
> `...\radiant-cooling\.arduino\user`, so libraries are installed *there* (not in
> `Documents\Arduino\libraries`). All four required libraries are already installed in it.

1. Select **Tools → Board → ESP32 Arduino → ESP32 Dev Module**.
2. Select the correct COM port.
3. Compile + upload; open Serial Monitor at **115200 baud**.

Verified build (arduino-cli, `esp32:esp32:esp32`, warnings=all): **1,260,853 bytes (96 %) flash ·
53,688 bytes (16 %) RAM · 0 warnings from the sketch.**

> **Flash headroom:** the Firebase SSL client is much larger than the previous MQTT
> stack. The sketch fits a stock 4 MB ESP32 Dev Module, but leaves little margin for
> future changes — if you overflow after adding features, use a module with 8 MB flash
> or trim optional features.

### 4.4 Behavior notes

- The automation loop is **non-blocking** (`millis()` based) and independent of Wi-Fi:
  dosing, flow protection, fan and misting control keep working with no internet.
- A task watchdog resets the controller if the main loop stalls.
- Invalid/out-of-calibration pH or EC readings **block all dosing** and raise an alert.
- Low flow after the pump's startup delay stops the irrigation pump and raises an alert.
- The NPK probe is polled every 10 s with a validated Modbus frame (address, function,
  CRC, range). After 3 consecutive bad frames the probe is flagged faulted, an alert is
  raised, NPK readings are reported as unavailable, and **NPK dosing is blocked** while
  pH/EC control continues normally.
- Automatic NPK dosing applies **one bounded burst at a time** (default cap 5 s, default
  cooldown 300 s), circulates and re-measures before the next burst, and never doses the
  element that is already at or above its band. After 3 bursts that do not bring an
  element into band, that element is locked out for 30 minutes with an alert.
- NPK dosing is also blocked while pH/EC are invalid, while EC is above target (adding
  salt would raise it further), while the solution is not circulating, and whenever the
  NPK kill switch (`npk_dosing_enabled`) is off.
- Settings persist in NVS (`Preferences`) and survive reboots.

---

## 5. Realtime Database layout

Paths are relative to the database root. `{deviceId}` is the `DEVICE_ID` constant
set in the firmware.

| Path | Direction | Payload |
|---|---|---|
| `devices/{deviceId}/telemetry` | device → DB (overwrite) | `{"ts":<epoch>,"device_ms":..,"ph":..,"ec":..,"temp":..,"hum":..,"npk_n":..,"npk_p":..,"npk_k":..,"flow":..,"flags":{"ph":true,"ec":true,"climate":true,"flow":true,"npk":true}}` |
| `devices/{deviceId}/history/{pushKey}` | device → DB (append) | same as telemetry; one node per archived reading, pruned on-device after 30 days |
| `devices/{deviceId}/state` | device → DB (overwrite) | `{"pump":0,"fan":0,"misting":0,"doseA":0,"doseB":0,"doseN":0,"doseP":0,"doseK":0,"npk_ok":1,"mode":"auto","doseState":"idle","updated_at":<epoch>}` |
| `devices/{deviceId}/status` | device → DB | `"online"` / `"offline"` |
| `devices/{deviceId}/settings` | device → DB (mirror) | `{"ph_min":5.5,"ph_max":6.5,...,"npk_n_min":80,"npk_n_max":160,"npk_dosing_max_runtime_s":5,"npk_dose_cooldown_s":300,"npk_dosing_enabled":1}` |
| `devices/{deviceId}/commands/{pushKey}` | app → device (append) | `{"cmd":"pump","value":true,"id":"<key>"}` · `{"cmd":"dose","value":"N","duration_ms":3000,"id":"<key>"}` (A/B = pH channels, N/P/K = NPK channels). The device streams this node, executes, then deletes each processed key. |
| `devices/{deviceId}/acks/{pushKey}` | device → DB (append) | `{"cmd_id":"<key>","status":"ok"\|"rejected","note":"...","ts":<epoch>}` |
| `devices/{deviceId}/alerts/{pushKey}` | device → DB (append) | `{"severity":"warning","type":"low_flow","msg":"...","ts":<epoch>,"resolved":false}` |
| `devices/{deviceId}/events/{pushKey}` | device → DB (append) | `{"event":"boot","details":"reset_reason=3","ts":<epoch>}` |
| `users/{uid}` | app → DB | `{"email":"...","role":"viewer"}` — written by the app at sign-up |

The `npk_n`, `npk_p` and `npk_k` telemetry fields are **omitted** whenever the probe
has not produced a valid frame, and `flags.npk` reports the probe health — the
dashboard then shows "—" instead of stale numbers. `npk_dosing_enabled` is the NPK
kill switch (1 = automatic NPK dosing armed).

Command payloads are validated on-device; anything unrecognized or out of range is
rejected and acknowledged with `status: "rejected"`.

**Billing note:** RTDB is billed per stored GB and per download. The firmware keeps
only the latest telemetry/state nodes and prunes `history` on-device (30-day window,
one archive node per minute). For a single greenhouse this stays in the free tier;
if you raise `HISTORY_INTERVAL_MS` or `HISTORY_DAYS`, watch the usage report.

---

## 6. Wiring overview (safe separation)

```
        MAINS DOMAIN (220 V)                 LOW-VOLTAGE DOMAIN (3.3/5/12 V)
   ┌────────────────────────────┐      ┌────────────────────────────────────┐
   │ Submersible pump  (52 W)   │      │ ESP32 DevKit                      │
   │ Exhaust fan       (220 V)  │      │  ├─ pH sensor    (analog)          │
   │ Misting pump      (220 V)  │◄─relay│  ├─ EC sensor    (analog)          │
   │ Contactors/fuses/ground    │ coils │  ├─ DHT22 temp/humidity            │
   └────────────────────────────┘      │  ├─ Flow sensor   (pulse input)    │
                                        │  ├─ NPK probe  (RS485: UART2 16/17,│
                                        │  │   MAX485 DE/RE on GPIO13)       │
          ▲                             │  └─ Relay module  (opto-isolated)  │
          │ approved transfer           └────────────────────────────────────┘
   ┌──────┴───────────┐                            ▲
   │ Grid  │ Solar+inv│  — never tie outputs       │ opto-isolated
   └──────────────────┘    together without        │ relay contacts
                            transfer gear    ┌─────┴──────────┐
                                             │ Peristaltic pumps│ (DC)
                                             └────────────────┘
```

Rules:

- Keep mains wiring in a **separate conduit/enclosure** from sensor and logic wiring.
- Verify relay/contact ratings against pump inrush and fan running current.
- Fuse the DC supply; ground the enclosure.
- Peristaltic channels: A = pH-up/nutrient, B = pH-down, C/D/E = nitrogen, phosphorus,
  potassium sources (`PIN_DOSE_N`/`_P`/`_K` = GPIO 18/19/21, same relay logic as the
  other outputs). Only one channel is ever energised at a time.
- RS485 (NPK probe A/B pair) should be twisted pair routed away from mains and motor
  wiring. Power the probe from its own supply per its datasheet — many RS485 NPK probes
  take 9–30 V, **not** 3.3 V — and share only the ground with the MAX485 module.
- Do **not** connect grid and inverter outputs together without approved transfer
  equipment and backfeed protection.

---

## 7. Test checklist (Week 3)

- [ ] Dashboard shows live readings with timestamps and device online status
- [ ] History page charts + CSV export work
- [ ] Manual controls require login and show command status
- [ ] Invalid pH/EC blocks dosing and raises an alert
- [ ] NPK probe answers on UART2; N/P/K appear on dashboard, history and CSV export
- [ ] Disconnecting the NPK probe raises `npk_sensor_fault`, blocks NPK dosing, and
      leaves pH/EC/climate/flow automation running normally
- [ ] A below-band element triggers a bounded burst on its own channel only; an
      above-band element raises an alert and is never dosed
- [ ] 3 bursts without progress lock that element out for 30 min with
      `npk_dosing_no_response`; the kill switch stops automatic NPK bursts immediately
- [ ] Low-flow fault stops the irrigation pump
- [ ] Fan honors threshold + hysteresis; misting honors max duration
- [ ] Automation continues with Wi-Fi disconnected
- [ ] Watchdog recovers from a hung loop
- [ ] Solar/grid transfer tested under load
