/*
 * ============================================================================
 *  sensors.cpp — sensor acquisition (non-blocking, median smoothing)
 * ============================================================================
 */

#include "sensors.h"

#include <DHT.h>

#include "config.h"
#include "state.h"
#include "util.h"

static DHT dht(PIN_DHT, DHT22);

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

void sensorsBegin() {
  dht.begin();
  analogReadResolution(12);
  pinMode(PIN_FLOW, INPUT_PULLUP);
  attachInterrupt(digitalPinToInterrupt(PIN_FLOW), flowPulseISR, FALLING);
  lastFlowCalcMs = millis();
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
