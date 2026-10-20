# HYDROLYT — Project Requirements

**Project:** HYDROLYT: IoT-Based Vertical Hydroponic System for Sustainable Off-Season
Cultivation of *Cucumis melo* (Melon)

**Development scope:** One greenhouse measuring 4 × 5 meters, two existing vertical
hydroponic towers, one integrated IoT controller, a web-based monitoring and management
system, automated nutrient dosing, water-flow management, environmental control, and
hybrid solar/grid power.

The plan follows the agreement with the client: **₱40,000 total project budget**,
including components, firmware, web app, wiring diagram, and 3D model. The client will
send the existing sensors and peristaltic pump, while the existing submersible pump and
exhaust fan will be reused. The scope should be kept controlled to avoid exceeding the
budget or delivery schedule.

---

## 1. System overview

HYDROLYT will monitor and automate a vertical hydroponic system that grows melon in two
towers inside a 4 × 5-meter greenhouse.

The system must provide:

- **Automated nutrient dosing** using the available pH and EC sensors, subject to
  verification of their suitability and calibration.
- **Water circulation** through a centralized pump supplying both towers.
- **Temperature and humidity monitoring**, with exhaust fan and misting control.
- **Live monitoring and historical data** through a web app.
- **Hybrid solar and grid power**, with safe switching and appropriate electrical protection.
- **Manual override, alerts,** and protection against unsafe operating conditions.

## 2. Functional requirements

| ID | Feature | Required behavior |
|---|---|---|
| FR-01 | Sensor monitoring | Read pH, EC, air temperature, relative humidity, water flow, and N/P/K from the NPK probe where applicable. |
| FR-02 | Nutrient dosing | Operate peristaltic pump(s) according to configured dosing rules and calibrated measurements. |
| FR-03 | Water circulation | Control the existing submersible pump and monitor flow through the shared irrigation line. |
| FR-04 | Environment control | Control exhaust fan and misting equipment based on configurable temperature and humidity thresholds. |
| FR-05 | Web dashboard | Display live readings, connection status, device status, and current operating mode. |
| FR-06 | Historical records | Store timestamped sensor readings, pump activity, environmental conditions, and alerts. |
| FR-07 | Remote controls | Allow authorized users to change settings and request manual device operations. |
| FR-08 | Alerts | Show out-of-range readings, sensor errors, low flow, dosing faults, and device disconnection. |
| FR-09 | Configuration | Set target ranges, control thresholds, dosing limits, and automation schedules. |
| FR-10 | Fail-safe operation | Prevent uncontrolled dosing and unsafe switching during sensor failure, communication loss, or restart. |
| FR-11 | Solar/grid monitoring | Display power-source status if suitable monitoring hardware is included. |
| FR-12 | Access control | Protect the dashboard and device controls with authenticated accounts and appropriate permissions. |
| FR-13 | NPK monitoring & dosing | Read nitrogen, phosphorus and potassium from a dedicated RS485 NPK probe, display and store them, and dose bounded N/P/K bursts to hold them inside configured target bands — with automatic dosing blocked on probe fault, invalid pH/EC, EC above target, or while the solution is not circulating. |

## 3. Hardware requirements

These are the components to confirm and implement — not a claim that every item has
already been purchased.

| Component | Purpose | Status |
|---|---|---|
| ESP32 development board | Main IoT controller | Confirm availability |
| pH sensor and probe | Measure solution acidity | Client-owned; verify model |
| EC sensor and probe | Measure electrical conductivity | Client-owned; verify model |
| NPK sensor (RS485 Modbus) + MAX485 transceiver | Measure N, P, K directly | **New BOM item** — needs client approval; verify units, method and calibration for solution use |
| Temperature/humidity sensor | Monitor greenhouse climate | Confirm model and quantity |
| Flow sensor | Measure irrigation flow | Confirm availability and compatibility |
| Peristaltic pump | Nutrient dosing | Client-owned; verify quantity and voltage |
| Peristaltic pumps ×3 (N, P, K) + relay/driver channels | Closed-loop NPK dosing | **New BOM item** — required for FR-13; needs client approval before purchase |
| Submersible pump, 220 V, 52 W | Circulate water to two towers | Existing; reuse |
| Exhaust fan, 220 V | Greenhouse ventilation | Existing; reuse |
| Misting pump/nozzles | Assist environmental cooling | Specify and budget |
| Relay or contactor modules | Switch compatible loads | Size and isolation must be verified |
| DC power supply and converters | Supply ESP32 and sensors | Include in BOM |
| Solar panel, battery, charge controller/inverter | Hybrid power support | Size after load assessment |
| Enclosure, terminals, protection devices | Protect controller and wiring | Include in BOM |
| Irrigation tubing and fittings | Distribute water to towers | Reuse or purchase as needed |

