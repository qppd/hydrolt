/*
 * ============================================================================
 *  commands.cpp — validated remote commands over the RTDB command stream
 * ----------------------------------------------------------------------------
 *  Stream callbacks run in the library task context, so they only stash the
 *  payload; execution happens on the main loop via processPendingCommands().
 *
 *  Push keys sort chronologically, so the "> lastCmdKeySeen" guard skips
 *  replays after a reconnect while fresh keys always run.
 * ============================================================================
 */

#include "commands.h"

#include <ArduinoJson.h>
#include <Firebase_ESP_Client.h>
#include <time.h>

#include "actuators.h"
#include "config.h"
#include "firebase_db.h"
#include "logging.h"
#include "settings_store.h"
#include "state.h"

void sendAck(const String& id, const char* status, const String& note) {
  if (!dbReady() || id == "") return;
  FirebaseJson json;
  json.set("cmd_id", id);
  json.set("status", status);
  if (note.length()) json.set("note", note);
  json.set("ts", (int64_t)time(nullptr));
  Firebase.RTDB.pushJSON(&fbdo, DB_PATH("acks"), &json);
  String noteText = note.length() ? String(" (") + note + ")" : String("");
  logLine(String("ACK ") + id + " -> " + status + noteText);
}

bool manualAllowed(const String& id) {
  if (act.mode != MODE_MANUAL) {
    sendAck(id, "rejected", "device is in AUTO mode");
    return false;
  }
  return true;
}

