/*
 * ============================================================================
 *  HydroLT.ino — HYDROLYT ESP32 Controller
 * ----------------------------------------------------------------------------
 *  IoT-Based Vertical Hydroponic System for Sustainable Off-Season
 *  Cultivation of Cucumis melo (Melon)
 *
 *  Scope : one 4 x 5 m greenhouse, two vertical towers, one controller.
 *  Tasks : sensor acquisition (incl. NPK via RS485 Modbus probe),
 *          nutrient dosing (pH/EC + closed-loop N/P/K dosing),
 *          water-flow management, temperature/humidity control
 *          (exhaust fan + misting), MQTT telemetry & remote commands,
 *          local fail-safe automation.
 *
 *  Design rules:
 *    - Non-blocking, millis()-based main loop (no delay() in automation).
 *    - Local automation MUST keep working with no internet (FR-10).
 *    - Invalid pH/EC readings BLOCK dosing (no uncontrolled dosing).
 *    - Low flow after startup delay stops the irrigation pump.
 *    - Watchdog recovery on the main loop.
 *    - pH/EC never imply NPK content — nitrogen/phosphorus/potassium are
 *      measured ONLY by the dedicated RS485 NPK probe, never inferred.
 *    - NPK dosing is bounded (runtime cap + cooldown + no-progress lockout)
 *      and is blocked whenever the NPK probe is faulted, pH/EC is invalid,
 *      EC is already above target, or the solution is not circulating.
 *
 *  Libraries (Arduino Library Manager):
 *    - PubSubClient        (Nick O'Leary)
 *    - DHT sensor library  (Adafruit) + Adafruit Unified Sensor
 *    - ArduinoJson 7.x     (Benoit Blanchon)  — uses the JsonDocument API
 *    - (no extra library) the RS485 NPK probe is driven by a small Modbus
 *      RTU master implemented below on UART2 through a MAX485 transceiver.
 *
 *  Verified against: Arduino-ESP32 core 3.3.11, ArduinoJson 7.4.3, PubSubClient 2.8,
 *  compiled for FQBN esp32:esp32:esp32 (ESP32 Dev Module).
 *
 *  Board: ESP32 Dev Module.  Serial monitor: 115200 baud.
 * ============================================================================
 */

#include <WiFi.h>
#include <PubSubClient.h>
#include <DHT.h>
#include <ArduinoJson.h>
#include <Preferences.h>
#include <esp_task_wdt.h>
#if __has_include(<esp_idf_version.h>)
#include <esp_idf_version.h>   // ESP_IDF_VERSION_MAJOR (watchdog API differs on v4/v5)
#endif

// ===========================================================================
// 1. CONFIGURATION  — edit for your installation
// ===========================================================================

// --- Wi-Fi -----------------------------------------------------------------
static const char* WIFI_SSID     = "YOUR_WIFI_SSID";
static const char* WIFI_PASS     = "YOUR_WIFI_PASSWORD";
static const uint32_t WIFI_RETRY_MS = 15000UL;   // reconnect attempt interval

// --- MQTT ------------------------------------------------------------------
static const char*  MQTT_HOST = "192.168.1.10";  // broker address
static const uint16_t MQTT_PORT = 1883;
static const char*  MQTT_USER = "";              // optional
static const char*  MQTT_PASS = "";              // optional
static const char*  DEVICE_ID = "hydro-01";
static const uint32_t MQTT_RETRY_MS = 5000UL;
static const uint32_t TELEMETRY_MS = 5000UL;     // telemetry publish interval

// Topic helpers -> "hydro/<deviceId>/..."
#define TOPIC(suffix)  (String("hydro/") + DEVICE_ID + "/" + suffix).c_str()

// --- Pin map (ESP32 DevKit) -------------------------------------------------
// Analog sensors use ADC1 pins only (Wi-Fi blocks ADC2).
static const int PIN_PH_SENSOR    = 34;   // ADC1_6  pH divider/module (0..3.3V)
static const int PIN_EC_SENSOR    = 35;   // ADC1_7  EC module        (0..3.3V)
static const int PIN_DHT          = 4;    // DHT22 data
static const int PIN_FLOW         = 27;   // flow sensor pulse (interrupt)
static const int PIN_RELAY_PUMP   = 26;   // irrigation submersible pump (220V via relay)
static const int PIN_RELAY_FAN    = 25;   // exhaust fan      (220V via relay)
static const int PIN_RELAY_MIST   = 33;   // misting pump     (220V via relay)
static const int PIN_DOSE_A       = 32;   // peristaltic pump A (pH-up / nutrient)
static const int PIN_DOSE_B       = 14;   // peristaltic pump B (pH-down / acid)
static const int PIN_DOSE_N       = 18;   // peristaltic pump C (nitrogen source)
static const int PIN_DOSE_P       = 19;   // peristaltic pump D (phosphorus source)
static const int PIN_DOSE_K       = 21;   // peristaltic pump E (potassium source)
static const int PIN_STATUS_LED   = 2;

// --- NPK probe (RS485 Modbus RTU via MAX485) --------------------------------
// UART2 on GPIO16/17 — correct for a plain ESP32 Dev Module. Boards that use
// those pins for PSRAM must pick different UART2 pins before flashing.
static const bool     NPK_ENABLED          = true;     // false = probe not fitted
static const int      PIN_NPK_RX           = 16;       // UART2 RX <- MAX485 RO
static const int      PIN_NPK_TX           = 17;       // UART2 TX -> MAX485 DI
static const int      PIN_NPK_DE           = 13;       // MAX485 DE+RE (tied): HIGH = transmit
static const uint32_t NPK_BAUD             = 4800;     // probe default (check datasheet: 4800/9600)
static const uint8_t  NPK_SLAVE_ADDR       = 1;        // Modbus slave id (1..247)
static const uint32_t NPK_SAMPLE_MS        = 10000UL;  // poll cadence (probe is slow)
static const uint32_t NPK_RESP_TIMEOUT_MS  = 500UL;    // response timeout
static const uint8_t  NPK_FAIL_LIMIT       = 3;        // consecutive bad frames -> fault

// Relay logic: many cheap relay boards are ACTIVE-LOW.
static const bool RELAY_ACTIVE_LOW = true;

// --- Default control settings (overridable at runtime via MQTT/NVS) --------
static const float DEFAULT_PH_MIN          = 5.50f;  // melon optimal ~5.5–6.5
static const float DEFAULT_PH_MAX          = 6.50f;
static const float DEFAULT_EC_MIN          = 1.40f;  // mS/cm
static const float DEFAULT_EC_MAX          = 2.50f;
static const float DEFAULT_TEMP_SETPOINT   = 28.0f;  // fan ON at/above this (°C)
static const float DEFAULT_TEMP_HYST       = 2.0f;   // fan OFF at setpoint - hysteresis
static const float DEFAULT_HUM_LIMIT       = 85.0f;  // %RH
static const float DEFAULT_MIN_FLOW        = 2.0f;   // L/min minimum acceptable
static const uint32_t DEFAULT_FLOW_DELAY_MS = 10000UL; // startup grace before flow check
static const uint16_t DEFAULT_DOSE_MAX_MS    = 20000;  // hard cap per dosing cycle
static const uint16_t DEFAULT_DOSE_COOLDOWN_S= 60;     // min seconds between doses
static const uint16_t DEFAULT_MIX_WAIT_S     = 45;     // circulation before re-measure
static const uint16_t DEFAULT_MIST_MAX_S     = 120;    // max continuous misting
static const uint16_t DEFAULT_MIN_RUN_S      = 30;     // fan min run time
static const uint16_t DEFAULT_MIN_OFF_S      = 30;     // fan min off time

// --- NPK control settings (closed-loop dosing; mg/kg as reported by probe) --
// PLACEHOLDER bands — tune to the probe's units, the nutrient formulation and
// the melon feeding schedule before enabling unattended dosing.
static const float    DEFAULT_NPK_N_MIN = 80.0f,  DEFAULT_NPK_N_MAX = 160.0f;
static const float    DEFAULT_NPK_P_MIN = 20.0f,  DEFAULT_NPK_P_MAX = 50.0f;
static const float    DEFAULT_NPK_K_MIN = 100.0f, DEFAULT_NPK_K_MAX = 200.0f;
static const uint16_t DEFAULT_NPK_DOSE_MAX_MS     = 5000;   // hard cap per NPK burst
static const uint16_t DEFAULT_NPK_DOSE_COOLDOWN_S = 300;    // min seconds between NPK bursts
static const bool     DEFAULT_NPK_AUTO_DOSE       = true;   // kill switch (npk_dosing_enabled)
static const uint8_t  NPK_MAX_ATTEMPTS  = 3;      // no-progress bursts before lockout
static const uint32_t NPK_LOCKOUT_MS    = 1800000UL; // 30 min lockout after NPK_MAX_ATTEMPTS
static const uint32_t NPK_ALERT_THROTTLE_MS = 900000UL; // repeated fault alerts: 15 min

