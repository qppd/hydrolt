/*
 * ============================================================================
 *  util.cpp — numeric helpers and the Modbus RTU CRC
 * ============================================================================
 */

#include "util.h"

#include "config.h"

float medianOf(const float* v, int n) {
  // simple insertion sort on a small buffer, returns median
  float tmp[EMA_SAMPLES];
  int c = n < EMA_SAMPLES ? n : EMA_SAMPLES;
  if (c <= 0) return NAN;
  if (c == 1) return v[0];
  for (int i = 0; i < c; i++) tmp[i] = v[i];
  for (int i = 1; i < c; i++) {
    float k = tmp[i]; int j = i - 1;
    while (j >= 0 && tmp[j] > k) { tmp[j + 1] = tmp[j]; j--; }
    tmp[j + 1] = k;
  }
  return c % 2 ? tmp[c / 2] : (tmp[c / 2 - 1] + tmp[c / 2]) / 2.0f;
}

bool validRange(float v, float lo, float hi) {
  return !isnan(v) && v >= lo && v <= hi;
}

float medianSmooth(float v, float* buf, uint8_t& idx, bool& filled) {
  buf[idx] = v;
  idx = (uint8_t)((idx + 1) % EMA_SAMPLES);
  if (idx == 0) filled = true;
  int n = filled ? EMA_SAMPLES : idx;
  float tmp[EMA_SAMPLES];
  for (int i = 0; i < n; i++) tmp[i] = buf[i];
  return medianOf(tmp, n);
}

uint16_t modbusCrc(const uint8_t* d, uint8_t n) {
  uint16_t crc = 0xFFFF;
  for (uint8_t i = 0; i < n; i++) {
    crc ^= d[i];
    for (uint8_t b = 0; b < 8; b++)
      crc = (crc & 0x0001) ? (uint16_t)((crc >> 1) ^ 0xA001) : (uint16_t)(crc >> 1);
  }
  return crc;
}