void handleCommand(const char* payload, unsigned int length) {
  JsonDocument doc;
  DeserializationError err = deserializeJson(doc, payload, length);
  if (err) {
    publishAlert("warning", "bad_command", "Malformed command payload rejected.");
    return;
  }
  const char* cmd  = doc["cmd"] | "";
  String id        = doc["id"] | "";
  uint32_t now     = millis();

  if (strcmp(cmd, "pump") == 0) {
    if (!manualAllowed(id)) return;
    bool v = doc["value"] | false;
    if (v) { act.pump = true;  setRelay(PIN_RELAY_PUMP, true);  pumpStartMs = now; flowChecked = false; }
    else   stopIrrigation("manual off");
    sendAck(id, "ok");

  } else if (strcmp(cmd, "fan") == 0) {
    if (!manualAllowed(id)) return;
    bool v = doc["value"] | false;
    act.fan = v; setRelay(PIN_RELAY_FAN, v); fanChangedMs = now;
    sendAck(id, "ok");

  } else if (strcmp(cmd, "misting") == 0) {
    if (!manualAllowed(id)) return;
    bool v = doc["value"] | false;
    if (v && (!sens.climateOk || sens.hum >= cfg.humLimit)) {
      sendAck(id, "rejected", "climate sensor invalid or humidity at/above limit");
      return;
    }
    act.misting = v; setRelay(PIN_RELAY_MIST, v);
    if (v) mistStartMs = now;
    sendAck(id, "ok");

  } else if (strcmp(cmd, "mode") == 0) {
    String v = doc["value"] | "auto";
    if (v != "auto" && v != "manual") { sendAck(id, "rejected", "mode must be auto|manual"); return; }
    act.mode = (v == "auto") ? MODE_AUTO : MODE_MANUAL;
    if (act.mode == MODE_AUTO) {
      stopIrrigation("entering auto mode"); stopAllDosing("entering auto mode");
      act.fan = false; act.misting = false;
      setRelay(PIN_RELAY_FAN, false); setRelay(PIN_RELAY_MIST, false);
    }
    saveSettings();
    sendAck(id, "ok");
    publishState();

  } else if (strcmp(cmd, "settings") == 0) {
    JsonObject s = doc["settings"].as<JsonObject>();
    if (s.isNull()) { sendAck(id, "rejected", "missing settings object"); return; }
    // ArduinoJson 7: JsonObject::containsKey() is deprecated -> variant isNull()
    auto has = [&s](const char* key) { return !s[key].isNull(); };
    if (has("ph_min") && has("ph_max")) {
      float a = s["ph_min"] | (float)DEFAULT_PH_MIN, b = s["ph_max"] | (float)DEFAULT_PH_MAX;
      if (a >= b || a < 0 || b > 14) { sendAck(id, "rejected", "invalid pH range"); return; }
      cfg.phMin = a; cfg.phMax = b;
    }
    if (has("ec_min") && has("ec_max")) {
      float a = s["ec_min"] | (float)DEFAULT_EC_MIN, b = s["ec_max"] | (float)DEFAULT_EC_MAX;
      if (a >= b || a < 0) { sendAck(id, "rejected", "invalid EC range"); return; }
      cfg.ecMin = a; cfg.ecMax = b;
    }
    if (has("temperature_setpoint")) {
      float v = s["temperature_setpoint"] | DEFAULT_TEMP_SETPOINT;
      if (v < 10 || v > 50) { sendAck(id, "rejected", "temperature_setpoint out of 10-50 C"); return; }
      cfg.tempSetpoint = v;
    }
    if (has("humidity_limit")) {
      float v = s["humidity_limit"] | DEFAULT_HUM_LIMIT;
      if (v < 30 || v > 99) { sendAck(id, "rejected", "humidity_limit out of 30-99"); return; }
      cfg.humLimit = v;
    }
    if (has("min_flow_rate")) {
      float v = s["min_flow_rate"] | DEFAULT_MIN_FLOW;
      if (v < 0 || v > 50) { sendAck(id, "rejected", "min_flow_rate out of range"); return; }
      cfg.minFlow = v;
    }
    if (has("dosing_max_runtime_s")) {
      int v = s["dosing_max_runtime_s"] | (int)(DEFAULT_DOSE_MAX_MS / 1000);
      if (v <= 0 || v > 60) { sendAck(id, "rejected", "dosing_max_runtime_s out of 1-60"); return; }
      cfg.doseMaxMs = (uint16_t)(v * 1000);
    }
    if (has("dosing_cooldown_s")) {
      int v = s["dosing_cooldown_s"] | (int)DEFAULT_DOSE_COOLDOWN_S;
      if (v < 5 || v > 3600) { sendAck(id, "rejected", "dosing_cooldown_s out of 5-3600"); return; }
      cfg.doseCooldownS = (uint16_t)v;
    }
    if (has("misting_max_s")) {
      int v = s["misting_max_s"] | (int)DEFAULT_MIST_MAX_S;
      if (v < 10 || v > 900) { sendAck(id, "rejected", "misting_max_s out of 10-900"); return; }
      cfg.mistMaxS = (uint16_t)v;
    }
    if (has("npk_n_min") && has("npk_n_max")) {
      float a = s["npk_n_min"] | (float)DEFAULT_NPK_N_MIN, b = s["npk_n_max"] | (float)DEFAULT_NPK_N_MAX;
      if (a >= b || a < 0 || b > NPK_VALID_MAX) { sendAck(id, "rejected", "invalid N band (mg/kg)"); return; }
      cfg.npkNMin = a; cfg.npkNMax = b;
    }
    if (has("npk_p_min") && has("npk_p_max")) {
      float a = s["npk_p_min"] | (float)DEFAULT_NPK_P_MIN, b = s["npk_p_max"] | (float)DEFAULT_NPK_P_MAX;
      if (a >= b || a < 0 || b > NPK_VALID_MAX) { sendAck(id, "rejected", "invalid P band (mg/kg)"); return; }
      cfg.npkPMin = a; cfg.npkPMax = b;
    }
    if (has("npk_k_min") && has("npk_k_max")) {
      float a = s["npk_k_min"] | (float)DEFAULT_NPK_K_MIN, b = s["npk_k_max"] | (float)DEFAULT_NPK_K_MAX;
      if (a >= b || a < 0 || b > NPK_VALID_MAX) { sendAck(id, "rejected", "invalid K band (mg/kg)"); return; }
      cfg.npkKMin = a; cfg.npkKMax = b;
    }
    if (has("npk_dosing_max_runtime_s")) {
      int v = s["npk_dosing_max_runtime_s"] | (int)(DEFAULT_NPK_DOSE_MAX_MS / 1000);
      if (v <= 0 || v > 60) { sendAck(id, "rejected", "npk_dosing_max_runtime_s out of 1-60"); return; }
      cfg.npkDoseMaxMs = (uint16_t)(v * 1000);
    }
    if (has("npk_dose_cooldown_s")) {
      int v = s["npk_dose_cooldown_s"] | (int)DEFAULT_NPK_DOSE_COOLDOWN_S;
      if (v < 30 || v > 3600) { sendAck(id, "rejected", "npk_dose_cooldown_s out of 30-3600"); return; }
      cfg.npkDoseCooldownS = (uint16_t)v;
    }
    if (has("npk_dosing_enabled")) {
      bool v = s["npk_dosing_enabled"] | DEFAULT_NPK_AUTO_DOSE;
      cfg.npkAutoDose = v;
      if (!v) logLine("NPK automatic dosing disabled (kill switch)");
    }
    saveSettings();
    publishSettings();
    sendAck(id, "ok");

  } else if (strcmp(cmd, "dose") == 0) {
    if (!manualAllowed(id)) return;
    if (!sens.phOk || !sens.ecOk) { sendAck(id, "rejected", "invalid sensors — dosing blocked"); return; }
    String which = doc["value"] | "";
    bool isNpk = (which == "N" || which == "P" || which == "K");
    if (which != "A" && which != "B" && !isNpk) {
      sendAck(id, "rejected", "value must be A, B, N, P or K"); return;
    }
    if (isNpk) {
      if (!NPK_ENABLED)         { sendAck(id, "rejected", "NPK probe not fitted"); return; }
      if (!sens.npkOk)          { sendAck(id, "rejected", "NPK probe not ready — dosing blocked"); return; }
    }
    uint16_t cap = isNpk ? cfg.npkDoseMaxMs : cfg.doseMaxMs;
    uint16_t ms = doc["duration_ms"] | 3000;
    if (ms == 0 || ms > cap) { sendAck(id, "rejected", "duration exceeds the configured cap"); return; }
    stopAllDosing("manual dose requested");
    doseReason = isNpk ? String("npk_") + (which == "N" ? "n" : which == "P" ? "p" : "k") + "_manual"
                       : String("manual");
    doseStartMs = now; doseState = DOSE_RUNNING;
    doseCycleLimitMs = ms;
    setDoseChannel(which == "A" ? DOSE_CH_A : which == "B" ? DOSE_CH_B
                  : which == "N" ? DOSE_CH_N : which == "P" ? DOSE_CH_P : DOSE_CH_K);
    sendAck(id, "ok");

  } else if (strcmp(cmd, "restart") == 0) {
    sendAck(id, "ok", "restarting");
    if (dbReady()) Firebase.RTDB.setString(&fbdo, DB_PATH("status"), "offline");
    delay(300);
    ESP.restart();

  } else {
    sendAck(id, "rejected", "unknown command");
  }

  publishState();
}

