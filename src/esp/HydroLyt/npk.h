/*
 * ============================================================================
 *  npk.h — RS485 Modbus RTU NPK probe (N, P, K in mg/kg)
 * ============================================================================
 */

#pragma once

#include <Arduino.h>

/** Start UART2 + MAX485 driver-enable. Fail-soft: with no probe fitted the
 *  rest of the controller keeps running and NPK dosing stays blocked. */
void npkBegin();

/** Non-blocking poll state machine — call on every loop pass. */
void npkPollTick(uint32_t now);
