// Local credentials — git-ignored. Generated from secrets.h.example.
// Firebase block mirrors src/webapp/HydroLT/.env.local (project: hydrolyt).
#pragma once

// --- Wi-Fi ------------------------------------------------------------------
// Must be the same 2.4 GHz network the greenhouse controller runs on.
#define HYDRO_WIFI_SSID     "QPPD SOFTWARE DEV"
#define HYDRO_WIFI_PASS     "Programmer136+"

// --- Firebase (Web API key + Realtime Database URL, not a DB secret) --------
// NEXT_PUBLIC_FB_API_KEY      -> HYDRO_FB_API_KEY
// NEXT_PUBLIC_FB_DATABASE_URL -> HYDRO_FB_DB_URL
// NEXT_PUBLIC_DEVICE_ID       -> HYDRO_DEVICE_ID
#define HYDRO_FB_API_KEY    "AIzaSyDPmkIBPZgizpQz-pQ13kzJJctB2Pcnv7M"
#define HYDRO_FB_DB_URL     "https://hydrolyt-default-rtdb.firebaseio.com"
// Auth -> Users account the device signs in with (email/password provider).
#define HYDRO_FB_EMAIL      "iotqppd@gmail.com"
#define HYDRO_FB_PASSWORD   "Admin1+"

// Node root in the RTDB: devices/{HYDRO_DEVICE_ID}/...
#define HYDRO_DEVICE_ID     "hydro-01"