// --- RTDB command stream ----------------------------------------------------

static void cmdStreamCallback(FirebaseStream data) {
  if (data.dataTypeEnum() == fb_esp_rtdb_data_type_json) {
    cmdPayloadBuf = data.payload();
    cmdPayloadReady = true;
  }
}

static void cmdStreamTimeoutCallback(bool timeout) {
  if (timeout) logLine("RTDB command stream timed out — will reattach");
}

void commandsBeginStream() {
  Firebase.RTDB.beginStream(&fbdoCmdStream, DB_PATH("commands"));
  Firebase.RTDB.setStreamCallback(&fbdoCmdStream, cmdStreamCallback, cmdStreamTimeoutCallback);
}

void commandsStreamTick() {
  if (!Firebase.RTDB.readStream(&fbdoCmdStream) && fbdoCmdStream.streamTimeout()) {
    logLine("RTDB stream reattach");
    commandsBeginStream();
  }
}

void processPendingCommands() {
  if (!cmdPayloadReady) return;
  cmdPayloadReady = false;

  JsonDocument doc;
  if (deserializeJson(doc, cmdPayloadBuf)) {
    publishAlert("warning", "bad_command", "Malformed command payload rejected.");
    return;
  }
  JsonObject root = doc.as<JsonObject>();
  String cmdRootPath = DB_PATH("commands");
  for (JsonPair kv : root) {
    String key(kv.key().c_str());
    if (lastCmdKeySeen.length() && key <= lastCmdKeySeen) continue;
    String child;
    serializeJson(kv.value(), child);
    handleCommand(child.c_str(), child.length());
    lastCmdKeySeen = key;
    // consumed — clear the node so reconnects never replay it
    Firebase.RTDB.deleteNode(&fbdo, (cmdRootPath + "/" + key).c_str());
  }
}