// --- Sensor validity windows (outside = fault) -----------------------------
static const float PH_VALID_MIN  = 0.0f,  PH_VALID_MAX  = 14.0f;
static const float EC_VALID_MIN  = 0.0f,  EC_VALID_MAX  = 20.0f;  // mS/cm
static const float TEMP_VALID_MIN = -10.0f, TEMP_VALID_MAX = 60.0f;
static const float HUM_VALID_MIN  = 0.0f,  HUM_VALID_MAX  = 100.0f;
static const float FLOW_VALID_MIN = 0.0f,  FLOW_VALID_MAX = 100.0f;
static const float NPK_VALID_MIN  = 0.0f,  NPK_VALID_MAX  = 9999.0f;  // mg/kg

// --- Calibration (two-point, raw ADC -> engineering units) -----------------
// pH: 4.00 buffer and 7.00 buffer raw readings. Replace after calibration.
static const float PH_RAW_AT_4   = 1150.0f;  // raw ADC at pH 4.00
static const float PH_RAW_AT_7   = 2050.0f;  // raw ADC at pH 7.00
// EC: raw at 0 (air/dry) and raw at a 1413 uS/cm (1.413 mS/cm) standard.
static const float EC_RAW_AT_0   = 300.0f;
static const float EC_RAW_AT_1413= 2600.0f;

// --- Timing ----------------------------------------------------------------
static const uint32_t SENSOR_SAMPLE_MS   = 1000UL;   // acquisition cadence
static const uint32_t AUTOMATION_MS      = 1000UL;   // control loop cadence
static const uint32_t WIFI_CHECK_MS      = 5000UL;
static const uint32_t STATE_PUBLISH_MS   = 3000UL;
static const uint32_t HEARTBEAT_MS       = 30000UL;
static const uint8_t  EMA_SAMPLES        = 8;        // smoothing depth

// ===========================================================================
// 2. TYPES & GLOBALS
// ===========================================================================

struct Settings {
  float phMin, phMax;
  float ecMin, ecMax;
  float tempSetpoint, tempHyst, humLimit;
  float minFlow;
  float npkNMin, npkNMax, npkPMin, npkPMax, npkKMin, npkKMax;
  uint32_t flowDelayMs;
  uint16_t doseMaxMs, doseCooldownS, mixWaitS, mistMaxS;
  uint16_t npkDoseMaxMs, npkDoseCooldownS;
  uint16_t minRunS, minOffS;
  bool npkAutoDose;
};

struct SensorData {
  float ph = NAN, ec = NAN, temp = NAN, hum = NAN, flow = 0.0f;
  float npkN = NAN, npkP = NAN, npkK = NAN;
  bool phOk = false, ecOk = false, climateOk = false, flowOk = false, npkOk = false;
  uint32_t lastSampleMs = 0;
};

enum OpMode { MODE_AUTO, MODE_MANUAL };

struct ActuatorState {
  bool pump = false, fan = false, misting = false, doseA = false, doseB = false;
  bool doseN = false, doseP = false, doseK = false;
  OpMode mode = MODE_AUTO;
};

Settings   cfg;
SensorData sens;
ActuatorState act;

// flow pulse bookkeeping
volatile uint32_t pulseCount = 0;
uint32_t lastFlowCalcMs = 0;

// dosing state machine
enum DoseState { DOSE_IDLE, DOSE_RUNNING, DOSE_MIXING };
enum DoseChannel { DOSE_CH_NONE, DOSE_CH_A, DOSE_CH_B, DOSE_CH_N, DOSE_CH_P, DOSE_CH_K };
DoseState doseState = DOSE_IDLE;
String   doseReason = "";
uint32_t doseStartMs = 0, doseMixStartMs = 0, lastDoseEndMs = 0;
uint16_t doseAppliedMs = 0;
uint16_t doseCycleLimitMs = DEFAULT_DOSE_MAX_MS;   // cap for the current cycle
uint32_t lastEcAlertMs = 0;                        // throttle for repeated EC warnings

// NPK dosing bookkeeping (index: 0 = N, 1 = P, 2 = K)
uint32_t lastNpkDoseEndMs = 0;      // separate cooldown from the fast pH/EC loop
uint8_t  npkAttempts[3] = {0, 0, 0};    // bursts applied without reaching the band
uint32_t npkLockoutUntilMs[3] = {0, 0, 0};  // 0 = no active lockout

// NPK probe (Modbus RTU master, non-blocking poll state machine)
enum NpkPollState { NPK_POLL_IDLE, NPK_POLL_WAIT };
NpkPollState npkPollState = NPK_POLL_IDLE;
uint32_t npkNextPollMs = 0, npkWaitStartMs = 0;
uint8_t  npkRxBuf[16];
uint8_t  npkRxLen = 0;
uint8_t  npkFails = 0;
uint32_t lastNpkFaultAlertMs = 0;

// pump / fan / mist timing guards
uint32_t pumpStartMs = 0;
bool     flowChecked = false;
uint32_t fanChangedMs = 0;
uint32_t mistStartMs = 0;

// networking
WiFiClient   wifiClient;
PubSubClient mqtt(wifiClient);
uint32_t lastWifiTryMs = 0, lastMqttTryMs = 0, lastTelemetryMs = 0;
uint32_t lastStateMs = 0, lastHeartbeatMs = 0;
bool     wifiWasConnected = false;

// runtime state shared by setup()/loop()
Preferences prefs;

// ===========================================================================
// 3. HELPERS
// ===========================================================================

void setRelay(int pin, bool on) {
  digitalWrite(pin, RELAY_ACTIVE_LOW ? (on ? LOW : HIGH) : (on ? HIGH : LOW));
}

float medianOf(const float* v, int n) {
  // simple insertion sort on a small buffer, returns median
  float tmp[EMA_SAMPLES];
  int c = n < EMA_SAMPLES ? n : EMA_SAMPLES;
  if (c <= 0) return NAN;
  if (c == 1) return v[0];
  for (int i = 0; i < c; i++) tmp[i] = v[i];
  for (int i = 1; i < c; i++) {
    float k = tmp[i]; int j = i - 1;
    while (j >= 0 && tmp[j] > k) { tmp[j + 1] = tmp[j]; j--; }
    tmp[j + 1] = k;
  }
  return c % 2 ? tmp[c / 2] : (tmp[c / 2 - 1] + tmp[c / 2]) / 2.0f;
}

bool validRange(float v, float lo, float hi) {
  return !isnan(v) && v >= lo && v <= hi;
}

/** Modbus RTU CRC-16 (poly 0xA001, reflected), low byte first on the wire. */
uint16_t modbusCrc(const uint8_t* d, uint8_t n) {
  uint16_t crc = 0xFFFF;
  for (uint8_t i = 0; i < n; i++) {
    crc ^= d[i];
    for (uint8_t b = 0; b < 8; b++)
      crc = (crc & 0x0001) ? (uint16_t)((crc >> 1) ^ 0xA001) : (uint16_t)(crc >> 1);
  }
  return crc;
}

/** Push one sample into a rolling buffer and return its median (see readPh). */
float medianSmooth(float v, float* buf, uint8_t& idx, bool& filled) {
  buf[idx] = v;
  idx = (uint8_t)((idx + 1) % EMA_SAMPLES);
  if (idx == 0) filled = true;
  int n = filled ? EMA_SAMPLES : idx;
  float tmp[EMA_SAMPLES];
  for (int i = 0; i < n; i++) tmp[i] = buf[i];
  return medianOf(tmp, n);
}

void logLine(const String& msg) {
  Serial.printf("[%8lu] %s\n", millis(), msg.c_str());
}

// ===========================================================================
// 4. SETTINGS PERSISTENCE (NVS)
// ===========================================================================

