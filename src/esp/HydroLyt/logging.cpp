/*
 * ============================================================================
 *  logging.cpp — serial log helper
 * ============================================================================
 */

#include "logging.h"

void logLine(const String& msg) {
  Serial.printf("[%8lu] %s\n", millis(), msg.c_str());
}
