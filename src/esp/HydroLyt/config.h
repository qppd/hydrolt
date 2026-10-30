/*
 * ============================================================================
 *  config.h — compile-time configuration for the HydroLT controller
 * ----------------------------------------------------------------------------
 *  Everything here is a constant: credentials, pin map, default limits,
 *  validity windows, calibration points and loop timings.
 *  Runtime state lives in state.h; behaviour lives in the module .cpp files.
 * ============================================================================
 */

#pragma once

#include <Arduino.h>

// --- Credentials ------------------------------------------------------------
// Real values live in secrets.h (git-ignored — copy secrets.h.example and fill
// it in). The placeholders below are what a fresh clone compiles with, so the
// public repo never contains Wi-Fi or Firebase credentials.
#if __has_include("secrets.h")
  #include "secrets.h"
#endif

#ifndef HYDRO_WIFI_SSID
  #define HYDRO_WIFI_SSID "QPPD SOFTWARE DEV"
#endif
#ifndef HYDRO_WIFI_PASS
  #define HYDRO_WIFI_PASS "Programm136+"
#endif
#ifndef HYDRO_FB_API_KEY
  #define HYDRO_FB_API_KEY "YOUR_WEB_API_KEY"
#endif
#ifndef HYDRO_FB_DB_URL
  #define HYDRO_FB_DB_URL "https://YOUR_PROJECT-default-rtdb.firebaseio.com"
#endif
#ifndef HYDRO_FB_EMAIL
  #define HYDRO_FB_EMAIL "YOUR_DEVICE_EMAIL"
#endif
#ifndef HYDRO_FB_PASSWORD
  #define HYDRO_FB_PASSWORD "YOUR_DEVICE_PASSWORD"
#endif
#ifndef HYDRO_DEVICE_ID
  #define HYDRO_DEVICE_ID "hydro-01"
#endif

// --- Wi-Fi -----------------------------------------------------------------
static const char* WIFI_SSID     = HYDRO_WIFI_SSID;
static const char* WIFI_PASS     = HYDRO_WIFI_PASS;
static const uint32_t WIFI_RETRY_MS = 15000UL;   // reconnect attempt interval

// --- Firebase ---------------------------------------------------------------
// The device signs in with its own email/password account (Authentication →
// Users) — never put a database secret here.
static const char* FB_API_KEY   = HYDRO_FB_API_KEY;
static const char* FB_DB_URL    = HYDRO_FB_DB_URL;
static const char* FB_EMAIL     = HYDRO_FB_EMAIL;
static const char* FB_PASSWORD  = HYDRO_FB_PASSWORD;
static const char* DEVICE_ID    = HYDRO_DEVICE_ID;   // unique machine ID shown in the web app
static const uint32_t FB_RETRY_MS   = 5000UL;   // reconnect attempt interval
static const uint32_t TELEMETRY_MS  = 5000UL;   // telemetry write interval
static const uint32_t STREAM_REATTACH_MS = 60000UL; // min gap between command-stream reattaches

// RTDB layout for this device:
//   devices/{deviceId}/telemetry   ← latest sensor sample (overwritten)
//   devices/{deviceId}/history     ← readings archive (push-keyed, device prunes)
//   devices/{deviceId}/state       ← actuator state (overwritten)
//   devices/{deviceId}/settings    ← control settings (web writes, device streams)
//   devices/{deviceId}/commands    ← pending remote commands (web pushes, device streams & clears)
//   devices/{deviceId}/acks        ← command acknowledgements
//   devices/{deviceId}/alerts      ← alert history
//   devices/{deviceId}/events      ← device events
//   devices/{deviceId}/status      ← "online"/"offline"
#define DB_PATH(suffix) (String("devices/") + DEVICE_ID + "/" + suffix).c_str()

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

// --- Default control settings (overridable at runtime via RTDB/NVS) --------
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

// --- History archive (RTDB) ------------------------------------------------
static const uint32_t HISTORY_INTERVAL_MS = 60000UL;  // archive every minute
static const uint8_t  HISTORY_DAYS        = 30;       // on-device retention