void loadSettings() {
  prefs.begin("hydro", false);
  cfg.phMin          = prefs.getFloat("phMin",   DEFAULT_PH_MIN);
  cfg.phMax          = prefs.getFloat("phMax",   DEFAULT_PH_MAX);
  cfg.ecMin          = prefs.getFloat("ecMin",   DEFAULT_EC_MIN);
  cfg.ecMax          = prefs.getFloat("ecMax",   DEFAULT_EC_MAX);
  cfg.tempSetpoint   = prefs.getFloat("tSet",    DEFAULT_TEMP_SETPOINT);
  cfg.tempHyst       = prefs.getFloat("tHyst",   DEFAULT_TEMP_HYST);
  cfg.humLimit       = prefs.getFloat("humLim",  DEFAULT_HUM_LIMIT);
  cfg.minFlow        = prefs.getFloat("minFlow", DEFAULT_MIN_FLOW);
  cfg.flowDelayMs    = prefs.getUInt("flowDly",  DEFAULT_FLOW_DELAY_MS);
  cfg.doseMaxMs      = prefs.getUShort("doseMax", DEFAULT_DOSE_MAX_MS);
  cfg.doseCooldownS  = prefs.getUShort("doseCool", DEFAULT_DOSE_COOLDOWN_S);
  cfg.mixWaitS       = prefs.getUShort("mixWait", DEFAULT_MIX_WAIT_S);
  cfg.mistMaxS       = prefs.getUShort("mistMax", DEFAULT_MIST_MAX_S);
  cfg.minRunS        = prefs.getUShort("minRun",  DEFAULT_MIN_RUN_S);
  cfg.minOffS        = prefs.getUShort("minOff",  DEFAULT_MIN_OFF_S);
  cfg.npkNMin        = prefs.getFloat("npkNMin",  DEFAULT_NPK_N_MIN);
  cfg.npkNMax        = prefs.getFloat("npkNMax",  DEFAULT_NPK_N_MAX);
  cfg.npkPMin        = prefs.getFloat("npkPMin",  DEFAULT_NPK_P_MIN);
  cfg.npkPMax        = prefs.getFloat("npkPMax",  DEFAULT_NPK_P_MAX);
  cfg.npkKMin        = prefs.getFloat("npkKMin",  DEFAULT_NPK_K_MIN);
  cfg.npkKMax        = prefs.getFloat("npkKMax",  DEFAULT_NPK_K_MAX);
  cfg.npkDoseMaxMs   = prefs.getUShort("npkDoseMax",  DEFAULT_NPK_DOSE_MAX_MS);
  cfg.npkDoseCooldownS = prefs.getUShort("npkDoseCool", DEFAULT_NPK_DOSE_COOLDOWN_S);
  cfg.npkAutoDose    = prefs.getBool("npkAuto", DEFAULT_NPK_AUTO_DOSE);
  act.mode           = prefs.getBool("autoMode", true) ? MODE_AUTO : MODE_MANUAL;
  prefs.end();

  // sanity clamps — a corrupt config must never allow uncontrolled dosing
  if (cfg.phMin >= cfg.phMax)   { cfg.phMin = DEFAULT_PH_MIN; cfg.phMax = DEFAULT_PH_MAX; }
  if (cfg.ecMin >= cfg.ecMax)   { cfg.ecMin = DEFAULT_EC_MIN; cfg.ecMax = DEFAULT_EC_MAX; }
  if (cfg.doseMaxMs == 0 || cfg.doseMaxMs > 60000) cfg.doseMaxMs = DEFAULT_DOSE_MAX_MS;
  if (cfg.minFlow < 0)          cfg.minFlow = DEFAULT_MIN_FLOW;
  if (cfg.npkNMin >= cfg.npkNMax || cfg.npkNMin < 0) { cfg.npkNMin = DEFAULT_NPK_N_MIN; cfg.npkNMax = DEFAULT_NPK_N_MAX; }
  if (cfg.npkPMin >= cfg.npkPMax || cfg.npkPMin < 0) { cfg.npkPMin = DEFAULT_NPK_P_MIN; cfg.npkPMax = DEFAULT_NPK_P_MAX; }
  if (cfg.npkKMin >= cfg.npkKMax || cfg.npkKMin < 0) { cfg.npkKMin = DEFAULT_NPK_K_MIN; cfg.npkKMax = DEFAULT_NPK_K_MAX; }
  if (cfg.npkDoseMaxMs == 0 || cfg.npkDoseMaxMs > 60000) cfg.npkDoseMaxMs = DEFAULT_NPK_DOSE_MAX_MS;
  if (cfg.npkDoseCooldownS < 30) cfg.npkDoseCooldownS = DEFAULT_NPK_DOSE_COOLDOWN_S;
}

void saveSettings() {
  prefs.begin("hydro", false);
  prefs.putFloat("phMin", cfg.phMin);     prefs.putFloat("phMax", cfg.phMax);
  prefs.putFloat("ecMin", cfg.ecMin);     prefs.putFloat("ecMax", cfg.ecMax);
  prefs.putFloat("tSet", cfg.tempSetpoint); prefs.putFloat("tHyst", cfg.tempHyst);
  prefs.putFloat("humLim", cfg.humLimit); prefs.putFloat("minFlow", cfg.minFlow);
  prefs.putUInt("flowDly", cfg.flowDelayMs);
  prefs.putUShort("doseMax", cfg.doseMaxMs);   prefs.putUShort("doseCool", cfg.doseCooldownS);
  prefs.putUShort("mixWait", cfg.mixWaitS);    prefs.putUShort("mistMax", cfg.mistMaxS);
  prefs.putUShort("minRun", cfg.minRunS);      prefs.putUShort("minOff", cfg.minOffS);
  prefs.putFloat("npkNMin", cfg.npkNMin);      prefs.putFloat("npkNMax", cfg.npkNMax);
  prefs.putFloat("npkPMin", cfg.npkPMin);      prefs.putFloat("npkPMax", cfg.npkPMax);
  prefs.putFloat("npkKMin", cfg.npkKMin);      prefs.putFloat("npkKMax", cfg.npkKMax);
  prefs.putUShort("npkDoseMax", cfg.npkDoseMaxMs);
  prefs.putUShort("npkDoseCool", cfg.npkDoseCooldownS);
  prefs.putBool("npkAuto", cfg.npkAutoDose);
  prefs.putBool("autoMode", act.mode == MODE_AUTO);
  prefs.end();
}

// ===========================================================================
// 5. SENSOR ACQUISITION (non-blocking, median + EMA smoothing)
// ===========================================================================

void IRAM_ATTR flowPulseISR() { pulseCount = pulseCount + 1; }   // C++20: ++ on volatile deprecated

float readPh() {
  static float buf[EMA_SAMPLES]; static uint8_t idx = 0; static bool filled = false;
  int raw = analogRead(PIN_PH_SENSOR);
  // linear two-point calibration between the pH 4.00 and pH 7.00 buffer points
  float ph = 7.0f + (raw - PH_RAW_AT_7) * (7.0f - 4.0f) / (PH_RAW_AT_4 - PH_RAW_AT_7);
  buf[idx] = ph; idx = (idx + 1) % EMA_SAMPLES; if (idx == 0) filled = true;
  int n = filled ? EMA_SAMPLES : idx;
  float sorted[EMA_SAMPLES];
  for (int i = 0; i < n; i++) sorted[i] = buf[i];
  return medianOf(sorted, n);
}

float readEc() {
  static float buf[EMA_SAMPLES]; static uint8_t idx = 0; static bool filled = false;
  int raw = analogRead(PIN_EC_SENSOR);
  // raw -> uS/cm via two-point calibration, then report mS/cm
  float us = (raw - EC_RAW_AT_0) * (1413.0f - 0.0f) / (EC_RAW_AT_1413 - EC_RAW_AT_0);
  if (us < 0) us = 0;
  float ms = us / 1000.0f;
  buf[idx] = ms; idx = (idx + 1) % EMA_SAMPLES; if (idx == 0) filled = true;
  int n = filled ? EMA_SAMPLES : idx;
  float sorted[EMA_SAMPLES];
  for (int i = 0; i < n; i++) sorted[i] = buf[i];
  return medianOf(sorted, n);
}

DHT dht(PIN_DHT, DHT22);

// --- NPK probe: Modbus RTU master on UART2 (RS485 via MAX485) --------------
// Request : addr, fn 0x03, register 0x0000, count 3  ->  N, P, K as mg/kg
// Response: addr fn bytecount(06) N N P P K K CRC16  = 11 bytes, CRC low first.
void publishAlert(const char* severity, const char* type, const String& msg);
void publishEvent(const char* eventType, const String& details);

void npkSendRequest() {
  uint8_t req[8] = { NPK_SLAVE_ADDR, 0x03, 0x00, 0x00, 0x00, 0x03, 0x00, 0x00 };
  uint16_t crc = modbusCrc(req, 6);
  req[6] = (uint8_t)(crc & 0xFF);
  req[7] = (uint8_t)(crc >> 8);

  digitalWrite(PIN_NPK_DE, HIGH);   // MAX485 DE+RE high = we drive the bus
  Serial2.write(req, sizeof(req));
  Serial2.flush();                  // ~17 ms at 4800 baud; last bit fully shifted out
  digitalWrite(PIN_NPK_DE, LOW);    // release the bus for the reply

  npkRxLen = 0;
  npkWaitStartMs = millis();
  npkPollState = NPK_POLL_WAIT;
}

