/*
 * ============================================================================
 *  automation.h — local control loops (nutrient, water flow, climate)
 * ----------------------------------------------------------------------------
 *  These run on every main-loop pass and never depend on the network: the
 *  greenhouse keeps working with the link down (FR-10).
 * ============================================================================
 */

#pragma once

#include <Arduino.h>

/** pH/EC correction plus closed-loop N/P/K dosing (probe values only). */
void automationDosing(uint32_t now);

/** Irrigation pump flow verification and the continuous low-flow guard. */
void automationFlow(uint32_t now);

/** Exhaust fan hysteresis + bounded misting. */
void automationClimate(uint32_t now);
