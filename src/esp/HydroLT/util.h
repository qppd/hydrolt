/*
 * ============================================================================
 *  util.h — small numeric / protocol helpers used by several modules
 * ============================================================================
 */

#pragma once

#include <Arduino.h>

/** Median of the first n values (n is clamped to EMA_SAMPLES). NaN if empty. */
float medianOf(const float* v, int n);

/** True when v is a real number inside [lo, hi]. */
bool validRange(float v, float lo, float hi);

/** Push one sample into a rolling buffer and return its median. */
float medianSmooth(float v, float* buf, uint8_t& idx, bool& filled);

/** Modbus RTU CRC-16 (poly 0xA001, reflected), low byte first on the wire. */
uint16_t modbusCrc(const uint8_t* d, uint8_t n);