void npkFinishFrame(uint32_t now) {
  npkPollState = NPK_POLL_IDLE;
  const uint8_t* b = npkRxBuf;

  bool ok = (npkRxLen == 11 && b[0] == NPK_SLAVE_ADDR && b[1] == 0x03 && b[2] == 0x06);
  if (ok) {
    uint16_t crc = modbusCrc(b, 9);
    ok = (b[9] == (uint8_t)(crc & 0xFF)) && (b[10] == (uint8_t)(crc >> 8));
  }

  float rawN = NAN, rawP = NAN, rawK = NAN;
  if (ok) {
    rawN = (float)((b[3] << 8) | b[4]);
    rawP = (float)((b[5] << 8) | b[6]);
    rawK = (float)((b[7] << 8) | b[8]);
    ok = validRange(rawN, NPK_VALID_MIN, NPK_VALID_MAX) &&
         validRange(rawP, NPK_VALID_MIN, NPK_VALID_MAX) &&
         validRange(rawK, NPK_VALID_MIN, NPK_VALID_MAX);
  }

  if (!ok) {
    if (npkFails < 255) npkFails++;
    if (npkFails >= NPK_FAIL_LIMIT &&
        (sens.npkOk || lastNpkFaultAlertMs == 0 ||
         now - lastNpkFaultAlertMs >= NPK_ALERT_THROTTLE_MS)) {
      lastNpkFaultAlertMs = now;
      sens.npkOk = false;
      sens.npkN = sens.npkP = sens.npkK = NAN;
      logLine(String("NPK PROBE FAULT (fails=") + npkFails + ", rxLen=" + npkRxLen + ")");
      publishAlert("critical", "npk_sensor_fault",
                   "No valid frame from the NPK probe. NPK dosing is blocked until the "
                   "probe recovers; pH/EC control is unaffected.");
    }
    return;
  }

  // valid frame -> smooth and store
  static float bN[EMA_SAMPLES]; static uint8_t iN = 0; static bool fN = false;
  static float bP[EMA_SAMPLES]; static uint8_t iP = 0; static bool fP = false;
  static float bK[EMA_SAMPLES]; static uint8_t iK = 0; static bool fK = false;
  float vN = medianSmooth(rawN, bN, iN, fN);
  float vP = medianSmooth(rawP, bP, iP, fP);
  float vK = medianSmooth(rawK, bK, iK, fK);

  bool wasOk = sens.npkOk;
  sens.npkN = vN;
  sens.npkP = vP;
  sens.npkK = vK;
  sens.npkOk = validRange(vN, NPK_VALID_MIN, NPK_VALID_MAX) &&
               validRange(vP, NPK_VALID_MIN, NPK_VALID_MAX) &&
               validRange(vK, NPK_VALID_MIN, NPK_VALID_MAX);
  npkFails = 0;

  if (!wasOk && sens.npkOk) {
    logLine(String("NPK probe online: N=") + String(vN, 1) +
            " P=" + String(vP, 1) + " K=" + String(vK, 1) + " mg/kg");
    publishEvent("npk_ok", "probe answering again");
  }
}

/** Called every loop pass (independent of the 1 s sample gate). */
void npkPollTick(uint32_t now) {
  if (!NPK_ENABLED) return;

  if (npkPollState == NPK_POLL_IDLE) {
    if ((int32_t)(now - npkNextPollMs) >= 0) {
      npkNextPollMs = now + NPK_SAMPLE_MS;
      npkSendRequest();
    }
    return;
  }

  while (npkRxLen < sizeof(npkRxBuf) && Serial2.available() > 0) {
    npkRxBuf[npkRxLen++] = (uint8_t)Serial2.read();
  }
  if (npkRxLen >= 11 || (now - npkWaitStartMs) >= NPK_RESP_TIMEOUT_MS) {
    npkFinishFrame(now);
  }
}

void sampleSensors() {
  uint32_t now = millis();
  if (now - sens.lastSampleMs < SENSOR_SAMPLE_MS) return;
  sens.lastSampleMs = now;

  // --- pH ---
  float ph = readPh();
  sens.phOk = validRange(ph, PH_VALID_MIN, PH_VALID_MAX);
  sens.ph   = sens.phOk ? ph : NAN;

  // --- EC ---
  float ec = readEc();
  sens.ecOk = validRange(ec, EC_VALID_MIN, EC_VALID_MAX);
  sens.ec   = sens.ecOk ? ec : NAN;

  // --- climate ---
  float t = dht.readTemperature();
  float h = dht.readHumidity();
  bool tOk = validRange(t, TEMP_VALID_MIN, TEMP_VALID_MAX);
  bool hOk = validRange(h, HUM_VALID_MIN, HUM_VALID_MAX);
  sens.climateOk = tOk && hOk;
  sens.temp = tOk ? t : NAN;
  sens.hum  = hOk ? h : NAN;

  // --- flow (pulses over the elapsed window -> L/min) ---
  uint32_t elapsed = now - lastFlowCalcMs;
  if (elapsed >= 1000) {
    noInterrupts();
    uint32_t pulses = pulseCount;
    pulseCount = 0;
    interrupts();
    // 450 pulses per litre is typical for a YF-S201; adjust for your sensor.
    float litres = pulses / 450.0f;
    float lpm = litres * 60000.0f / (float)elapsed;
    sens.flow   = lpm;
    sens.flowOk = validRange(lpm, FLOW_VALID_MIN, FLOW_VALID_MAX);
    lastFlowCalcMs = now;
  }
}

// ===========================================================================
// 6. ALERTS / EVENTS  (published over MQTT, mirrored to the web app)
// ===========================================================================

void publishAlert(const char* severity, const char* type, const String& msg) {
  logLine(String("ALERT [") + severity + "] " + type + ": " + msg);
  if (!mqtt.connected()) return;
  JsonDocument doc;
  doc["severity"] = severity;
  doc["type"]     = type;
  doc["msg"]      = msg;
  doc["ts"]       = millis();
  String out; serializeJson(doc, out);
  mqtt.publish(TOPIC("alert"), out.c_str(), false);
}

void publishEvent(const char* eventType, const String& details) {
  logLine(String("EVENT ") + eventType + " " + details);
  if (!mqtt.connected()) return;
  JsonDocument doc;
  doc["event"] = eventType;
  doc["details"] = details;
  doc["ts"] = millis();
  String out; serializeJson(doc, out);
  mqtt.publish(TOPIC("event"), out.c_str(), false);
}

// ===========================================================================
// 7. SAFETY: pumps & actuators
// ===========================================================================

void stopAllDosing(const char* why) {
  if (act.doseA || act.doseB || act.doseN || act.doseP || act.doseK) {
    act.doseA = act.doseB = act.doseN = act.doseP = act.doseK = false;
    setRelay(PIN_DOSE_A, false);
    setRelay(PIN_DOSE_B, false);
    setRelay(PIN_DOSE_N, false);
    setRelay(PIN_DOSE_P, false);
    setRelay(PIN_DOSE_K, false);
    logLine(String("DOSING STOPPED: ") + why);
  }
  doseState = DOSE_IDLE;
}

/** Exactly one dose channel may be energised at a time (pH/EC and NPK share
 *  this rule, so nutrient + pH corrections can never overlap). */
void setDoseChannel(DoseChannel ch) {
  act.doseA = (ch == DOSE_CH_A);
  act.doseB = (ch == DOSE_CH_B);
  act.doseN = (ch == DOSE_CH_N);
  act.doseP = (ch == DOSE_CH_P);
  act.doseK = (ch == DOSE_CH_K);
  setRelay(PIN_DOSE_A, act.doseA);
  setRelay(PIN_DOSE_B, act.doseB);
  setRelay(PIN_DOSE_N, act.doseN);
  setRelay(PIN_DOSE_P, act.doseP);
  setRelay(PIN_DOSE_K, act.doseK);
}

void stopIrrigation(const char* why) {
  if (act.pump) {
    act.pump = false;
    setRelay(PIN_RELAY_PUMP, false);
    logLine(String("IRRIGATION PUMP STOPPED: ") + why);
  }
  flowChecked = false;
}

