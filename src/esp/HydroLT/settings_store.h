/*
 * ============================================================================
 *  settings_store.h — NVS persistence of control settings and operating mode
 * ============================================================================
 */

#pragma once

/** Load settings (and the AUTO/MANUAL mode) from NVS, clamped to safe ranges. */
void loadSettings();

/** Persist the current settings and operating mode to NVS. */
void saveSettings();

/** Report whether this is the first boot or a reboot (serial log only). */
void reportBootMode();