> **Important nutrient-control distinction:** pH and EC are *not* direct measurements of
> nitrogen, phosphorus, and potassium. EC estimates the solution's overall ionic
> conductivity, while pH measures acidity/alkalinity. They can support nutrient
> management, but they cannot identify individual NPK concentrations. **The software must
> not claim otherwise.** N/P/K are therefore read only from a dedicated NPK sensor
> (FR-13), and the sensor's measurement method, units, compatibility with the nutrient
> solution and cost must be validated before unattended dosing is enabled. The NPK
> hardware is a new BOM item and requires client approval before purchase.

## 4. Automation logic

### A. Nutrient dosing

1. Read pH and EC sensors.
2. Validate sensor values and calibration status.
3. Compare readings with user-configured crop targets.
4. If correction is needed, dose only the configured nutrient solution using calibrated
   pump runtime or volume.
5. Allow mixing and circulation before measuring again.
6. Stop at configured limits and raise an alert if readings do not respond as expected.

> Do not automatically infer individual NPK deficiencies from pH or EC alone. Confirm the
> dosing formulation and number of peristaltic pumps before implementation.

### B. Water-flow management

7. Start the irrigation pump according to the selected schedule or manual command.
8. Check measured flow after the pump's startup delay.
9. Compare the reading with the minimum acceptable flow.
10. If flow is too low, stop or limit operation as appropriate and notify the user.
11. Log pump runtime, flow readings, and faults.

### C. Temperature and humidity

12. Read greenhouse temperature and humidity.
13. Activate the exhaust fan when the configured temperature threshold is reached.
14. Activate misting only when configured conditions permit it.
15. Apply hysteresis, minimum run/off times, and a maximum misting duration.
16. Stop misting if water is unavailable, a relevant sensor fails, or a safety limit is reached.

> Exhaust fans and misting do not guarantee a specific greenhouse temperature. Actual
> cooling depends on ambient conditions, humidity, airflow, and greenhouse design.

### D. NPK management (closed-loop, FR-13)

17. Poll the RS485 NPK probe at a fixed cadence and validate address, function code,
    CRC and engineering-unit range on every frame.
18. Report N/P/K only from that probe. On probe fault: publish an alert, show the NPK
    readings as unavailable, and block NPK dosing — while pH/EC/climate/flow control
    keeps running normally.
19. In AUTO mode, dose an element only when **all** of these hold: solution circulating,
    pH **and** EC valid, EC not above target, NPK kill switch enabled, NPK probe healthy,
    cooldown elapsed, and the element below its configured minimum.
20. Dose the element furthest below its band, one channel at a time, using a bounded
    burst capped by `npk_dosing_max_runtime_s`; circulate (`mix wait`) and re-measure
    before considering the next burst. pH/EC correction always takes priority over NPK.
21. If an element does not reach its band after 3 bounded bursts, lock it out for
    30 minutes and raise an alert — no endless dosing (FR-10).
22. Above the target band: alert only. NPK is never "dosed down" — dilution/flush is a
    manual action.
23. Manual N/P/K doses are allowed in MANUAL mode only, bounded by the same caps, and
    rejected whenever the probe is not answering.

> Closed-loop NPK dosing requires three additional peristaltic channels (N, P, K) and
> their relay/driver outputs. Install only with client-approved hardware; if only
> monitoring is available, disable automatic NPK dosing (kill switch) or set
> `NPK_ENABLED = false` in the firmware.

## 5. Web application requirements

**Dashboard**

