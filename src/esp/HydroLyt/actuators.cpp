/*
 * ============================================================================
 *  actuators.cpp — relay helpers and fail-safe stops
 * ============================================================================
 */

#include "actuators.h"

#include "config.h"
#include "logging.h"
#include "state.h"

void setRelay(int pin, bool on) {
  digitalWrite(pin, RELAY_ACTIVE_LOW ? (on ? LOW : HIGH) : (on ? HIGH : LOW));
}

void actuatorsBegin() {
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
}

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
