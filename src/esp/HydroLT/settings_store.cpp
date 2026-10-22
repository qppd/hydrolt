/*
 * ============================================================================
 *  settings_store.cpp — NVS persistence (Preferences, namespace "hydro")
 * ============================================================================
 */

#include "settings_store.h"

#include <Preferences.h>

#include "config.h"
#include "logging.h"
#include "state.h"

static Preferences prefs;

void loadSettings() {
  prefs.begin("hydro", false);
  cfg.phMin          = prefs.getFloat("phMin",   DEFAULT_PH_MIN);
  cfg.phMax          = prefs.getFloat("phMax",   DEFAULT_PH_MAX);
  cfg.ecMin          = prefs.getFloat("ecMin",   DEFAULT_EC_MIN);
  cfg.ecMax          = prefs.getFloat("ecMax",   DEFAULT_EC_MAX);
  cfg.tempSetpoint   = prefs.getFloat("tSet",    DEFAULT_TEMP_SETPOINT);
  cfg.tempHyst       = prefs.getFloat("tHyst",   DEFAULT_TEMP_HYST);
  cfg.humLimit       = prefs.getFloat("humLim",  DEFAULT_HUM_LIMIT);
  cfg.minFlow        = prefs.getFloat("minFlow", DEFAULT_MIN_FLOW);
  cfg.flowDelayMs    = prefs.getUInt("flowDly",  DEFAULT_FLOW_DELAY_MS);
  cfg.doseMaxMs      = prefs.getUShort("doseMax", DEFAULT_DOSE_MAX_MS);
  cfg.doseCooldownS  = prefs.getUShort("doseCool", DEFAULT_DOSE_COOLDOWN_S);
  cfg.mixWaitS       = prefs.getUShort("mixWait", DEFAULT_MIX_WAIT_S);
  cfg.mistMaxS       = prefs.getUShort("mistMax", DEFAULT_MIST_MAX_S);
  cfg.minRunS        = prefs.getUShort("minRun",  DEFAULT_MIN_RUN_S);
  cfg.minOffS        = prefs.getUShort("minOff",  DEFAULT_MIN_OFF_S);
  cfg.npkNMin        = prefs.getFloat("npkNMin",  DEFAULT_NPK_N_MIN);
  cfg.npkNMax        = prefs.getFloat("npkNMax",  DEFAULT_NPK_N_MAX);
  cfg.npkPMin        = prefs.getFloat("npkPMin",  DEFAULT_NPK_P_MIN);
  cfg.npkPMax        = prefs.getFloat("npkPMax",  DEFAULT_NPK_P_MAX);
  cfg.npkKMin        = prefs.getFloat("npkKMin",  DEFAULT_NPK_K_MIN);
  cfg.npkKMax        = prefs.getFloat("npkKMax",  DEFAULT_NPK_K_MAX);
  cfg.npkDoseMaxMs   = prefs.getUShort("npkDoseMax",  DEFAULT_NPK_DOSE_MAX_MS);
  cfg.npkDoseCooldownS = prefs.getUShort("npkDoseCool", DEFAULT_NPK_DOSE_COOLDOWN_S);
  cfg.npkAutoDose    = prefs.getBool("npkAuto", DEFAULT_NPK_AUTO_DOSE);
  act.mode           = prefs.getBool("autoMode", true) ? MODE_AUTO : MODE_MANUAL;
  prefs.end();

  // sanity clamps — a corrupt config must never allow uncontrolled dosing
  if (cfg.phMin >= cfg.phMax)   { cfg.phMin = DEFAULT_PH_MIN; cfg.phMax = DEFAULT_PH_MAX; }
  if (cfg.ecMin >= cfg.ecMax)   { cfg.ecMin = DEFAULT_EC_MIN; cfg.ecMax = DEFAULT_EC_MAX; }
  if (cfg.doseMaxMs == 0 || cfg.doseMaxMs > 60000) cfg.doseMaxMs = DEFAULT_DOSE_MAX_MS;
  if (cfg.minFlow < 0)          cfg.minFlow = DEFAULT_MIN_FLOW;
  if (cfg.npkNMin >= cfg.npkNMax || cfg.npkNMin < 0) { cfg.npkNMin = DEFAULT_NPK_N_MIN; cfg.npkNMax = DEFAULT_NPK_N_MAX; }
  if (cfg.npkPMin >= cfg.npkPMax || cfg.npkPMin < 0) { cfg.npkPMin = DEFAULT_NPK_P_MIN; cfg.npkPMax = DEFAULT_NPK_P_MAX; }
  if (cfg.npkKMin >= cfg.npkKMax || cfg.npkKMin < 0) { cfg.npkKMin = DEFAULT_NPK_K_MIN; cfg.npkKMax = DEFAULT_NPK_K_MAX; }
  if (cfg.npkDoseMaxMs == 0 || cfg.npkDoseMaxMs > 60000) cfg.npkDoseMaxMs = DEFAULT_NPK_DOSE_MAX_MS;
  if (cfg.npkDoseCooldownS < 30) cfg.npkDoseCooldownS = DEFAULT_NPK_DOSE_COOLDOWN_S;
}

void saveSettings() {
  prefs.begin("hydro", false);
  prefs.putFloat("phMin", cfg.phMin);     prefs.putFloat("phMax", cfg.phMax);
  prefs.putFloat("ecMin", cfg.ecMin);     prefs.putFloat("ecMax", cfg.ecMax);
  prefs.putFloat("tSet", cfg.tempSetpoint); prefs.putFloat("tHyst", cfg.tempHyst);
  prefs.putFloat("humLim", cfg.humLimit); prefs.putFloat("minFlow", cfg.minFlow);
  prefs.putUInt("flowDly", cfg.flowDelayMs);
  prefs.putUShort("doseMax", cfg.doseMaxMs);   prefs.putUShort("doseCool", cfg.doseCooldownS);
  prefs.putUShort("mixWait", cfg.mixWaitS);    prefs.putUShort("mistMax", cfg.mistMaxS);
  prefs.putUShort("minRun", cfg.minRunS);      prefs.putUShort("minOff", cfg.minOffS);
  prefs.putFloat("npkNMin", cfg.npkNMin);      prefs.putFloat("npkNMax", cfg.npkNMax);
  prefs.putFloat("npkPMin", cfg.npkPMin);      prefs.putFloat("npkPMax", cfg.npkPMax);
  prefs.putFloat("npkKMin", cfg.npkKMin);      prefs.putFloat("npkKMax", cfg.npkKMax);
  prefs.putUShort("npkDoseMax", cfg.npkDoseMaxMs);
  prefs.putUShort("npkDoseCool", cfg.npkDoseCooldownS);
  prefs.putBool("npkAuto", cfg.npkAutoDose);
  prefs.putBool("autoMode", act.mode == MODE_AUTO);
  prefs.end();
}

void reportBootMode() {
  prefs.begin("hydro", false);
  bool booted = prefs.getBool("booted", false);
  if (!booted) prefs.putBool("booted", true);
  prefs.end();
  logLine(booted ? "REBOOT — resuming with saved settings" : "FIRST BOOT — defaults active");
}