// ===========================================================================
// 8. AUTOMATION A — NUTRIENT DOSING
//    pH/EC correction + closed-loop N/P/K dosing. NPK values come ONLY from
//    the RS485 probe and are never inferred from pH or EC. (requirements.md §4.A)
//
//    NPK fail-safes (each one independently blocks a burst):
//      - AUTO mode, solution circulating, pH AND EC readings valid
//      - NPK probe healthy (npkOk) and the npk_dosing_enabled kill switch on
//      - EC not already above target (adding salt would make it worse)
//      - NPK cooldown elapsed, per element
//      - element below its band (above target = alert only, no dosing)
//      - bounded burst (npkDoseMaxMs) + mix/re-measure, then re-evaluate
//      - no-progress lockout: after NPK_MAX_ATTEMPTS bursts without reaching
//        the band, that element is locked out for NPK_LOCKOUT_MS + alert
// ===========================================================================

int npkElementOf(const String& reason) {   // 0 = N, 1 = P, 2 = K, -1 = not NPK
  if (reason.startsWith("npk_n")) return 0;
  if (reason.startsWith("npk_p")) return 1;
  if (reason.startsWith("npk_k")) return 2;
  return -1;
}

const char* npkElementName(int idx) { return idx == 0 ? "N" : idx == 1 ? "P" : "K"; }

float npkElementValue(int idx) { return idx == 0 ? sens.npkN : idx == 1 ? sens.npkP : sens.npkK; }

float npkElementMin(int idx) { return idx == 0 ? cfg.npkNMin : idx == 1 ? cfg.npkPMin : cfg.npkKMin; }

/** Judge a completed NPK burst: reaching the band resets the attempt counter,
 *  not reaching it counts toward the no-progress lockout. */
void npkNoteResult(uint32_t now, int idx) {
  if (idx < 0 || idx > 2) return;
  if (!sens.npkOk) return;                       // can't judge without a reading
  if (!doseReason.endsWith("_low")) return;      // only automatic bursts count toward lockout

  float val = npkElementValue(idx);
  if (validRange(val, NPK_VALID_MIN, NPK_VALID_MAX) && val >= npkElementMin(idx)) {
    npkAttempts[idx] = 0;
    npkLockoutUntilMs[idx] = 0;
    return;
  }
  if (npkAttempts[idx] < 255) npkAttempts[idx]++;
  if (npkAttempts[idx] >= NPK_MAX_ATTEMPTS) {
    npkAttempts[idx] = 0;
    npkLockoutUntilMs[idx] = now + NPK_LOCKOUT_MS;
    publishAlert("warning", "npk_dosing_no_response",
                 String(npkElementName(idx)) +
                 " is still below target after 3 bounded bursts — automatic NPK dosing for "
                 "this element is paused for 30 min. Check the probe reading and the "
                 "formulation before it resumes.");
  }
}

/** Pick the element furthest below its band and start ONE bounded burst. */
void npkDecide(uint32_t now) {
  if (!NPK_ENABLED || !cfg.npkAutoDose) return;   // kill switch / probe not fitted
  if (!sens.npkOk) return;                        // never dose blind
  if (sens.ec > cfg.ecMax) return;                // solution already too concentrated
  if (lastNpkDoseEndMs &&
      (now - lastNpkDoseEndMs) < (uint32_t)cfg.npkDoseCooldownS * 1000UL) return;

  int worst = -1;
  float worstFrac = 0.0f;
  for (int i = 0; i < 3; i++) {
    float val = npkElementValue(i);
    if (!validRange(val, NPK_VALID_MIN, NPK_VALID_MAX)) continue;
    if (val >= npkElementMin(i)) {                 // in band -> clear progress bookkeeping
      npkAttempts[i] = 0;
      npkLockoutUntilMs[i] = 0;
      continue;
    }
    if (npkLockoutUntilMs[i] != 0) {
      if ((int32_t)(now - npkLockoutUntilMs[i]) < 0) continue;   // still locked out
      npkLockoutUntilMs[i] = 0;                                 // lockout expired
    }
    float frac = (npkElementMin(i) - val) / (npkElementMin(i) > 1.0f ? npkElementMin(i) : 1.0f);
    if (frac > worstFrac) { worstFrac = frac; worst = i; }
  }
  if (worst < 0) return;

  doseReason      = (worst == 0) ? "npk_n_low" : (worst == 1) ? "npk_p_low" : "npk_k_low";
  doseAppliedMs   = 0;
  doseCycleLimitMs = cfg.npkDoseMaxMs;
  doseStartMs     = now;
  doseState       = DOSE_RUNNING;
  lastNpkDoseEndMs = now;                         // cooldown starts with the burst
  setDoseChannel(worst == 0 ? DOSE_CH_N : worst == 1 ? DOSE_CH_P : DOSE_CH_K);
  logLine(String("NPK DOSING START ") + doseReason +
          " value=" + String(npkElementValue(worst), 1) +
          " target_min=" + String(npkElementMin(worst), 1) +
          " cap=" + cfg.npkDoseMaxMs + "ms");
}

void automationDosing(uint32_t now) {
  // Fail-safe gates ------------------------------------------------------
  if (doseState == DOSE_IDLE) {
    if (act.mode != MODE_AUTO) return;                    // manual mode: no auto dosing
    if (!sens.phOk || !sens.ecOk) return;                 // invalid sensors: no dosing
    if (act.pump == false) return;                        // circulate first

    // pH/EC correction has priority (fast loop); its own cooldown applies.
    bool phDue = (lastDoseEndMs == 0 ||
                  (now - lastDoseEndMs) >= (uint32_t)cfg.doseCooldownS * 1000UL);

    String reason = "";
    DoseChannel channel = DOSE_CH_NONE;

    if (phDue) {
      if (sens.ph > cfg.phMax)      { reason = "ph_high"; channel = DOSE_CH_B; }
      else if (sens.ph < cfg.phMin) { reason = "ph_low";  channel = DOSE_CH_A; }
      else if (sens.ec > cfg.ecMax) { reason = "ec_high"; /* dilute: no pump, alert only */ }
      else if (sens.ec < cfg.ecMin) { reason = "ec_low";  channel = DOSE_CH_A; }
    }

    if (reason == "ec_high") {
      // Throttled: EC high needs a manual flush/dilute — and NPK dosing is
      // paused too, because adding more salt would raise EC further.
      if (lastEcAlertMs == 0 || (now - lastEcAlertMs) >= 900000UL) {
        lastEcAlertMs = now;
        publishAlert("warning", "ec_high",
                     "EC above target. Flush/dilute manually — pH and NPK dosing are paused "
                     "while EC stays above the limit.");
      }
      lastDoseEndMs = now;
      return;
    }

    if (reason != "") {
      // start a bounded pH/EC dose cycle
      doseReason      = reason;
      doseAppliedMs   = 0;
      doseCycleLimitMs = cfg.doseMaxMs;
      doseStartMs     = now;
      doseState       = DOSE_RUNNING;
      setDoseChannel(channel);
      logLine(String("DOSING START reason=") + reason);
      return;
    }

    npkDecide(now);   // nothing pH/EC to correct -> consider a bounded NPK burst
    return;
  }

  if (doseState == DOSE_RUNNING) {
    uint32_t runtime = now - doseStartMs;
    int npkIdx = npkElementOf(doseReason);
    bool sensorLost = (doseReason.startsWith("ph") && !sens.phOk) ||
                      (doseReason.startsWith("ec") && !sens.ecOk) ||
                      (npkIdx >= 0 && !sens.npkOk);

    if (sensorLost) {                                  // fail-safe mid-dose
      stopAllDosing("sensor lost during dosing");
      publishAlert("critical", "dosing_fault",
                   "Sensor invalid during dosing — cycle aborted.");
      lastDoseEndMs = now;
      doseState = DOSE_MIXING; doseMixStartMs = now;
      return;
    }
    if (runtime >= doseCycleLimitMs) {                // hard runtime cap
      if (npkIdx >= 0) {
        // An NPK burst hitting its cap is normal bounded operation, not a fault.
        stopAllDosing("NPK burst limit reached");
        logLine(String("NPK burst complete: ") + doseReason + " (" + doseAppliedMs + " ms)");
      } else {
        stopAllDosing("max runtime reached");
        publishAlert("warning", "dosing_limit",
                     "Dosing stopped at configured max runtime. Check solution response.");
      }
      lastDoseEndMs = now;
      doseState = DOSE_MIXING; doseMixStartMs = now;
      return;
    }
    doseAppliedMs = (uint16_t)runtime;
    return;
  }

  if (doseState == DOSE_MIXING) {                      // circulate, then re-measure
    if (now - doseMixStartMs >= (uint32_t)cfg.mixWaitS * 1000UL) {
      doseState = DOSE_IDLE;
      int npkIdx = npkElementOf(doseReason);
      if (npkIdx >= 0) {
        npkNoteResult(now, npkIdx);                    // progress check / lockout
      } else if (sens.phOk && (sens.ph > cfg.phMax || sens.ph < cfg.phMin)) {
        // pH stall detection: if still out of range, alert (no endless dosing)
        publishAlert("warning", "dosing_no_response",
                     "pH still out of range after dosing — check formulation/probe calibration.");
      }
    }
  }
}

