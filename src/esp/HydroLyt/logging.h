/*
 * ============================================================================
 *  logging.h — serial log helper
 * ============================================================================
 */

#pragma once

#include <Arduino.h>

/** Print one timestamped line to the serial monitor (115200 baud). */
void logLine(const String& msg);
