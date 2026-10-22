/*
 * ============================================================================
 *  npk.cpp — Modbus RTU master for the RS485 NPK probe
 * ----------------------------------------------------------------------------
 *  Request : addr, fn 0x03, register 0x0000, count 3  ->  N, P, K as mg/kg
 *  Response: addr fn bytecount(06) N N P P K K CRC16  = 11 bytes, CRC low first.
 * ============================================================================
 */

#include "npk.h"

#include "config.h"
#include "firebase_db.h"
#include "logging.h"
#include "state.h"
#include "util.h"

static void npkSendRequest() {
  uint8_t req[8] = { NPK_SLAVE_ADDR, 0x03, 0x00, 0x00, 0x00, 0x03, 0x00, 0x00 };
  uint16_t crc = modbusCrc(req, 6);
  req[6] = (uint8_t)(crc & 0xFF);
  req[7] = (uint8_t)(crc >> 8);

  digitalWrite(PIN_NPK_DE, HIGH);   // MAX485 DE+RE high = we drive the bus
  Serial2.write(req, sizeof(req));
  Serial2.flush();                  // ~17 ms at 4800 baud; last bit fully shifted out
  digitalWrite(PIN_NPK_DE, LOW);    // release the bus for the reply

  npkRxLen = 0;
  npkWaitStartMs = millis();
  npkPollState = NPK_POLL_WAIT;
}

static void npkFinishFrame(uint32_t now) {
  npkPollState = NPK_POLL_IDLE;
  const uint8_t* b = npkRxBuf;

  bool ok = (npkRxLen == 11 && b[0] == NPK_SLAVE_ADDR && b[1] == 0x03 && b[2] == 0x06);
  if (ok) {
    uint16_t crc = modbusCrc(b, 9);
    ok = (b[9] == (uint8_t)(crc & 0xFF)) && (b[10] == (uint8_t)(crc >> 8));
  }

  float rawN = NAN, rawP = NAN, rawK = NAN;
  if (ok) {
    rawN = (float)((b[3] << 8) | b[4]);
    rawP = (float)((b[5] << 8) | b[6]);
    rawK = (float)((b[7] << 8) | b[8]);
    ok = validRange(rawN, NPK_VALID_MIN, NPK_VALID_MAX) &&
         validRange(rawP, NPK_VALID_MIN, NPK_VALID_MAX) &&
         validRange(rawK, NPK_VALID_MIN, NPK_VALID_MAX);
  }

  if (!ok) {
    if (npkFails < 255) npkFails++;
    if (npkFails >= NPK_FAIL_LIMIT &&
        (sens.npkOk || lastNpkFaultAlertMs == 0 ||
         now - lastNpkFaultAlertMs >= NPK_ALERT_THROTTLE_MS)) {
      lastNpkFaultAlertMs = now;
      sens.npkOk = false;
      sens.npkN = sens.npkP = sens.npkK = NAN;
      logLine(String("NPK PROBE FAULT (fails=") + npkFails + ", rxLen=" + npkRxLen + ")");
      publishAlert("critical", "npk_sensor_fault",
                   "No valid frame from the NPK probe. NPK dosing is blocked until the "
                   "probe recovers; pH/EC control is unaffected.");
    }
    return;
  }

  // valid frame -> smooth and store
  static float bN[EMA_SAMPLES]; static uint8_t iN = 0; static bool fN = false;
  static float bP[EMA_SAMPLES]; static uint8_t iP = 0; static bool fP = false;
  static float bK[EMA_SAMPLES]; static uint8_t iK = 0; static bool fK = false;
  float vN = medianSmooth(rawN, bN, iN, fN);
  float vP = medianSmooth(rawP, bP, iP, fP);
  float vK = medianSmooth(rawK, bK, iK, fK);

  bool wasOk = sens.npkOk;
  sens.npkN = vN;
  sens.npkP = vP;
  sens.npkK = vK;
  sens.npkOk = validRange(vN, NPK_VALID_MIN, NPK_VALID_MAX) &&
               validRange(vP, NPK_VALID_MIN, NPK_VALID_MAX) &&
               validRange(vK, NPK_VALID_MIN, NPK_VALID_MAX);
  npkFails = 0;

  if (!wasOk && sens.npkOk) {
    logLine(String("NPK probe online: N=") + String(vN, 1) +
            " P=" + String(vP, 1) + " K=" + String(vK, 1) + " mg/kg");
    publishEvent("npk_ok", "probe answering again");
  }
}

void npkBegin() {
  if (NPK_ENABLED) {
    digitalWrite(PIN_NPK_DE, LOW);        // receive mode before pinMode
    pinMode(PIN_NPK_DE, OUTPUT);
    Serial2.begin(NPK_BAUD, SERIAL_8N1, PIN_NPK_RX, PIN_NPK_TX);
    npkNextPollMs = millis();             // first poll right away
    logLine(String("NPK probe: Modbus RTU @ ") + NPK_BAUD + " baud, addr " +
            NPK_SLAVE_ADDR + " (pins " + PIN_NPK_RX + "/" + PIN_NPK_TX + ", DE " + PIN_NPK_DE + ")");
  } else {
    logLine("NPK probe: disabled in configuration (NPK_ENABLED = false)");
  }
}

void npkPollTick(uint32_t now) {
  if (!NPK_ENABLED) return;

  if (npkPollState == NPK_POLL_IDLE) {
    if ((int32_t)(now - npkNextPollMs) >= 0) {
      npkNextPollMs = now + NPK_SAMPLE_MS;
      npkSendRequest();
    }
    return;
  }

  while (npkRxLen < sizeof(npkRxBuf) && Serial2.available() > 0) {
    npkRxBuf[npkRxLen++] = (uint8_t)Serial2.read();
  }
  if (npkRxLen >= 11 || (now - npkWaitStartMs) >= NPK_RESP_TIMEOUT_MS) {
    npkFinishFrame(now);
  }
}