// ===========================================================================
// 9. AUTOMATION B — WATER-FLOW MANAGEMENT  (requirements.md §4.B)
// ===========================================================================

void automationFlow(uint32_t now) {
  if (!act.pump) { flowChecked = false; pumpStartMs = 0; return; }

  if (pumpStartMs == 0) pumpStartMs = now;
  uint32_t runtime = now - pumpStartMs;

  if (!flowChecked && runtime >= cfg.flowDelayMs) {
    flowChecked = true;
    if (sens.flow < cfg.minFlow) {
      stopIrrigation("low flow detected");
      publishAlert("critical", "low_flow",
                   String("Flow ") + String(sens.flow, 2) +
                   " L/min below minimum " + String(cfg.minFlow, 2) +
                   " L/min - pump stopped. Check tubing, filter, and water level.");
      return;
    }
    logLine(String("Flow OK: ") + String(sens.flow, 2) + " L/min");
  }

  // continuous low-flow guard once validated
  if (flowChecked && sens.flowOk && sens.flow < cfg.minFlow * 0.5f) {
    stopIrrigation("flow collapsed during operation");
    publishAlert("critical", "low_flow",
                 "Flow collapsed to less than half the minimum — pump stopped.");
  }
}

// ===========================================================================
// 10. AUTOMATION C — TEMPERATURE / HUMIDITY  (requirements.md §4.C)
// ===========================================================================

void automationClimate(uint32_t now) {
  if (!sens.climateOk) {
    // sensor failure: safe default — stop misting (water/safety), leave fan off
    if (act.misting) {
      act.misting = false; setRelay(PIN_RELAY_MIST, false);
      publishAlert("critical", "sensor_fault",
                   "Climate sensor invalid — misting disabled for safety.");
    }
    return;
  }

  float t = sens.temp, h = sens.hum;

  // ---- exhaust fan with hysteresis + min run/off times ----
  bool wantFan = act.fan;
  if (!act.fan && t >= cfg.tempSetpoint)              wantFan = true;
  else if (act.fan && t <= (cfg.tempSetpoint - cfg.tempHyst)) wantFan = false;

  if (wantFan != act.fan) {
    uint32_t sinceChange = fanChangedMs ? (now - fanChangedMs) : 0xFFFFFFFFUL;
    uint32_t minMs = (act.fan ? cfg.minOffS : cfg.minRunS) * 1000UL;
    if (sinceChange >= minMs) {
      act.fan = wantFan;
      setRelay(PIN_RELAY_FAN, act.fan);
      fanChangedMs = now;
      logLine(String("FAN ") + (act.fan ? "ON" : "OFF") + " at " + String(t, 1) + " C");
    }
  }

  // ---- misting: only when hot AND not already humid, with hard caps ----
  bool permit = (t >= cfg.tempSetpoint) && (h < cfg.humLimit) && act.fan;

  if (act.misting) {
    uint32_t onMs = now - mistStartMs;
    if (!permit || onMs >= (uint32_t)cfg.mistMaxS * 1000UL) {
      act.misting = false; setRelay(PIN_RELAY_MIST, false);
      logLine(String("MISTING OFF after ") + (onMs / 1000) + " s");
      // misting requires a cooldown equal to its max run before it may restart
      mistStartMs = now;   // reused as "off timestamp"
    }
  } else {
    bool cooldownDone = (now - mistStartMs) >= (uint32_t)cfg.mistMaxS * 1000UL;
    if (permit && cooldownDone && h < (cfg.humLimit - 5.0f)) {
      act.misting = true; setRelay(PIN_RELAY_MIST, true);
      mistStartMs = now;
      logLine(String("MISTING ON at ") + String(t, 1) + " C / " + String(h, 0) + " %RH");
    }
  }
}

// ===========================================================================
// 11. TELEMETRY & STATE PUBLISHING
// ===========================================================================

void publishTelemetry() {
  if (!mqtt.connected()) return;
  JsonDocument doc;
  doc["ts"]   = millis();
  if (sens.phOk)   doc["ph"]   = sens.ph;
  if (sens.ecOk)   doc["ec"]   = sens.ec;
  if (!isnan(sens.temp)) doc["temp"] = sens.temp;
  if (!isnan(sens.hum))  doc["hum"]  = sens.hum;
  if (sens.npkOk) {
    doc["npk_n"] = sens.npkN;
    doc["npk_p"] = sens.npkP;
    doc["npk_k"] = sens.npkK;
  }
  doc["flow"] = sens.flow;
  JsonObject flags = doc["flags"].to<JsonObject>();
  flags["ph"] = sens.phOk; flags["ec"] = sens.ecOk;
  flags["climate"] = sens.climateOk; flags["flow"] = sens.flowOk;
  flags["npk"] = sens.npkOk;
  String out; serializeJson(doc, out);
  mqtt.publish(TOPIC("telemetry"), out.c_str(), false);
}

void publishState() {
  if (!mqtt.connected()) return;
  JsonDocument doc;
  doc["pump"]    = act.pump ? 1 : 0;
  doc["fan"]     = act.fan ? 1 : 0;
  doc["misting"] = act.misting ? 1 : 0;
  doc["doseA"]   = act.doseA ? 1 : 0;
  doc["doseB"]   = act.doseB ? 1 : 0;
  doc["doseN"]   = act.doseN ? 1 : 0;
  doc["doseP"]   = act.doseP ? 1 : 0;
  doc["doseK"]   = act.doseK ? 1 : 0;
  doc["npk_ok"]  = sens.npkOk ? 1 : 0;
  doc["mode"]    = (act.mode == MODE_AUTO) ? "auto" : "manual";
  doc["doseState"] = (doseState == DOSE_IDLE) ? "idle"
                    : (doseState == DOSE_RUNNING) ? "running" : "mixing";
  String out; serializeJson(doc, out);
  mqtt.publish(TOPIC("state"), out.c_str(), true);   // retained
}

void publishSettings() {
  if (!mqtt.connected()) return;
  JsonDocument doc;
  doc["ph_min"] = cfg.phMin;
  doc["ph_max"] = cfg.phMax;
  doc["ec_min"] = cfg.ecMin;
  doc["ec_max"] = cfg.ecMax;
  doc["temperature_setpoint"] = cfg.tempSetpoint;
  doc["temperature_hysteresis"] = cfg.tempHyst;
  doc["humidity_limit"] = cfg.humLimit;
  doc["min_flow_rate"] = cfg.minFlow;
  doc["dosing_max_runtime_s"] = cfg.doseMaxMs / 1000;
  doc["dosing_cooldown_s"] = cfg.doseCooldownS;
  doc["misting_max_s"] = cfg.mistMaxS;
  doc["npk_n_min"] = cfg.npkNMin;
  doc["npk_n_max"] = cfg.npkNMax;
  doc["npk_p_min"] = cfg.npkPMin;
  doc["npk_p_max"] = cfg.npkPMax;
  doc["npk_k_min"] = cfg.npkKMin;
  doc["npk_k_max"] = cfg.npkKMax;
  doc["npk_dosing_max_runtime_s"] = cfg.npkDoseMaxMs / 1000;
  doc["npk_dose_cooldown_s"] = cfg.npkDoseCooldownS;
  doc["npk_dosing_enabled"] = cfg.npkAutoDose ? 1 : 0;
  String out; serializeJson(doc, out);
  mqtt.publish(TOPIC("settings"), out.c_str(), true);
}

// ===========================================================================
// 12. MQTT COMMAND HANDLING  — validated input (FR-07 / FR-10 / FR-12)
// ===========================================================================

void sendAck(const String& id, const char* status, const String& note = "") {
  if (!mqtt.connected() || id == "") return;
  JsonDocument doc;
  doc["cmd_id"] = id;
  doc["status"] = status;
  if (note.length()) doc["note"] = note;
  String out; serializeJson(doc, out);
  mqtt.publish(TOPIC("ack"), out.c_str(), false);
  String noteText = note.length() ? String(" (") + note + ")" : String("");
  logLine(String("ACK ") + id + " -> " + status + noteText);
}

