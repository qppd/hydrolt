/*
 * ============================================================================
 *  state.h — mutable runtime state shared across modules
 * ----------------------------------------------------------------------------
 *  Every global is DEFINED once in state.cpp and merely declared here, so all
 *  modules read and write the same instance (no per-translation-unit copies).
 * ============================================================================
 */

#pragma once

#include <Arduino.h>
#include <Firebase_ESP_Client.h>

#include "types.h"

// --- control state ----------------------------------------------------------
extern Settings      cfg;
extern SensorData    sens;
extern ActuatorState act;

// --- flow pulse bookkeeping -------------------------------------------------
extern volatile uint32_t pulseCount;
extern uint32_t lastFlowCalcMs;

// --- dosing state machine ---------------------------------------------------
extern DoseState doseState;
extern String    doseReason;
extern uint32_t  doseStartMs, doseMixStartMs, lastDoseEndMs;
extern uint16_t  doseAppliedMs;
extern uint16_t  doseCycleLimitMs;   // cap for the current cycle
extern uint32_t  lastEcAlertMs;      // throttle for repeated EC warnings

// --- NPK dosing bookkeeping (index: 0 = N, 1 = P, 2 = K) --------------------
extern uint32_t lastNpkDoseEndMs;          // separate cooldown from the fast pH/EC loop
extern uint8_t  npkAttempts[3];            // bursts applied without reaching the band
extern uint32_t npkLockoutUntilMs[3];      // 0 = no active lockout

// --- NPK probe state --------------------------------------------------------
extern NpkPollState npkPollState;
extern uint32_t npkNextPollMs, npkWaitStartMs;
extern uint8_t  npkRxBuf[16];
extern uint8_t  npkRxLen;
extern uint8_t  npkFails;
extern uint32_t lastNpkFaultAlertMs;

// --- pump / fan / mist timing guards ---------------------------------------
extern uint32_t pumpStartMs;
extern bool     flowChecked;
extern uint32_t fanChangedMs;
extern uint32_t mistStartMs;

// --- networking -------------------------------------------------------------
extern FirebaseConfig fbConfig;
extern FirebaseAuth   fbAuth;
extern FirebaseData   fbdo;          // general RTDB operations
extern FirebaseData   fbdoCmdStream; // stream: devices/{id}/commands
extern FirebaseData   fbdoSetStream; // reserved: settings stream
extern uint32_t lastWifiTryMs, lastFbTryMs, lastTelemetryMs;
extern uint32_t lastStateMs, lastHeartbeatMs;
extern bool     wifiWasConnected;
extern bool     fbSignedIn;
extern bool     fbStreamsUp;

// --- telemetry archive ------------------------------------------------------
extern uint32_t lastHistoryMs;

// --- command stream ---------------------------------------------------------
extern volatile bool cmdPayloadReady;
extern String        cmdPayloadBuf;   // raw JSON of the latest commands-node change
extern String        lastCmdKeySeen;  // highest push key already executed
