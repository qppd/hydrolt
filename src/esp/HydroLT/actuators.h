/*
 * ============================================================================
 *  actuators.h — relays, safety stops and the single-channel dosing rule
 * ============================================================================
 */

#pragma once

#include "types.h"

/** Drive one relay, honouring RELAY_ACTIVE_LOW. */
void setRelay(int pin, bool on);

/** Configure all outputs inactive BEFORE pinMode (no relay glitching). */
void actuatorsBegin();

/** De-energise every dosing pump and leave the dosing state machine idle. */
void stopAllDosing(const char* why);

/** Exactly one dose channel may be energised at a time (pH/EC and NPK share
 *  this rule, so nutrient + pH corrections can never overlap). */
void setDoseChannel(DoseChannel ch);

/** Stop the irrigation pump (if running) and clear the flow-check latch. */
void stopIrrigation(const char* why);
