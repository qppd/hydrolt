/*
 * ============================================================================
 *  HydroLT.ino — HYDROLYT ESP32 Controller (entry point)
 * ----------------------------------------------------------------------------
 *  IoT-Based Vertical Hydroponic System for Sustainable Off-Season
 *  Cultivation of Cucumis melo (Melon)
 *
 *  Scope : one 4 x 5 m greenhouse, two vertical towers, one controller.
 *  Tasks : sensor acquisition (incl. NPK via RS485 Modbus probe),
 *          nutrient dosing (pH/EC + closed-loop N/P/K dosing),
 *          water-flow management, temperature/humidity control
 *          (exhaust fan + misting), Firebase RTDB telemetry & remote
 *          commands, local fail-safe automation.
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
 *  Module layout (all files in this sketch folder):
 *    config.h        compile-time configuration (pins, limits, timings)
 *    types.h         plain data types shared by the modules
 *    state.h/.cpp    single definition point for every shared global
 *    util.h/.cpp     numeric helpers + Modbus RTU CRC
 *    logging.h/.cpp  serial log helper
 *    settings_store  NVS persistence of settings and AUTO/MANUAL mode
 *    sensors         pH / EC / DHT22 / flow acquisition
 *    npk             RS485 Modbus RTU NPK probe (N, P, K in mg/kg)
 *    actuators       relay helpers, safety stops, one-dose-channel rule
 *    automation      dosing, water-flow and climate control loops
 *    firebase_db     RTDB publishing (telemetry, history, state, alerts)
 *    commands        validated remote commands + acknowledgement
 *    connectivity    Wi-Fi / Firebase session maintenance
 *
 *  Libraries (Arduino Library Manager):
 *    - Firebase Arduino Client for ESP8266 and ESP32 (Mobizt) — Firebase
 *      Auth (email/password device account) + Realtime Database over SSL.
 *    - DHT sensor library  (Adafruit) + Adafruit Unified Sensor
 *    - ArduinoJson 7.x     (Benoit Blanchon)  — uses the JsonDocument API
 *    - (no extra library) the RS485 NPK probe is driven by a small Modbus
 *      RTU master implemented in npk.cpp on UART2 through a MAX485.
 *
 *  Verified against: Arduino-ESP32 core 3.3.11, ArduinoJson 7.4.3,
 *  Firebase-ESP-Client (Mobizt) 4.4.x, compiled for FQBN esp32:esp32:esp32.
 *
 *  Board: ESP32 Dev Module.  Serial monitor: 115200 baud.
 * ============================================================================
 */

#include <Arduino.h>
#include <WiFi.h>
#include <Firebase_ESP_Client.h>
#include <esp_task_wdt.h>
#include <time.h>
#if __has_include(<esp_idf_version.h>)
#include <esp_idf_version.h>   // ESP_IDF_VERSION_MAJOR (watchdog API differs on v4/v5)
#endif

#include "config.h"
#include "state.h"

#include "actuators.h"
#include "automation.h"
#include "commands.h"
#include "connectivity.h"
#include "firebase_db.h"
#include "logging.h"
#include "npk.h"
#include "sensors.h"
#include "settings_store.h"

void setup() {
  Serial.begin(115200);
  delay(200);
  Serial.println();
  Serial.println("=====================================================");
  Serial.println(" HYDROLYT / HydroLT — ESP32 vertical hydroponic ctrlr");
  Serial.println(String(" device: ") + DEVICE_ID);
  Serial.println("=====================================================");

  // outputs — write inactive state BEFORE pinMode to avoid relay glitching
  actuatorsBegin();

  // sensors (ADC, DHT22, flow interrupt)
  sensorsBegin();

  // NPK probe — UART2 + MAX485 driver-enable. Fail-soft: if the probe is not
  // fitted or not answering, NPK dosing stays blocked and everything else runs.
  npkBegin();

  // settings + state
  loadSettings();

  // Wi-Fi (fail-soft: continues even if it never connects)
  WiFi.mode(WIFI_STA);
  WiFi.setAutoReconnect(true);
  WiFi.begin(WIFI_SSID, WIFI_PASS);

  // Firebase RTDB (fail-soft: signs in on first maintainFirebase() pass)
  firebaseBegin();

  // NTP — telemetry timestamps are epoch seconds; without this they stay 0
  configTime(0, 0, "pool.ntp.org", "time.nist.gov");

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

  reportBootMode();

  lastWifiTryMs = lastFbTryMs = millis();
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
  maintainFirebase(now);

  // --- 3. publishing ---
  if (dbReady()) {
    if (now - lastTelemetryMs >= TELEMETRY_MS) { lastTelemetryMs = now; publishTelemetry(); }
    if (now - lastStateMs >= STATE_PUBLISH_MS)   { lastStateMs = now;     publishState(); }
    if (now - lastHeartbeatMs >= HEARTBEAT_MS)   { lastHeartbeatMs = now; publishEvent("heartbeat", "ok"); }
  }

  // --- 4. status LED: solid=online, slow blink=local only, fast=fault ---
  bool fault = !sens.phOk || !sens.ecOk || !sens.climateOk || (NPK_ENABLED && !sens.npkOk);
  uint32_t blinkMs = fault ? 100UL : (dbReady() ? 0xFFFFFFFFUL : 750UL);
  if (blinkMs == 0xFFFFFFFFUL) {
    digitalWrite(PIN_STATUS_LED, HIGH);
  } else {
    digitalWrite(PIN_STATUS_LED, (now / blinkMs) % 2 ? HIGH : LOW);
  }
}
