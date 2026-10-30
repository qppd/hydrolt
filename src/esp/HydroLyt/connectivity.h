/*
 * ============================================================================
 *  connectivity.h — Wi-Fi and Firebase session maintenance
 * ----------------------------------------------------------------------------
 *  Connectivity is optional: if the link is down, local automation keeps
 *  running untouched (FR-10).
 * ============================================================================
 */

#pragma once

#include <Arduino.h>

/** Keep Wi-Fi associated, retrying every WIFI_RETRY_MS without blocking. */
void maintainWifi(uint32_t now);

/** Sign in to Firebase and keep the command stream attached. */
void maintainFirebase(uint32_t now);
