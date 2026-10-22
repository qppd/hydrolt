/*
 * ============================================================================
 *  firebase_db.cpp — Realtime Database publishing
 * ----------------------------------------------------------------------------
 *  History archive: one push node per reading. RTDB bills per stored MB, so
 *  the device prunes entries older than HISTORY_DAYS on every archive write.
 * ============================================================================
 */

#include "firebase_db.h"

#include <Firebase_ESP_Client.h>
#include <time.h>

#include "config.h"
#include "logging.h"
#include "state.h"

bool dbReady() {
  return fbSignedIn && Firebase.ready();
}

void firebaseBegin() {
  fbConfig.api_key = FB_API_KEY;
  fbConfig.database_url = FB_DB_URL;
  fbAuth.user.email = FB_EMAIL;
  fbAuth.user.password = FB_PASSWORD;
}

void publishAlert(const char* severity, const char* type, const String& msg) {
  logLine(String("ALERT [") + severity + "] " + type + ": " + msg);
  if (!dbReady()) return;
  FirebaseJson json;
  json.set("severity", severity);
  json.set("type", type);
  json.set("msg", msg);
  json.set("ts", (int64_t)time(nullptr));   // 0 until NTP syncs; web falls back to push key order
  json.set("resolved", false);
  Firebase.RTDB.pushJSON(&fbdo, DB_PATH("alerts"), &json);
}

void publishEvent(const char* eventType, const String& details) {
  logLine(String("EVENT ") + eventType + " " + details);
  if (!dbReady()) return;
  FirebaseJson json;
  json.set("event", eventType);
  json.set("details", details);
  json.set("ts", (int64_t)time(nullptr));
  Firebase.RTDB.pushJSON(&fbdo, DB_PATH("events"), &json);
}

static void buildReadingJson(FirebaseJson& json) {
  json.set("ts", (int64_t)time(nullptr));   // epoch seconds (NTP); 0 before sync
  json.set("device_ms", (int64_t)millis());
  if (sens.phOk)   json.set("ph", sens.ph);
  if (sens.ecOk)   json.set("ec", sens.ec);
  if (!isnan(sens.temp)) json.set("temp", sens.temp);
  if (!isnan(sens.hum))  json.set("hum", sens.hum);
  if (sens.npkOk) {
    json.set("npk_n", sens.npkN);
    json.set("npk_p", sens.npkP);
    json.set("npk_k", sens.npkK);
  }
  json.set("flow", sens.flow);
  FirebaseJson flags;
  flags.set("ph", sens.phOk); flags.set("ec", sens.ecOk);
  flags.set("climate", sens.climateOk); flags.set("flow", sens.flowOk);
  flags.set("npk", sens.npkOk);
  json.set("flags", flags);
}

/** Delete the oldest history nodes until under the retention window.
 *  Runs rarely and bounded (one small query per pass) so it never stalls
 *  the control loop for long. */
static void pruneHistory() {
  time_t nowT = time(nullptr);
  if (nowT < 1700000000) return;             // no NTP time yet — skip
  time_t cutoff = nowT - (time_t)HISTORY_DAYS * 86400;
  QueryFilter q;
  q.orderBy("$key").limitToFirst(20);
  String root = DB_PATH("history");
  if (!Firebase.RTDB.getJSON(&fbdo, root.c_str(), &q)) return;
  if (fbdo.dataTypeEnum() != fb_esp_rtdb_data_type_json) return;
  FirebaseJson* json = fbdo.jsonObjectPtr();
  if (!json) return;
  size_t n = json->iteratorBegin();
  FirebaseJson::IteratorValue v;
  for (size_t i = 0; i < n; i++) {
    v = json->valueAt(i);
    String childPath = root + "/" + v.key;
    if (Firebase.RTDB.getJSON(&fbdo, childPath.c_str())) {
      int64_t ts = 0;
      FirebaseJson* child = fbdo.jsonObjectPtr();
      if (child) {
        FirebaseJsonData d;
        if (child->get(d, "ts")) ts = (int64_t)d.to<int64_t>();
      }
      if (ts > 0 && (time_t)ts < cutoff)
        Firebase.RTDB.deleteNode(&fbdo, childPath.c_str());
      else
        break;   // keys are chronological — first fresh node ends pruning
    }
  }
  json->iteratorEnd();
}

void publishTelemetry() {
  if (!dbReady()) return;
  FirebaseJson json;
  buildReadingJson(json);
  Firebase.RTDB.setJSON(&fbdo, DB_PATH("telemetry"), &json);

  if (millis() - lastHistoryMs >= HISTORY_INTERVAL_MS) {
    lastHistoryMs = millis();
    if (Firebase.RTDB.pushJSON(&fbdo, DB_PATH("history"), &json)) pruneHistory();
  }
}

void publishState() {
  if (!dbReady()) return;
  FirebaseJson json;
  json.set("pump", act.pump ? 1 : 0);
  json.set("fan", act.fan ? 1 : 0);
  json.set("misting", act.misting ? 1 : 0);
  json.set("doseA", act.doseA ? 1 : 0);
  json.set("doseB", act.doseB ? 1 : 0);
  json.set("doseN", act.doseN ? 1 : 0);
  json.set("doseP", act.doseP ? 1 : 0);
  json.set("doseK", act.doseK ? 1 : 0);
  json.set("npk_ok", sens.npkOk ? 1 : 0);
  json.set("mode", (act.mode == MODE_AUTO) ? "auto" : "manual");
  json.set("doseState", (doseState == DOSE_IDLE) ? "idle"
                        : (doseState == DOSE_RUNNING) ? "running" : "mixing");
  json.set("updated_at", (int64_t)time(nullptr));
  json.set("device_ms", (int64_t)millis());
  Firebase.RTDB.setJSON(&fbdo, DB_PATH("state"), &json);
}

void publishSettings() {
  if (!dbReady()) return;
  FirebaseJson json;
  json.set("ph_min", cfg.phMin);
  json.set("ph_max", cfg.phMax);
  json.set("ec_min", cfg.ecMin);
  json.set("ec_max", cfg.ecMax);
  json.set("temperature_setpoint", cfg.tempSetpoint);
  json.set("temperature_hysteresis", cfg.tempHyst);
  json.set("humidity_limit", cfg.humLimit);
  json.set("min_flow_rate", cfg.minFlow);
  json.set("dosing_max_runtime_s", cfg.doseMaxMs / 1000);
  json.set("dosing_cooldown_s", cfg.doseCooldownS);
  json.set("misting_max_s", cfg.mistMaxS);
  json.set("npk_n_min", cfg.npkNMin);
  json.set("npk_n_max", cfg.npkNMax);
  json.set("npk_p_min", cfg.npkPMin);
  json.set("npk_p_max", cfg.npkPMax);
  json.set("npk_k_min", cfg.npkKMin);
  json.set("npk_k_max", cfg.npkKMax);
  json.set("npk_dosing_max_runtime_s", cfg.npkDoseMaxMs / 1000);
  json.set("npk_dose_cooldown_s", cfg.npkDoseCooldownS);
  json.set("npk_dosing_enabled", cfg.npkAutoDose ? 1 : 0);
  Firebase.RTDB.setJSON(&fbdo, DB_PATH("settings"), &json);
}
