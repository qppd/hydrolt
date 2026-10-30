/*
 * ============================================================================
 *  state.cpp — single definition point for every shared global
 * ============================================================================
 */

#include "state.h"

#include "config.h"

// --- control state ----------------------------------------------------------
Settings      cfg;
SensorData    sens;
ActuatorState act;

// --- flow pulse bookkeeping -------------------------------------------------
volatile uint32_t pulseCount = 0;
uint32_t lastFlowCalcMs = 0;

// --- dosing state machine ---------------------------------------------------
DoseState doseState = DOSE_IDLE;
String    doseReason = "";
uint32_t  doseStartMs = 0, doseMixStartMs = 0, lastDoseEndMs = 0;
uint16_t  doseAppliedMs = 0;
uint16_t  doseCycleLimitMs = DEFAULT_DOSE_MAX_MS;
uint32_t  lastEcAlertMs = 0;

// --- NPK dosing bookkeeping -------------------------------------------------
uint32_t lastNpkDoseEndMs = 0;
uint8_t  npkAttempts[3] = {0, 0, 0};
uint32_t npkLockoutUntilMs[3] = {0, 0, 0};

// --- NPK probe state --------------------------------------------------------
NpkPollState npkPollState = NPK_POLL_IDLE;
uint32_t npkNextPollMs = 0, npkWaitStartMs = 0;
uint8_t  npkRxBuf[16];
uint8_t  npkRxLen = 0;
uint8_t  npkFails = 0;
uint32_t lastNpkFaultAlertMs = 0;

// --- pump / fan / mist timing guards ---------------------------------------
uint32_t pumpStartMs = 0;
bool     flowChecked = false;
uint32_t fanChangedMs = 0;
uint32_t mistStartMs = 0;

// --- networking -------------------------------------------------------------
FirebaseConfig fbConfig;
FirebaseAuth   fbAuth;
FirebaseData   fbdo;
FirebaseData   fbdoCmdStream;
FirebaseData   fbdoSetStream;
uint32_t lastWifiTryMs = 0, lastFbTryMs = 0, lastTelemetryMs = 0;
uint32_t lastStateMs = 0, lastHeartbeatMs = 0;
bool     wifiWasConnected = false;
bool     fbSignedIn = false;
bool     fbStreamsUp = false;

// --- telemetry archive ------------------------------------------------------
uint32_t lastHistoryMs = 0;

// --- command stream ---------------------------------------------------------
volatile bool cmdPayloadReady = false;
String        cmdPayloadBuf;
String        lastCmdKeySeen = "";