bool manualAllowed(const String& id) {
  if (act.mode != MODE_MANUAL) {
    sendAck(id, "rejected", "device is in AUTO mode");
    return false;
  }
  return true;
}

void handleCommand(const char* payload, unsigned int length) {
  JsonDocument doc;
  DeserializationError err = deserializeJson(doc, payload, length);
  if (err) {
    publishAlert("warning", "bad_command", "Malformed command payload rejected.");
    return;
  }
  const char* cmd  = doc["cmd"] | "";
  String id        = doc["id"] | "";
  uint32_t now     = millis();

  if (strcmp(cmd, "pump") == 0) {
    if (!manualAllowed(id)) return;
    bool v = doc["value"] | false;
    if (v) { act.pump = true;  setRelay(PIN_RELAY_PUMP, true);  pumpStartMs = now; flowChecked = false; }
    else   stopIrrigation("manual off");
    sendAck(id, "ok");

  } else if (strcmp(cmd, "fan") == 0) {
    if (!manualAllowed(id)) return;
    bool v = doc["value"] | false;
    act.fan = v; setRelay(PIN_RELAY_FAN, v); fanChangedMs = now;
    sendAck(id, "ok");

  } else if (strcmp(cmd, "misting") == 0) {
    if (!manualAllowed(id)) return;
    bool v = doc["value"] | false;
    if (v && (!sens.climateOk || sens.hum >= cfg.humLimit)) {
      sendAck(id, "rejected", "climate sensor invalid or humidity at/above limit");
      return;
    }
    act.misting = v; setRelay(PIN_RELAY_MIST, v);
    if (v) mistStartMs = now;
    sendAck(id, "ok");

  } else if (strcmp(cmd, "mode") == 0) {
    String v = doc["value"] | "auto";
    if (v != "auto" && v != "manual") { sendAck(id, "rejected", "mode must be auto|manual"); return; }
    act.mode = (v == "auto") ? MODE_AUTO : MODE_MANUAL;
    if (act.mode == MODE_AUTO) {
      stopIrrigation("entering auto mode"); stopAllDosing("entering auto mode");
      act.fan = false; act.misting = false;
      setRelay(PIN_RELAY_FAN, false); setRelay(PIN_RELAY_MIST, false);
    }
    saveSettings();
    sendAck(id, "ok");
    publishState();

  } else if (strcmp(cmd, "settings") == 0) {
    JsonObject s = doc["settings"].as<JsonObject>();
    if (s.isNull()) { sendAck(id, "rejected", "missing settings object"); return; }
    // ArduinoJson 7: JsonObject::containsKey() is deprecated -> variant isNull()
    auto has = [&s](const char* key) { return !s[key].isNull(); };
    if (has("ph_min") && has("ph_max")) {
      float a = s["ph_min"] | (float)DEFAULT_PH_MIN, b = s["ph_max"] | (float)DEFAULT_PH_MAX;
      if (a >= b || a < 0 || b > 14) { sendAck(id, "rejected", "invalid pH range"); return; }
      cfg.phMin = a; cfg.phMax = b;
    }
    if (has("ec_min") && has("ec_max")) {
      float a = s["ec_min"] | (float)DEFAULT_EC_MIN, b = s["ec_max"] | (float)DEFAULT_EC_MAX;
      if (a >= b || a < 0) { sendAck(id, "rejected", "invalid EC range"); return; }
      cfg.ecMin = a; cfg.ecMax = b;
    }
    if (has("temperature_setpoint")) {
      float v = s["temperature_setpoint"] | DEFAULT_TEMP_SETPOINT;
      if (v < 10 || v > 50) { sendAck(id, "rejected", "temperature_setpoint out of 10-50 C"); return; }
      cfg.tempSetpoint = v;
    }
    if (has("humidity_limit")) {
      float v = s["humidity_limit"] | DEFAULT_HUM_LIMIT;
      if (v < 30 || v > 99) { sendAck(id, "rejected", "humidity_limit out of 30-99"); return; }
      cfg.humLimit = v;
    }
    if (has("min_flow_rate")) {
      float v = s["min_flow_rate"] | DEFAULT_MIN_FLOW;
      if (v < 0 || v > 50) { sendAck(id, "rejected", "min_flow_rate out of range"); return; }
      cfg.minFlow = v;
    }
    if (has("dosing_max_runtime_s")) {
      int v = s["dosing_max_runtime_s"] | (int)(DEFAULT_DOSE_MAX_MS / 1000);
      if (v <= 0 || v > 60) { sendAck(id, "rejected", "dosing_max_runtime_s out of 1-60"); return; }
      cfg.doseMaxMs = (uint16_t)(v * 1000);
    }
    if (has("dosing_cooldown_s")) {
      int v = s["dosing_cooldown_s"] | (int)DEFAULT_DOSE_COOLDOWN_S;
      if (v < 5 || v > 3600) { sendAck(id, "rejected", "dosing_cooldown_s out of 5-3600"); return; }
      cfg.doseCooldownS = (uint16_t)v;
    }
    if (has("misting_max_s")) {
      int v = s["misting_max_s"] | (int)DEFAULT_MIST_MAX_S;
      if (v < 10 || v > 900) { sendAck(id, "rejected", "misting_max_s out of 10-900"); return; }
      cfg.mistMaxS = (uint16_t)v;
    }
    if (has("npk_n_min") && has("npk_n_max")) {
      float a = s["npk_n_min"] | (float)DEFAULT_NPK_N_MIN, b = s["npk_n_max"] | (float)DEFAULT_NPK_N_MAX;
      if (a >= b || a < 0 || b > NPK_VALID_MAX) { sendAck(id, "rejected", "invalid N band (mg/kg)"); return; }
      cfg.npkNMin = a; cfg.npkNMax = b;
    }
    if (has("npk_p_min") && has("npk_p_max")) {
      float a = s["npk_p_min"] | (float)DEFAULT_NPK_P_MIN, b = s["npk_p_max"] | (float)DEFAULT_NPK_P_MAX;
      if (a >= b || a < 0 || b > NPK_VALID_MAX) { sendAck(id, "rejected", "invalid P band (mg/kg)"); return; }
      cfg.npkPMin = a; cfg.npkPMax = b;
    }
    if (has("npk_k_min") && has("npk_k_max")) {
      float a = s["npk_k_min"] | (float)DEFAULT_NPK_K_MIN, b = s["npk_k_max"] | (float)DEFAULT_NPK_K_MAX;
      if (a >= b || a < 0 || b > NPK_VALID_MAX) { sendAck(id, "rejected", "invalid K band (mg/kg)"); return; }
      cfg.npkKMin = a; cfg.npkKMax = b;
    }
    if (has("npk_dosing_max_runtime_s")) {
      int v = s["npk_dosing_max_runtime_s"] | (int)(DEFAULT_NPK_DOSE_MAX_MS / 1000);
      if (v <= 0 || v > 60) { sendAck(id, "rejected", "npk_dosing_max_runtime_s out of 1-60"); return; }
      cfg.npkDoseMaxMs = (uint16_t)(v * 1000);
    }
    if (has("npk_dose_cooldown_s")) {
      int v = s["npk_dose_cooldown_s"] | (int)DEFAULT_NPK_DOSE_COOLDOWN_S;
      if (v < 30 || v > 3600) { sendAck(id, "rejected", "npk_dose_cooldown_s out of 30-3600"); return; }
      cfg.npkDoseCooldownS = (uint16_t)v;
    }
    if (has("npk_dosing_enabled")) {
      bool v = s["npk_dosing_enabled"] | DEFAULT_NPK_AUTO_DOSE;
      cfg.npkAutoDose = v;
      if (!v) logLine("NPK automatic dosing disabled (kill switch)");
    }
    saveSettings();
    publishSettings();
    sendAck(id, "ok");

  } else if (strcmp(cmd, "dose") == 0) {
    if (!manualAllowed(id)) return;
    if (!sens.phOk || !sens.ecOk) { sendAck(id, "rejected", "invalid sensors — dosing blocked"); return; }
    String which = doc["value"] | "";
    bool isNpk = (which == "N" || which == "P" || which == "K");
    if (which != "A" && which != "B" && !isNpk) {
      sendAck(id, "rejected", "value must be A, B, N, P or K"); return;
    }
    if (isNpk) {
      if (!NPK_ENABLED)         { sendAck(id, "rejected", "NPK probe not fitted"); return; }
      if (!sens.npkOk)          { sendAck(id, "rejected", "NPK probe not ready — dosing blocked"); return; }
    }
    uint16_t cap = isNpk ? cfg.npkDoseMaxMs : cfg.doseMaxMs;
    uint16_t ms = doc["duration_ms"] | 3000;
    if (ms == 0 || ms > cap) { sendAck(id, "rejected", "duration exceeds the configured cap"); return; }
    stopAllDosing("manual dose requested");
    doseReason = isNpk ? String("npk_") + (which == "N" ? "n" : which == "P" ? "p" : "k") + "_manual"
                       : String("manual");
    doseStartMs = now; doseState = DOSE_RUNNING;
    doseCycleLimitMs = ms;
    setDoseChannel(which == "A" ? DOSE_CH_A : which == "B" ? DOSE_CH_B
                  : which == "N" ? DOSE_CH_N : which == "P" ? DOSE_CH_P : DOSE_CH_K);
    sendAck(id, "ok");

  } else if (strcmp(cmd, "restart") == 0) {
    sendAck(id, "ok", "restarting");
    mqtt.publish(TOPIC("status"), "offline", true);
    delay(300);
    ESP.restart();

  } else {
    sendAck(id, "rejected", "unknown command");
  }

  publishState();
}

