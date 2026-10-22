/*
 * ============================================================================
 *  automation.cpp — the three local control loops
 * ----------------------------------------------------------------------------
 *  A. NUTRIENT DOSING — pH/EC correction + closed-loop N/P/K dosing. NPK
 *     values come ONLY from the RS485 probe and are never inferred from pH or
 *     EC (requirements.md §4.A).
 *
 *     NPK fail-safes (each one independently blocks a burst):
 *       - AUTO mode, solution circulating, pH AND EC readings valid
 *       - NPK probe healthy (npkOk) and the npk_dosing_enabled kill switch on
 *       - EC not already above target (adding salt would make it worse)
 *       - NPK cooldown elapsed, per element
 *       - element below its band (above target = alert only, no dosing)
 *       - bounded burst (npkDoseMaxMs) + mix/re-measure, then re-evaluate
 *       - no-progress lockout: after NPK_MAX_ATTEMPTS bursts without reaching
 *         the band, that element is locked out for NPK_LOCKOUT_MS + alert
 *  B. WATER-FLOW MANAGEMENT  (requirements.md §4.B)
 *  C. TEMPERATURE / HUMIDITY (requirements.md §4.C)
 * ============================================================================
 */

#include "automation.h"

#include "actuators.h"
#include "config.h"
#include "firebase_db.h"
#include "logging.h"
#include "state.h"
#include "util.h"

// --- A. nutrient dosing -----------------------------------------------------

static int npkElementOf(const String& reason) {   // 0 = N, 1 = P, 2 = K, -1 = not NPK
  if (reason.startsWith("npk_n")) return 0;
  if (reason.startsWith("npk_p")) return 1;
  if (reason.startsWith("npk_k")) return 2;
  return -1;
}

static const char* npkElementName(int idx) { return idx == 0 ? "N" : idx == 1 ? "P" : "K"; }

static float npkElementValue(int idx) { return idx == 0 ? sens.npkN : idx == 1 ? sens.npkP : sens.npkK; }

static float npkElementMin(int idx) { return idx == 0 ? cfg.npkNMin : idx == 1 ? cfg.npkPMin : cfg.npkKMin; }

/** Judge a completed NPK burst: reaching the band resets the attempt counter,
 *  not reaching it counts toward the no-progress lockout. */
static void npkNoteResult(uint32_t now, int idx) {
  if (idx < 0 || idx > 2) return;
  if (!sens.npkOk) return;                       // can't judge without a reading
  if (!doseReason.endsWith("_low")) return;      // only automatic bursts count toward lockout

  float val = npkElementValue(idx);
  if (validRange(val, NPK_VALID_MIN, NPK_VALID_MAX) && val >= npkElementMin(idx)) {
    npkAttempts[idx] = 0;
    npkLockoutUntilMs[idx] = 0;
    return;
  }
  if (npkAttempts[idx] < 255) npkAttempts[idx]++;
  if (npkAttempts[idx] >= NPK_MAX_ATTEMPTS) {
    npkAttempts[idx] = 0;
    npkLockoutUntilMs[idx] = now + NPK_LOCKOUT_MS;
    publishAlert("warning", "npk_dosing_no_response",
                 String(npkElementName(idx)) +
                 " is still below target after 3 bounded bursts — automatic NPK dosing for "
                 "this element is paused for 30 min. Check the probe reading and the "
                 "formulation before it resumes.");
  }
}