- Live pH, EC, temperature, humidity, flow and N/P/K readings.
- Fan, pump, misting and dosing channel states (including the N, P, K channels).
- Online/offline indicator and last update time.

**History and reports**

- Sensor charts by date and time, including N/P/K.
- Device activity and fault logs.
- Downloadable CSV reports, if included in the agreed scope.

**Controls and settings**

- Automatic/manual mode.
- Setpoints and dosing limits, including NPK target bands, burst cap, cooldown and the
  automatic NPK dosing kill switch.
- Pump, fan, misting and manual N/P/K dose controls with safety interlocks.

**Alerts and device health**

- Sensor faults (including NPK probe fault) and out-of-range conditions.
- Low flow and dosing failures, including NPK no-response lockout.
- Connection status and recent fault history.

**Suggested software architecture**

Use an architecture that is maintainable, economical, and achievable within the deadline.

- **Device firmware:** ESP32 with non-blocking sensor acquisition, automation rules,
  local safety checks, and watchdog recovery.
- **Communication:** Wi-Fi. Telemetry and commands flow through the Firebase
  Realtime Database — the device opens outbound TLS connections only, so no broker
  or public endpoint needs hosting.
- **Web application:** Next.js with TypeScript and a responsive interface.
- **Backend/database:** Firebase for authentication (Email/Password), Realtime
  Database storage, and real-time dashboard updates, subject to the hosting and
  connectivity plan.
- **Device security:** Authenticated commands, per-device credentials, input validation,
  and no direct public exposure of ESP32 control endpoints.
- **Offline behavior:** Essential automation must continue locally when internet access or
  the web app is unavailable.

## 6. Recommended database schema

For the Firebase Realtime Database implementation, use the following core nodes.

| Node | Important fields | Purpose |
|---|---|---|
| `users/{uid}` | `email`, `role` | User accounts and permissions |
| `devices/{id}/info` | `name`, `location`, `firmware_version` | ESP32 registration |
| `devices/{id}/status` | `"online"` / `"offline"` | Device connectivity |
| `devices/{id}/telemetry` | `ts`, `ph`, `ec`, `temp`, `hum`, `flow`, `npk_n`, `npk_p`, `npk_k`, `flags` | Latest sensor sample |
| `devices/{id}/history/{pushKey}` | same as telemetry | Historical sensor data |
| `devices/{id}/state` | `pump`, `fan`, `misting`, `doseA/B/N/P/K`, `mode`, `doseState`, `updated_at` | Current operating state |
| `devices/{id}/settings` | `ph_min/max`, `ec_min/max`, `temperature_setpoint`, `humidity_limit`, `min_flow_rate`, `npk_*_min/max`, `npk_dosing_max_runtime_s`, `npk_dose_cooldown_s`, `npk_dosing_enabled` | Configurable automation settings |
| `devices/{id}/commands/{pushKey}` | `cmd`, `value`, `duration_ms`, `settings`, `id`, `created_by` | Remote commands (self-clearing queue) |
| `devices/{id}/acks/{pushKey}` | `cmd_id`, `status`, `note`, `ts` | Command execution tracking |
| `devices/{id}/alerts/{pushKey}` | `severity`, `type`, `msg`, `ts`, `resolved` | Fault and warning records |
| `devices/{id}/events/{pushKey}` | `event`, `details`, `ts` | Reboots, sensor failures, and operating events |

**Implementation requirements**

- Use push keys for append-only lists and epoch timestamps for ordering.
- Enforce Realtime Database **security rules** on every exposed node (see
  database-schema.md §2).
- Restrict configuration changes and device commands to authorized users.
- Devices sign in with their own Firebase Auth account; never embed database
  secrets or Wi-Fi credentials in the database.
- Bound data volume with retention (the firmware prunes `history` on-device).
- Do not store secrets, Wi-Fi passwords, or plaintext device credentials in public
  database nodes.

## 7. Electrical and solar requirements

The system has existing 220 V equipment and an ESP32-based low-voltage controller. These
must be treated as **separate electrical domains**.

- Use correctly rated contactors or relays, fuses/breakers, grounding, isolation, and a
  protected enclosure.