void onMqttMessage(char* topic, byte* payload, unsigned int length) {
  handleCommand((const char*)payload, length);
}

// ===========================================================================
// 13. CONNECTIVITY (Wi-Fi + MQTT) — never blocks local automation
// ===========================================================================

void maintainWifi(uint32_t now) {
  if (WiFi.status() == WL_CONNECTED) {
    if (!wifiWasConnected) {
      wifiWasConnected = true;
      logLine(String("WiFi connected: ") + WiFi.localIP().toString());
      publishEvent("wifi_up", WiFi.localIP().toString());
    }
    return;
  }
  if (wifiWasConnected) {
    wifiWasConnected = false;
    logLine("WiFi lost — local automation continues");
    publishEvent("wifi_loss", "continuing local automation");
  }
  if (now - lastWifiTryMs >= WIFI_RETRY_MS) {
    lastWifiTryMs = now;
    WiFi.disconnect();
    WiFi.begin(WIFI_SSID, WIFI_PASS);
    logLine("WiFi: connecting...");
  }
}

void maintainMqtt(uint32_t now) {
  if (WiFi.status() != WL_CONNECTED) return;
  if (mqtt.connected()) { mqtt.loop(); return; }
  if (now - lastMqttTryMs < MQTT_RETRY_MS) return;
  lastMqttTryMs = now;

  String clientId = String(DEVICE_ID) + "-" + String((uint32_t)esp_random(), HEX);
  String willTopic = TOPIC("status");
  bool ok;
  if (strlen(MQTT_USER) > 0)
    ok = mqtt.connect(clientId.c_str(), MQTT_USER, MQTT_PASS, willTopic.c_str(), 1, true, "offline");
  else
    ok = mqtt.connect(clientId.c_str(), willTopic.c_str(), 1, true, "offline");

  if (ok) {
    logLine(String("MQTT connected to ") + MQTT_HOST);
    mqtt.publish(willTopic.c_str(), "online", true);
    mqtt.subscribe(TOPIC("cmd"));
    mqtt.subscribe(TOPIC("settings"));
    publishSettings();
    publishState();
    publishEvent("boot", String("reset_reason=") + (int)esp_reset_reason());
  } else {
    logLine(String("MQTT connect failed rc=") + mqtt.state());
  }
}

// ===========================================================================
// 14. SETUP / LOOP
// ===========================================================================

void setup() {
  Serial.begin(115200);
  delay(200);
  Serial.println();
  Serial.println("=====================================================");
  Serial.println(" HYDROLYT / HydroLT — ESP32 vertical hydroponic ctrlr");
  Serial.println(String(" device: ") + DEVICE_ID);
  Serial.println("=====================================================");

  // outputs — write inactive state BEFORE pinMode to avoid relay glitching
  bool off = RELAY_ACTIVE_LOW ? HIGH : LOW;
  const int outputPins[] = {PIN_RELAY_PUMP, PIN_RELAY_FAN, PIN_RELAY_MIST,
                            PIN_DOSE_A, PIN_DOSE_B,
                            PIN_DOSE_N, PIN_DOSE_P, PIN_DOSE_K};
  for (size_t i = 0; i < sizeof(outputPins) / sizeof(outputPins[0]); i++) {
    digitalWrite(outputPins[i], off);
    pinMode(outputPins[i], OUTPUT);
  }
  pinMode(PIN_STATUS_LED, OUTPUT);
  digitalWrite(PIN_STATUS_LED, LOW);

  // sensors
  dht.begin();
  analogReadResolution(12);
  pinMode(PIN_FLOW, INPUT_PULLUP);
  attachInterrupt(digitalPinToInterrupt(PIN_FLOW), flowPulseISR, FALLING);
  lastFlowCalcMs = millis();

  // NPK probe — UART2 + MAX485 driver-enable. Fail-soft: if the probe is not
  // fitted or not answering, NPK dosing stays blocked and everything else runs.
  if (NPK_ENABLED) {
    digitalWrite(PIN_NPK_DE, LOW);        // receive mode before pinMode
    pinMode(PIN_NPK_DE, OUTPUT);
    Serial2.begin(NPK_BAUD, SERIAL_8N1, PIN_NPK_RX, PIN_NPK_TX);
    npkNextPollMs = millis();             // first poll right away
    logLine(String("NPK probe: Modbus RTU @ ") + NPK_BAUD + " baud, addr " +
            NPK_SLAVE_ADDR + " (pins " + PIN_NPK_RX + "/" + PIN_NPK_TX + ", DE " + PIN_NPK_DE + ")");
  } else {
    logLine("NPK probe: disabled in configuration (NPK_ENABLED = false)");
  }

  // settings + state
  loadSettings();

  // Wi-Fi (fail-soft: continues even if it never connects)
  WiFi.mode(WIFI_STA);
  WiFi.setAutoReconnect(true);
  WiFi.begin(WIFI_SSID, WIFI_PASS);

  // MQTT
  mqtt.setServer(MQTT_HOST, MQTT_PORT);
  mqtt.setCallback(onMqttMessage);
  mqtt.setBufferSize(1024);   // settings/state payloads carry the NPK fields too

  // watchdog: 30 s, main loop feeds it.
  // ESP-IDF v5 (Arduino-ESP32 core 3.x) changed the API from the v4 form.
#if defined(ESP_IDF_VERSION_MAJOR) && ESP_IDF_VERSION_MAJOR >= 5
  esp_task_wdt_config_t wdtCfg = {};
  wdtCfg.timeout_ms    = 30000;
  wdtCfg.idle_core_mask = 0;
  wdtCfg.trigger_panic = true;
  esp_task_wdt_init(&wdtCfg);
#else
  esp_task_wdt_init(30, true);
#endif
  esp_task_wdt_add(NULL);

  prefs.begin("hydro", false);
  bool booted = prefs.getBool("booted", false);
  if (!booted) prefs.putBool("booted", true);
  prefs.end();
  logLine(booted ? "REBOOT — resuming with saved settings" : "FIRST BOOT — defaults active");

  lastWifiTryMs = lastMqttTryMs = millis();
}

void loop() {
  uint32_t now = millis();
  esp_task_wdt_reset();

  // --- 1. local-first: acquire sensors & run ALL safety automation ---
  npkPollTick(now);          // NPK probe runs every loop pass (500 ms reply window)
  sampleSensors();
  automationDosing(now);
  automationFlow(now);
  automationClimate(now);

  // --- 2. connectivity (optional, never required for safety) ---
  maintainWifi(now);
  maintainMqtt(now);

  // --- 3. publishing ---
  if (mqtt.connected()) {
    if (now - lastTelemetryMs >= TELEMETRY_MS) { lastTelemetryMs = now; publishTelemetry(); }
    if (now - lastStateMs >= STATE_PUBLISH_MS)   { lastStateMs = now;     publishState(); }
    if (now - lastHeartbeatMs >= HEARTBEAT_MS)   { lastHeartbeatMs = now; publishEvent("heartbeat", "ok"); }
  }

  // --- 4. status LED: solid=online, slow blink=local only, fast=fault ---
  bool fault = !sens.phOk || !sens.ecOk || !sens.climateOk || (NPK_ENABLED && !sens.npkOk);
  uint32_t blinkMs = fault ? 100UL : (mqtt.connected() ? 0xFFFFFFFFUL : 750UL);
  if (blinkMs == 0xFFFFFFFFUL) {
    digitalWrite(PIN_STATUS_LED, HIGH);
  } else {
    digitalWrite(PIN_STATUS_LED, (now / blinkMs) % 2 ? HIGH : LOW);
  }
}