/** Pick the element furthest below its band and start ONE bounded burst. */
static void npkDecide(uint32_t now) {
  if (!NPK_ENABLED || !cfg.npkAutoDose) return;   // kill switch / probe not fitted
  if (!sens.npkOk) return;                        // never dose blind
  if (sens.ec > cfg.ecMax) return;                // solution already too concentrated
  if (lastNpkDoseEndMs &&
      (now - lastNpkDoseEndMs) < (uint32_t)cfg.npkDoseCooldownS * 1000UL) return;

  int worst = -1;
  float worstFrac = 0.0f;
  for (int i = 0; i < 3; i++) {
    float val = npkElementValue(i);
    if (!validRange(val, NPK_VALID_MIN, NPK_VALID_MAX)) continue;
    if (val >= npkElementMin(i)) {                 // in band -> clear progress bookkeeping
      npkAttempts[i] = 0;
      npkLockoutUntilMs[i] = 0;
      continue;
    }
    if (npkLockoutUntilMs[i] != 0) {
      if ((int32_t)(now - npkLockoutUntilMs[i]) < 0) continue;   // still locked out
      npkLockoutUntilMs[i] = 0;                                 // lockout expired
    }
    float frac = (npkElementMin(i) - val) / (npkElementMin(i) > 1.0f ? npkElementMin(i) : 1.0f);
    if (frac > worstFrac) { worstFrac = frac; worst = i; }
  }
  if (worst < 0) return;

  doseReason      = (worst == 0) ? "npk_n_low" : (worst == 1) ? "npk_p_low" : "npk_k_low";
  doseAppliedMs   = 0;
  doseCycleLimitMs = cfg.npkDoseMaxMs;
  doseStartMs     = now;
  doseState       = DOSE_RUNNING;
  lastNpkDoseEndMs = now;                         // cooldown starts with the burst
  setDoseChannel(worst == 0 ? DOSE_CH_N : worst == 1 ? DOSE_CH_P : DOSE_CH_K);
  logLine(String("NPK DOSING START ") + doseReason +
          " value=" + String(npkElementValue(worst), 1) +
          " target_min=" + String(npkElementMin(worst), 1) +
          " cap=" + cfg.npkDoseMaxMs + "ms");
}

void automationDosing(uint32_t now) {
  // Fail-safe gates ------------------------------------------------------
  if (doseState == DOSE_IDLE) {
    if (act.mode != MODE_AUTO) return;                    // manual mode: no auto dosing
    if (!sens.phOk || !sens.ecOk) return;                 // invalid sensors: no dosing
    if (act.pump == false) return;                        // circulate first

    // pH/EC correction has priority (fast loop); its own cooldown applies.
    bool phDue = (lastDoseEndMs == 0 ||
                  (now - lastDoseEndMs) >= (uint32_t)cfg.doseCooldownS * 1000UL);

    String reason = "";
    DoseChannel channel = DOSE_CH_NONE;

    if (phDue) {
      if (sens.ph > cfg.phMax)      { reason = "ph_high"; channel = DOSE_CH_B; }
      else if (sens.ph < cfg.phMin) { reason = "ph_low";  channel = DOSE_CH_A; }
      else if (sens.ec > cfg.ecMax) { reason = "ec_high"; /* dilute: no pump, alert only */ }
      else if (sens.ec < cfg.ecMin) { reason = "ec_low";  channel = DOSE_CH_A; }
    }

    if (reason == "ec_high") {
      // Throttled: EC high needs a manual flush/dilute — and NPK dosing is
      // paused too, because adding more salt would raise EC further.
      if (lastEcAlertMs == 0 || (now - lastEcAlertMs) >= 900000UL) {
        lastEcAlertMs = now;
        publishAlert("warning", "ec_high",
                     "EC above target. Flush/dilute manually — pH and NPK dosing are paused "
                     "while EC stays above the limit.");
      }
      lastDoseEndMs = now;
      return;
    }

    if (reason != "") {
      // start a bounded pH/EC dose cycle
      doseReason      = reason;
      doseAppliedMs   = 0;
      doseCycleLimitMs = cfg.doseMaxMs;
      doseStartMs     = now;
      doseState       = DOSE_RUNNING;
      setDoseChannel(channel);
      logLine(String("DOSING START reason=") + reason);
      return;
    }

    npkDecide(now);   // nothing pH/EC to correct -> consider a bounded NPK burst
    return;
  }

  if (doseState == DOSE_RUNNING) {
    uint32_t runtime = now - doseStartMs;
    int npkIdx = npkElementOf(doseReason);
    bool sensorLost = (doseReason.startsWith("ph") && !sens.phOk) ||
                      (doseReason.startsWith("ec") && !sens.ecOk) ||
                      (npkIdx >= 0 && !sens.npkOk);

    if (sensorLost) {                                  // fail-safe mid-dose
      stopAllDosing("sensor lost during dosing");
      publishAlert("critical", "dosing_fault",
                   "Sensor invalid during dosing — cycle aborted.");
      lastDoseEndMs = now;
      doseState = DOSE_MIXING; doseMixStartMs = now;
      return;
    }
    if (runtime >= doseCycleLimitMs) {                // hard runtime cap
      if (npkIdx >= 0) {
        // An NPK burst hitting its cap is normal bounded operation, not a fault.
        stopAllDosing("NPK burst limit reached");
        logLine(String("NPK burst complete: ") + doseReason + " (" + doseAppliedMs + " ms)");
      } else {
        stopAllDosing("max runtime reached");
        publishAlert("warning", "dosing_limit",
                     "Dosing stopped at configured max runtime. Check solution response.");
      }
      lastDoseEndMs = now;
      doseState = DOSE_MIXING; doseMixStartMs = now;
      return;
    }
    doseAppliedMs = (uint16_t)runtime;
    return;
  }

  if (doseState == DOSE_MIXING) {                      // circulate, then re-measure
    if (now - doseMixStartMs >= (uint32_t)cfg.mixWaitS * 1000UL) {
      doseState = DOSE_IDLE;
      int npkIdx = npkElementOf(doseReason);
      if (npkIdx >= 0) {
        npkNoteResult(now, npkIdx);                    // progress check / lockout
      } else if (sens.phOk && (sens.ph > cfg.phMax || sens.ph < cfg.phMin)) {
        // pH stall detection: if still out of range, alert (no endless dosing)
        publishAlert("warning", "dosing_no_response",
                     "pH still out of range after dosing — check formulation/probe calibration.");
      }
    }
  }
}

