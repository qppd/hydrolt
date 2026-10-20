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
| MQTT broker | Mosquitto (local) or a hosted broker |
| Supabase project | for auth + PostgreSQL (optional — app runs in demo mode without it) |

---

## 2. Repository structure

```
hydrolt/
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
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon (public) key |
| `NEXT_PUBLIC_DEVICE_ID` | Fallback UUID of the registered ESP32 in `devices` (used only before a user connects a device) |
| `NEXT_PUBLIC_DEMO_MODE` | `true` forces simulated data even if Supabase is set |

If Supabase variables are missing, the app automatically falls back to **demo mode**
(simulated live readings) so the UI can be reviewed before the backend exists.

### 3.2 Connecting Supabase

1. Create a project at <https://supabase.com>.
2. Run the SQL in [database-schema.md](database-schema.md) in the SQL editor.
3. Enable **Email** auth in Authentication → Providers.

4. **Sign-up flow:** visitors create their own account from the app's **Sign up** tab
   (Supabase `auth.signUp`). By default a new user lands with no profile row, so their
   role defaults to `viewer` on first insert. To make someone an admin, insert their
   profile row after they sign up (or pre-create it):

```sql
insert into public.profiles (id, full_name, role)
values ('<auth-user-uuid>', 'Admin', 'owner');
```

5. Register the device, then **copy the returned `id`** — that UUID is the device's
   unique ID, shown on the device label and on the serial monitor at boot:

```sql
insert into public.devices (name, device_key_hash, status)
values ('Greenhouse Controller', encode(digest('change-me-device-key', 'sha256'), 'hex'), 'offline')
returning id;
```

6. Put the project URL + anon key in `.env.local` and restart `npm run dev`.

### 3.3 Signing in and connecting a device

The app gates all monitoring/control pages behind authentication and a linked device:

1. **Sign up / Sign in** — visitors create an account (Sign up tab) or sign in
   (Sign in tab) at `/login`.
2. **Connect** — after authenticating, the user is sent to `/connect` to enter the
   controller's **unique device ID**. The ID is validated against the `devices` table
   (RLS-protected) and, once accepted, is stored in the browser (`localStorage`) so
   every page reads telemetry for that machine.
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
| PubSubClient | Nick O'Leary | ✔ |
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
const char* MQTT_HOST = "192.168.1.10";   // broker IP
const uint16_t MQTT_PORT = 1883;
const char* DEVICE_ID = "hydro-01";
```

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

Verified build (arduino-cli, `esp32:esp32:esp32`, warnings=all): **948,384 bytes (72 %) flash ·
47,808 bytes (14 %) RAM · 0 warnings from the sketch.**

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

## 5. MQTT topics

| Topic | Direction | Payload |
|---|---|---|
| `hydro/{deviceId}/telemetry` | device → broker | `{"ts":..,"ph":..,"ec":..,"temp":..,"hum":..,"npk_n":..,"npk_p":..,"npk_k":..,"flow":..,"flags":{"ph":1,"ec":1,"climate":1,"flow":1,"npk":1}}` |
| `hydro/{deviceId}/state` | device → broker | `{"pump":0,"fan":0,"misting":0,"doseA":0,"doseB":0,"doseN":0,"doseP":0,"doseK":0,"npk_ok":1,"mode":"auto"}` (retained) |
| `hydro/{deviceId}/alert` | device → broker | `{"severity":"warning","type":"low_flow","msg":"..."}` |
| `hydro/{deviceId}/status` | device → broker | `online` / `offline` (LWT, retained) |
| `hydro/{deviceId}/cmd` | app → broker | `{"cmd":"pump","value":true,"id":"<uuid>"}` · `{"cmd":"dose","value":"N","duration_ms":3000,"id":"<uuid>"}` (A/B = pH channels, N/P/K = NPK channels) |
| `hydro/{deviceId}/settings` | app → broker | `{"ph_min":5.5,"ph_max":6.5,...,"npk_n_min":80,"npk_n_max":160,"npk_dosing_max_runtime_s":5,"npk_dose_cooldown_s":300,"npk_dosing_enabled":1}` |

The `npk_n`, `npk_p` and `npk_k` telemetry fields are **omitted** whenever the probe
has not produced a valid frame, and `flags.npk` reports the probe health — the
dashboard then shows "—" instead of stale numbers. `npk_dosing_enabled` is the NPK
kill switch (1 = automatic NPK dosing armed).

Command payloads are validated on-device; anything unrecognized or out of range is
rejected and acknowledged as `failed`.

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
