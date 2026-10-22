/*
 * ============================================================================
 *  types.h — plain data types shared by the HydroLT modules
 * ============================================================================
 */

#pragma once

#include <Arduino.h>

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

// dosing state machine
enum DoseState { DOSE_IDLE, DOSE_RUNNING, DOSE_MIXING };
enum DoseChannel { DOSE_CH_NONE, DOSE_CH_A, DOSE_CH_B, DOSE_CH_N, DOSE_CH_P, DOSE_CH_K };

// NPK probe (Modbus RTU master, non-blocking poll state machine)
enum NpkPollState { NPK_POLL_IDLE, NPK_POLL_WAIT };