// --- B. water-flow management ----------------------------------------------

void automationFlow(uint32_t now) {
  if (!act.pump) { flowChecked = false; pumpStartMs = 0; return; }

  if (pumpStartMs == 0) pumpStartMs = now;
  uint32_t runtime = now - pumpStartMs;

  if (!flowChecked && runtime >= cfg.flowDelayMs) {
    flowChecked = true;
    if (sens.flow < cfg.minFlow) {
      stopIrrigation("low flow detected");
      publishAlert("critical", "low_flow",
                   String("Flow ") + String(sens.flow, 2) +
                   " L/min below minimum " + String(cfg.minFlow, 2) +
                   " L/min - pump stopped. Check tubing, filter, and water level.");
      return;
    }
    logLine(String("Flow OK: ") + String(sens.flow, 2) + " L/min");
  }

  // continuous low-flow guard once validated
  if (flowChecked && sens.flowOk && sens.flow < cfg.minFlow * 0.5f) {
    stopIrrigation("flow collapsed during operation");
    publishAlert("critical", "low_flow",
                 "Flow collapsed to less than half the minimum — pump stopped.");
  }
}

// --- C. temperature / humidity ---------------------------------------------

void automationClimate(uint32_t now) {
  if (!sens.climateOk) {
    // sensor failure: safe default — stop misting (water/safety), leave fan off
    if (act.misting) {
      act.misting = false; setRelay(PIN_RELAY_MIST, false);
      publishAlert("critical", "sensor_fault",
                   "Climate sensor invalid — misting disabled for safety.");
    }
    return;
  }

  float t = sens.temp, h = sens.hum;

  // ---- exhaust fan with hysteresis + min run/off times ----
  bool wantFan = act.fan;
  if (!act.fan && t >= cfg.tempSetpoint)              wantFan = true;
  else if (act.fan && t <= (cfg.tempSetpoint - cfg.tempHyst)) wantFan = false;

  if (wantFan != act.fan) {
    uint32_t sinceChange = fanChangedMs ? (now - fanChangedMs) : 0xFFFFFFFFUL;
    uint32_t minMs = (act.fan ? cfg.minOffS : cfg.minRunS) * 1000UL;
    if (sinceChange >= minMs) {
      act.fan = wantFan;
      setRelay(PIN_RELAY_FAN, act.fan);
      fanChangedMs = now;
      logLine(String("FAN ") + (act.fan ? "ON" : "OFF") + " at " + String(t, 1) + " C");
    }
  }

  // ---- misting: only when hot AND not already humid, with hard caps ----
  bool permit = (t >= cfg.tempSetpoint) && (h < cfg.humLimit) && act.fan;

  if (act.misting) {
    uint32_t onMs = now - mistStartMs;
    if (!permit || onMs >= (uint32_t)cfg.mistMaxS * 1000UL) {
      act.misting = false; setRelay(PIN_RELAY_MIST, false);
      logLine(String("MISTING OFF after ") + (onMs / 1000) + " s");
      // misting requires a cooldown equal to its max run before it may restart
      mistStartMs = now;   // reused as "off timestamp"
    }
  } else {
    bool cooldownDone = (now - mistStartMs) >= (uint32_t)cfg.mistMaxS * 1000UL;
    if (permit && cooldownDone && h < (cfg.humLimit - 5.0f)) {
      act.misting = true; setRelay(PIN_RELAY_MIST, true);
      mistStartMs = now;
      logLine(String("MISTING ON at ") + String(t, 1) + " C / " + String(h, 0) + " %RH");
    }
  }
}