- Keep mains wiring physically separated from low-voltage sensor and communication wiring.
- Confirm pump startup current, fan current, and inverter surge capacity before selecting
  the power equipment.
- Size the solar system using measured or documented daily energy consumption, operating
  hours, local solar conditions, and battery autonomy.
- Implement proper source transfer and backfeed prevention. Do not connect the grid and
  inverter outputs together without approved transfer equipment.
- Preserve local automation during internet outages and recover safely after a power
  interruption.

> **Budget constraint:** Hybrid solar/grid is the agreed direction, but the final capacity
> must be determined before ordering. A small backup battery with grid support may be more
> achievable than a fully off-grid design. Do not promise uninterrupted operation until the
> actual loads and available budget have been verified.

## 8. Scope and deliverables

| Deliverable | Included |
|---|---|
| ESP32 firmware | Yes |
| IoT web app | Yes |
| Backend and database setup | Yes |
| Existing sensor and pump integration | Yes, after compatibility checks |
| Components for the agreed implementation | Yes, subject to the ₱40,000 budget and approved BOM |
| Wiring diagram | Yes |
| 3D model | Yes |
| System architecture, block diagram, and flowcharts | Excluded from the reduced-scope agreement unless separately approved |
| Physical construction and mounting of the client's greenhouse and towers | Client responsibility |
| Shipping of client-owned components to the developer | Client responsibility |
| Additional hardware, features, or capacity beyond the approved scope | Requires approval before additional expenditure |

The client is expected to provide the existing pH and EC sensors, peristaltic pump, and
relevant components for compatibility testing. The existing submersible pump and exhaust
fan are to be reused.

> **NPK scope note (FR-13):** the RS485 NPK probe, MAX485 module, three peristaltic N/P/K
> dosing pumps and their relay/driver channels are *not* part of the originally approved
> BOM. The firmware, database and web app support them now; the physical hardware must be
> approved and funded by the client before installation, and until then the NPK probe can
> be left unfitted (`NPK_ENABLED = false`) with automatic NPK dosing switched off.

## 9. Three-week implementation plan

*Development target, excluding shipping delays and subject to timely receipt of components
and greenhouse measurements.*

### W1 — Days 1–7: Foundation and presentation

- Confirm the hardware inventory and operating thresholds.
- Finalize the architecture and database.
- Build the responsive web dashboard.
- Create the preliminary 3D model using client-provided measurements.

### W2 — Days 8–14: Firmware and integration

- Implement sensor acquisition and calibration support.
- Build local automation, dosing limits, and flow-fault detection.
- Integrate the RS485 NPK probe and bounded NPK dosing (subject to hardware approval).
- Connect telemetry and commands to the backend.
- Integrate the dashboard with real or simulated readings.

### W3 — Days 15–21: Testing and handover

- Test sensor readings, dosing, irrigation, fan, and misting.
- Verify communication-loss and restart behavior.
- Test solar/grid power operation and electrical protections.
- Correct defects and prepare the agreed deliverables.

## 10. Acceptance criteria

The implementation is ready for handover when:

- Sensor readings appear on the web dashboard with timestamps and device status.
- The system stores historical readings and relevant device events.
- Configured automation operates within validated limits.
- Invalid sensor readings cannot trigger unlimited dosing.
- N/P/K readings on the dashboard come from the NPK probe, and show as unavailable when
  the probe is faulted or not fitted — with pH/EC/climate/flow control still running.
- Automatic NPK dosing stays inside the configured burst cap and cooldown, is blocked
  whenever the NPK probe, pH or EC is invalid or EC is above target, and locks out that
  element with an alert after 3 bursts without reaching the band.
- pH and EC values are never displayed, stored, or reported as N, P, or K values.
- Low-flow detection works when a compatible flow sensor is installed.
- Remote commands are authenticated and have execution status.
- Local safety controls continue working without internet.
- The fan, misting, and irrigation pump operate according to verified hardware ratings and
  settings.
- The hybrid power arrangement operates safely under tested grid and solar conditions.
- The firmware, source code, wiring diagram, 3D model, and setup instructions are delivered
  as agreed.
