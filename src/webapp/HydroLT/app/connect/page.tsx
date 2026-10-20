"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Badge from "@/components/Badge";
import { useAuth } from "@/hooks/useAuth";
import { usePairedDevice, type PairedDevice } from "@/lib/device";
import { DEMO_MODE, DEVICE_ID, fbDb } from "@/lib/firebase";

export default function ConnectPage() {
  const router = useRouter();
  const { user, loading } = useAuth();
  const { deviceId, ready, pair, unpair } = usePairedDevice();

  const [input, setInput] = useState("");
  const [device, setDevice] = useState<PairedDevice | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Load the currently-paired device record for display.
  useEffect(() => {
    if (!deviceId || DEMO_MODE || !fbDb()) return;
    let cancelled = false;
    import("firebase/database").then(({ ref, get }) =>
      get(ref(fbDb()!, `devices/${deviceId}/info`)).then((snap) => {
        if (cancelled || !snap.exists()) return;
        const v = snap.val() ?? {};
        setDevice({
          id: deviceId,
          name: v.name ?? null,
          location: v.location ?? null,
          status: v.status ?? null,
          firmware_version: v.firmware_version ?? null,
        });
      })
    );
    return () => {
      cancelled = true;
    };
  }, [deviceId]);

  // Guards: demo mode needs no auth or pairing; real mode requires a session.
  useEffect(() => {
    if (DEMO_MODE) return;
    if (ready && !loading && !user) router.replace("/login");
  }, [ready, loading, user, router]);

  async function connect(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      const d = await pair(input);
      setDevice(d);
      setMessage(`Connected to “${d.name ?? d.id}”. Opening dashboard…`);
      setTimeout(() => router.push("/"), 900);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Could not connect to that device.");
    } finally {
      setBusy(false);
    }
  }

  function disconnect() {
    unpair();
    setDevice(null);
    setMessage("Device disconnected. Enter a device ID to connect again.");
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Connect to your machine</h1>
          <p>
            Enter the controller&apos;s <strong>unique device ID</strong> to link this account
            to your grow system. Find it on the device label, or on the serial monitor
            (115200 baud) at boot.
          </p>
        </div>
        <Badge tone={DEMO_MODE ? "warn" : deviceId ? "ok" : "warn"}>
          {DEMO_MODE ? "SIMULATED DEVICE" : deviceId ? "DEVICE CONNECTED" : "NOT CONNECTED"}
        </Badge>
      </div>

      <section className="grid grid-2">
        <form className="card" onSubmit={connect}>
          <header className="card-head">
            <h2>Device ID</h2>
          </header>
          <div className="form-grid" style={{ gridTemplateColumns: "1fr" }}>
            <label className="field">
              Unique device ID
              <input
                type="text"
                required
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder={DEMO_MODE ? DEVICE_ID : "e.g. 3f1a…-…-…-…-…"}
                disabled={DEMO_MODE}
              />
            </label>
          </div>
          <div className="btn-row" style={{ marginTop: 16 }}>
            <button className="btn btn-primary" type="submit" disabled={busy || DEMO_MODE}>
              {busy ? "Connecting…" : "Connect"}
            </button>
            {deviceId ? (
              <button className="btn" type="button" onClick={disconnect}>
                Disconnect
              </button>
            ) : null}
          </div>
          {message ? <p className="notice" style={{ marginTop: 14 }}>{message}</p> : null}
          <p className="hint" style={{ marginTop: 14 }}>
            The ID is validated against your account&apos;s registered devices before linking.
            In demo mode a simulated controller is connected automatically.
          </p>
        </form>

        <div className="card">
          <header className="card-head">
            <h2>Connection</h2>
          </header>
          {device ? (
            <dl className="kv">
              <dt>Name</dt>
              <dd>{device.name ?? "—"}</dd>
              <dt>Device ID</dt>
              <dd className="mono">{device.id}</dd>
              <dt>Location</dt>
              <dd>{device.location ?? "—"}</dd>
              <dt>Firmware</dt>
              <dd>{device.firmware_version ?? "—"}</dd>
              <dt>Status</dt>
              <dd>{device.status ?? "—"}</dd>
            </dl>
          ) : (
            <p className="hint">
              Not connected yet. Enter your device ID to start monitoring pH, EC, climate,
              flow and NPK from your machine.
            </p>
          )}
          <p className="hint" style={{ marginTop: 12 }}>
            Telemetry path: ESP32 → Firebase RTDB → this app. The link is read-only for
            sensors; control commands require an owner/operator role.
          </p>
        </div>
      </section>
    </>
  );
}
