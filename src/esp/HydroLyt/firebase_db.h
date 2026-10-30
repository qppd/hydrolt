/*
 * ============================================================================
 *  firebase_db.h — Realtime Database publishing (telemetry, state, alerts)
 * ============================================================================
 */

#pragma once

#include <Arduino.h>

/** True once the device is signed in and the RTDB link is usable. */
bool dbReady();

/** Fill in the Firebase credentials (call once from setup). */
void firebaseBegin();

/** Push an alert to devices/{id}/alerts (also logged over serial). */
void publishAlert(const char* severity, const char* type, const String& msg);

/** Push a lifecycle event to devices/{id}/events. */
void publishEvent(const char* eventType, const String& details);

/** Overwrite devices/{id}/telemetry and archive to devices/{id}/history. */
void publishTelemetry();

/** Overwrite devices/{id}/state. */
void publishState();

/** Mirror the active settings to devices/{id}/settings. */
void publishSettings();
