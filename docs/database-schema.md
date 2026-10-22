# HYDROLYT — Firebase Realtime Database Schema

Data model for the Firebase Realtime Database (RTDB) covering the structures required in
[requirements.md §6](requirements.md#6-recommended-database-schema), plus the
security rules that enforce the same access control the previous SQL design achieved
with Row Level Security.

Design rules applied throughout:

- No secrets, Wi-Fi passwords, or plaintext device credentials in any node — the
  device signs in with its own Firebase Auth account, and rules check `auth != null`.
- Every user-visible node is readable only by authenticated accounts; writes to
  telemetry/state/acks are restricted to the owning device's auth token.
- Timestamps are **epoch seconds** (`ts`, `updated_at`) written by the device after
  NTP sync; the app falls back to push-key order before the first sync.
- Push keys (`-N...`) sort chronologically, so append-only lists (`history`, `alerts`,
  `events`, `acks`, `commands`) need no separate ordering field.

---

## 1. Tree layout

`{deviceId}` is the `DEVICE_ID` constant configured in `config.h` (e.g. `hydro-01`).

```
devices/
└── {deviceId}/
    ├── info/                     ← static registration (written once at provision)
    │   ├── name: "Greenhouse Controller"
    │   ├── location: "Greenhouse 4x5m"
    │   └── firmware_version: "0.1.0"
    ├── status: "online"          ← device presence; "offline" set at boot/restart
    ├── telemetry/                ← latest sensor sample (overwritten every 5 s)
    │   ├── ts: 1761000000        ← epoch seconds (0 until NTP syncs)
    │   ├── device_ms: 123456     ← millis() at sample time
    │   ├── ph: 5.94
    │   ├── ec: 1.82
    │   ├── temp: 26.4
    │   ├── hum: 68.1
    │   ├── flow: 3.2
    │   ├── npk_n: 112.0          ← omitted when the RS485 probe is faulted
    │   ├── npk_p: 34.0
    │   ├── npk_k: 150.0
    │   └── flags/                ← sensor health (mirrors the validity gates)
    │       ├── ph: true
    │       ├── ec: true
    │       ├── climate: true
    │       ├── flow: true
    │       └── npk: true
    ├── history/                  ← archive: one node per minute, 30-day retention
    │   └── {pushKey}/            ← same shape as telemetry/
    ├── state/                    ← actuator state (overwritten every 3 s)
    │   ├── pump: 0
    │   ├── fan: 0
    │   ├── misting: 0
    │   ├── doseA: 0              ← pH-up/nutrient channel
    │   ├── doseB: 0              ← pH-down channel
    │   ├── doseN: 0              ← nitrogen channel
    │   ├── doseP: 0              ← phosphorus channel
    │   ├── doseK: 0              ← potassium channel
    │   ├── npk_ok: 1
    │   ├── mode: "auto"          ← "auto" | "manual"
    │   ├── doseState: "idle"     ← "idle" | "running" | "mixing"
    │   └── updated_at: 1761000000
    ├── settings/                 ← control limits; device mirrors its NVS copy here
    │   ├── ph_min: 5.5
    │   ├── ph_max: 6.5
    │   ├── ec_min: 1.4
    │   ├── ec_max: 2.5
    │   ├── temperature_setpoint: 28
    │   ├── temperature_hysteresis: 2
    │   ├── humidity_limit: 85
    │   ├── min_flow_rate: 2
    │   ├── dosing_max_runtime_s: 20
    │   ├── dosing_cooldown_s: 60
    │   ├── misting_max_s: 120
    │   ├── npk_n_min: 80         ← PLACEHOLDER bands — tune before unattended dosing
    │   ├── npk_n_max: 160
    │   ├── npk_p_min: 20
    │   ├── npk_p_max: 50
    │   ├── npk_k_min: 100
    │   ├── npk_k_max: 200
    │   ├── npk_dosing_max_runtime_s: 5
    │   ├── npk_dose_cooldown_s: 300
    │   └── npk_dosing_enabled: 1 ← NPK kill switch (0 = automatic NPK dosing off)
    ├── commands/                 ← app → device queue; device deletes each key after ack
    │   └── {pushKey}/
    │       ├── cmd: "pump"       ← "pump"|"fan"|"misting"|"mode"|"settings"|"dose"|"restart"
    │       ├── value: true       ← or "auto"/"manual" (mode), "A"|"B"|"N"|"P"|"K" (dose)
    │       ├── duration_ms: 3000 ← dose only
    │       ├── settings/         ← settings command only: partial or full settings patch
    │       ├── id: "{pushKey}"   ← echoed back in the ack
    │       ├── created_by: "{uid}"
    │       └── created_at: "2026-10-20T08:15:00.000Z"
    ├── acks/                     ← device → app command results (append-only)
    │   └── {pushKey}/
    │       ├── cmd_id: "{pushKey}"
    │       ├── status: "ok"      ← "ok" | "rejected"
    │       ├── note: "device is in AUTO mode"   ← present on rejections
    │       └── ts: 1761000000
    ├── alerts/                   ← device → app alert history (append-only)
    │   └── {pushKey}/
    │       ├── severity: "warning"   ← "info" | "warning" | "critical"
    │       ├── type: "low_flow"      ← machine-readable alert code
    │       ├── msg: "Flow 0.8 L/min below 2.0 L/min"
    │       ├── ts: 1761000000
    │       ├── resolved: false
    │       └── resolved_at: "2026-10-20T09:00:00.000Z"  ← set by the app
    └── events/                   ← device lifecycle log (append-only)
        └── {pushKey}/
            ├── event: "boot"     ← "boot"|"wifi_up"|"wifi_loss"|"heartbeat"|...
            ├── details: "reset_reason=3"
            └── ts: 1761000000

users/
└── {uid}/
    ├── email: "admin@example.com"
    ├── role: "owner"             ← "owner" | "operator" | "viewer"
    └── created_at: "2026-10-20T08:00:00.000Z"
```

The app's `sendCommand()` writes `commands/{pushKey}` with `cmd`, `value`/
`duration_ms`/`settings` as applicable, and echoes the push key back as `id`. The
firmware streams `commands/`, executes each new key, pushes an `acks/` entry, and
deletes the processed node — so the queue is self-clearing and reconnects never
replay old commands (the device also tracks the highest key it has executed).

---

## 2. Security rules

Paste into Realtime Database → Rules. Adjust the `auth.token.email` matches for your
device accounts.

```json
{
  "rules": {
    "devices": {
      "$deviceId": {
        ".read": "auth != null",
        "info":   { ".write": "auth != null" },
        "status": { ".write": "auth != null" },
        "telemetry": { ".write": "auth != null && root.child('devices').child($deviceId).child('info').exists()" },
        "history": {
          "$pushKey": { ".write": "auth != null && root.child('devices').child($deviceId).child('info').exists()" }
        },
        "state":  { ".write": "auth != null && root.child('devices').child($deviceId).child('info').exists()" },
        "settings": { ".write": "auth != null" },
        "commands": {
          "$pushKey": {
            ".write": "auth != null",
            ".validate": "newData.hasChildren(['cmd', 'id']) && newData.child('cmd').isString()"
          }
        },
        "acks":  { "$pushKey": { ".write": "auth != null" } },
        "alerts": {
          ".read": "auth != null",
          "$pushKey": {
            ".write": "auth != null",
            "resolved":   { ".write": "auth != null" },
            "resolved_at": { ".write": "auth != null" }
          }
        },
        "events": { "$pushKey": { ".write": "auth != null" } }
      }
    },
    "users": {
      "$uid": {
        ".read": "auth != null && auth.uid === $uid",
        ".write": "auth != null && auth.uid === $uid",
        "role": {
          ".write": "auth != null && auth.uid === $uid && (!data.exists() || newData.val() === data.val())"
        }
      }
    }
  }
}
```

How this maps to the old RLS intent:

| Old SQL policy | RTDB rule |
|---|---|
| `devices: readable by authenticated` | `devices/$deviceId/.read: auth != null` |
| `settings: write operators+owners` | `settings/.write: auth != null` (role gating lives in the app; the device always needs read access to its own settings stream) |
| `commands: create operators+owners` | `commands/$pushKey/.write: auth != null` + `.validate` requires `cmd` and `id` |
| `alerts: resolve operators+owners` | `alerts/$pushKey/.write: auth != null` |
| `profiles: read/update own` | `users/$uid/.read|.write: auth.uid === $uid` |
| role escalation via service role only | `users/$uid/role/.write` refuses changes once the node exists — promote accounts from the Firebase console |

> **Device writes:** the firmware signs in with a dedicated Firebase Auth account
> (email/password), so every write it performs carries `auth != null`. The rules above
> are a starting point — for tighter control, add a custom claim (e.g.
> `device: true`) to the device account and require it on `telemetry`/`state`/`acks`
> writes. Never embed a database secret in firmware.

---

## 3. Data volume & retention

RTDB is billed per stored GB and per download, so the schema keeps volume bounded:

| Node | Growth | Control |
|---|---|---|
| `telemetry` | constant (single node) | overwritten every 5 s |
| `history` | 1 node/minute ≈ 44 KB/day | firmware prunes nodes older than 30 days (`HISTORY_DAYS`) on every archive write |
| `state`, `settings`, `status` | constant | overwritten |
| `commands` | transient | device deletes each key after acking |
| `acks`, `events` | slow append | reviewed in-app; prune from the console if they grow |
| `alerts` | slow append | `resolved: true` set by the app; prune resolved alerts periodically |

For a single greenhouse this stays within the RTDB free tier. If you raise
`HISTORY_INTERVAL_MS` or `HISTORY_DAYS` in the firmware, watch the Firebase usage
report.

---

## 4. Migrating an existing database

No SQL migration is required for new projects. If you are porting data from the
previous Supabase design, the field names carry over 1:1 inside each node — the
`settings` keys, `telemetry` sensor fields and `alerts` codes are identical, only
the container changed from tables to a tree.

Idempotent setup for a fresh project:

1. Create the database (test mode), paste the rules from §2.
2. Enable Email/Password auth; add a user for the web app and one for the device.
3. Create `devices/{deviceId}/info` (see setup.md §3.2) — the firmware's pairing
   check treats an existing `devices/{deviceId}` node as proof the device is
   registered, so creating `info` at provision time is enough.
4. Set `users/{uid}/role` to `owner` for administrators (console edit).
