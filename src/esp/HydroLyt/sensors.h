/*
 * ============================================================================
 *  sensors.h — pH, EC, DHT22 and flow acquisition
 * ============================================================================
 */

#pragma once

#include <Arduino.h>

/** Configure the ADC, the DHT22 and the flow-sensor interrupt. */
void sensorsBegin();

/** Flow-sensor ISR (IRAM, interrupt context). */
void IRAM_ATTR flowPulseISR();

/** Sample every sensor at SENSOR_SAMPLE_MS, updating `sens` and its validity
 *  flags. Non-blocking: returns immediately when not yet due. */
void sampleSensors();

/** One median-filtered pH reading (raw ADC -> engineering units). */
float readPh();

/** One median-filtered EC reading in mS/cm. */
float readEc();
