/*
 * ============================================================================
 *  connectivity.cpp — Wi-Fi and Firebase session maintenance
 * ============================================================================
 */

#include "connectivity.h"

#include <Firebase_ESP_Client.h>
#include <WiFi.h>

#include "commands.h"
#include "config.h"
#include "firebase_db.h"
#include "logging.h"
#include "state.h"

void maintainWifi(uint32_t now) {
  if (WiFi.status() == WL_CONNECTED) {
    if (!wifiWasConnected) {
      wifiWasConnected = true;
      logLine(String("WiFi connected: ") + WiFi.localIP().toString());
      publishEvent("wifi_up", WiFi.localIP().toString());
    }
    return;
  }
  if (wifiWasConnected) {
    wifiWasConnected = false;
    logLine("WiFi lost — local automation continues");
    publishEvent("wifi_loss", "continuing local automation");
  }
  if (now - lastWifiTryMs >= WIFI_RETRY_MS) {
    lastWifiTryMs = now;
    WiFi.disconnect();
    WiFi.begin(WIFI_SSID, WIFI_PASS);
    logLine("WiFi: connecting...");
  }
}

void maintainFirebase(uint32_t now) {
  if (WiFi.status() != WL_CONNECTED) return;

  if (!fbSignedIn) {
    if (now - lastFbTryMs < FB_RETRY_MS) return;
    lastFbTryMs = now;
    Firebase.begin(&fbConfig, &fbAuth);
    Firebase.reconnectWiFi(true);
    logLine("Firebase: signing in...");
  }
  if (!Firebase.ready()) return;

  if (!fbSignedIn) {
    fbSignedIn = true;
    logLine(String("Firebase RTDB ready: ") + FB_DB_URL);
    // attach the command stream (fires on every push to commands/)
    commandsBeginStream();
    // presence + initial state
    Firebase.RTDB.setString(&fbdo, DB_PATH("status"), "online");
    publishSettings();
    publishState();
    publishEvent("boot", String("reset_reason=") + (int)esp_reset_reason());
  }

  // reattach the stream if the library dropped it (e.g. after a Wi-Fi blip)
  commandsStreamTick();

  processPendingCommands();
}
