/*
 * ============================================================================
 *  commands.h — remote command handling (validated input, FR-07/10/12)
 * ----------------------------------------------------------------------------
 *  The web app pushes a command object to devices/{id}/commands/{key}; the
 *  RTDB stream delivers it, the device validates + executes it, writes an
 *  acknowledgement and removes the processed node.
 * ============================================================================
 */

#pragma once

#include <Arduino.h>

/** Push an acknowledgement to devices/{id}/acks. */
void sendAck(const String& id, const char* status, const String& note = "");

/** Manual actuators are only allowed in MANUAL mode (auto-acks a reject). */
bool manualAllowed(const String& id);

/** Validate and execute one command payload (JSON: {cmd, id, value, ...}). */
void handleCommand(const char* payload, unsigned int length);

/** Attach the RTDB stream to devices/{id}/commands. */
void commandsBeginStream();

/** Reattach the stream if the library dropped it (e.g. after a Wi-Fi blip). */
void commandsStreamTick();

/** Execute every not-yet-executed command child, then remove it. */
void processPendingCommands();
