# HYDROLYT — Supabase Database Schema

PostgreSQL schema for Supabase covering the tables required in
[requirements.md §6](requirements.md#6-recommended-database-schema).

Design rules applied throughout:

- UUID primary keys (`gen_random_uuid()`), foreign keys, `timestamptz` timestamps.
- Row Level Security (RLS) enabled on **every** exposed table.
- Device writes go through a **trusted server-side ingestion path** (Edge Function /
  service-role key), never the anon key from the browser.
- No secrets, Wi-Fi passwords, or plaintext device credentials in any table.

---

## 1. Extensions

```sql
create extension if not exists "pgcrypto";
```

## 2. Enums

```sql
create type user_role    as enum ('owner', 'operator', 'viewer');
create type device_status as enum ('online', 'offline', 'maintenance');
create type op_mode      as enum ('auto', 'manual');
create type cmd_type     as enum ('pump', 'fan', 'misting', 'mode', 'settings', 'dose', 'restart');
create type cmd_status   as enum ('pending', 'sent', 'acknowledged', 'failed', 'expired');
create type severity     as enum ('info', 'warning', 'critical');
create type reading_src  as enum ('device', 'simulated');
```

> **Note:** `cmd_type` must include `'dose'`. The firmware accepts a `dose`
> command (pH channels A/B and NPK channels N/P/K), so without it any manual
> dose request fails at insert time with an enum violation.

## 3. Tables

### 3.1 `profiles`

```sql
create table public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  full_name   text,
  role        user_role not null default 'viewer',
  created_at  timestamptz not null default now()
);

alter table public.profiles enable row level security;

create policy "profiles: read own"   on public.profiles for select using (auth.uid() = id);
create policy "profiles: update own" on public.profiles for update using (auth.uid() = id);
-- role escalation is done only by an owner via service role
```

### 3.2 `devices`

```sql
create table public.devices (
  id              uuid primary key default gen_random_uuid(),
  name            text not null,
  location        text default 'Greenhouse 4x5m',
  device_key_hash text not null,          -- bcrypt/sha256 hash, never plaintext
  status          device_status not null default 'offline',
  firmware_version text,
  last_seen_at    timestamptz,
  created_at      timestamptz not null default now()
);

alter table public.devices enable row level security;

create policy "devices: readable by authenticated" on public.devices
  for select to authenticated using (true);
-- inserts/updates happen via service role only
```

### 3.3 `sensor_readings` (high volume)

```sql
create table public.sensor_readings (
  id          uuid primary key default gen_random_uuid(),
  device_id   uuid not null references public.devices (id) on delete cascade,
  recorded_at timestamptz not null default now(),
  ph          numeric(5,2),
  ec          numeric(6,2),          -- mS/cm
  temperature numeric(5,2),          -- °C
  humidity    numeric(5,2),          -- %RH
  flow_rate   numeric(6,2),          -- L/min
  npk_n       numeric(6,1),          -- mg/kg, RS485 NPK probe (null = probe fault/offline)
  npk_p       numeric(6,1),          -- mg/kg
  npk_k       numeric(6,1),          -- mg/kg
  source      reading_src not null default 'device'
);

create index sensor_readings_device_time_idx
  on public.sensor_readings (device_id, recorded_at desc);
create index sensor_readings_recorded_at_idx
  on public.sensor_readings (recorded_at desc);

alter table public.sensor_readings enable row level security;

create policy "readings: readable by authenticated" on public.sensor_readings
  for select to authenticated using (true);
-- inserts only via service role (device ingestion path)
```

**NPK columns:** `npk_n`, `npk_p`, `npk_k` are written only from the device's
dedicated RS485 NPK probe. `null` means no valid reading (probe fault, not
fitted, or pre-NPK history) — these values must never be derived from pH or EC.

**Retention:** drop rows older than 90 days to keep the telemetry table small.

```sql
create or replace function public.prune_sensor_readings()
returns void language sql as $$
  delete from public.sensor_readings where recorded_at < now() - interval '90 days';
$$;

-- schedule with pg_cron:
-- select cron.schedule('prune-readings', '17 3 * * *', 'select public.prune_sensor_readings();');
```

### 3.4 `device_states`

```sql
create table public.device_states (
  id          uuid primary key default gen_random_uuid(),
  device_id   uuid not null unique references public.devices (id) on delete cascade,
  pump_on     boolean not null default false,
  fan_on      boolean not null default false,
  misting_on  boolean not null default false,
  dosing_a_on boolean not null default false,
  dosing_b_on boolean not null default false,
  dosing_n_on boolean not null default false,   -- nitrogen peristaltic channel
  dosing_p_on boolean not null default false,   -- phosphorus peristaltic channel
  dosing_k_on boolean not null default false,   -- potassium peristaltic channel
  mode        op_mode not null default 'auto',
  updated_at  timestamptz not null default now()
);

alter table public.device_states enable row level security;

create policy "states: readable by authenticated" on public.device_states
  for select to authenticated using (true);
```

### 3.5 `control_settings`

```sql
create table public.control_settings (
  device_id           uuid primary key references public.devices (id) on delete cascade,
  ph_min              numeric(4,2) not null default 5.50,
  ph_max              numeric(4,2) not null default 6.50,
  ec_min              numeric(5,2) not null default 1.40,
  ec_max              numeric(5,2) not null default 2.50,
  temperature_setpoint numeric(5,2) not null default 28.0,   -- fan ON at/above
  temperature_hysteresis numeric(4,2) not null default 2.0,
  humidity_limit      numeric(5,2) not null default 85.0,
  min_flow_rate       numeric(6,2) not null default 2.0,     -- L/min
  dosing_cooldown_s   integer not null default 60,
  dosing_max_runtime_s integer not null default 30,
  misting_max_s       integer not null default 120,
  -- NPK closed-loop control (mg/kg as reported by the RS485 probe)
  npk_n_min           numeric(6,1) not null default 80.0,
  npk_n_max           numeric(6,1) not null default 160.0,
  npk_p_min           numeric(6,1) not null default 20.0,
  npk_p_max           numeric(6,1) not null default 50.0,
  npk_k_min           numeric(6,1) not null default 100.0,
  npk_k_max           numeric(6,1) not null default 200.0,
  npk_dosing_max_runtime_s integer not null default 5,      -- hard cap per NPK burst (s)
  npk_dose_cooldown_s integer not null default 300,         -- min seconds between bursts
  npk_dosing_enabled  boolean not null default true,        -- kill switch for auto NPK dosing
  updated_at          timestamptz not null default now(),
  constraint ph_range   check (ph_min < ph_max),
  constraint ec_range   check (ec_min < ec_max),
  constraint npk_n_range check (npk_n_min < npk_n_max),
  constraint npk_p_range check (npk_p_min < npk_p_max),
  constraint npk_k_range check (npk_k_min < npk_k_max),
  constraint limits_positive check (min_flow_rate >= 0, dosing_max_runtime_s > 0, misting_max_s > 0),
  constraint npk_limits check (
    npk_dosing_max_runtime_s between 1 and 60 and
    npk_dose_cooldown_s between 30 and 3600
  )
);

alter table public.control_settings enable row level security;

create policy "settings: read authenticated" on public.control_settings
  for select to authenticated using (true);
create policy "settings: write operators+owners" on public.control_settings
  for update to authenticated
  using (exists (select 1 from public.profiles p
                 where p.id = auth.uid() and p.role in ('owner','operator')))
  with check (exists (select 1 from public.profiles p
                 where p.id = auth.uid() and p.role in ('owner','operator')));
```

### 3.6 `control_commands`

```sql
create table public.control_commands (
  id           uuid primary key default gen_random_uuid(),
  device_id    uuid not null references public.devices (id) on delete cascade,
  command_type cmd_type not null,
  payload      jsonb not null default '{}'::jsonb,
  status       cmd_status not null default 'pending',
  created_by   uuid references auth.users (id) on delete set null,
  created_at   timestamptz not null default now(),
  sent_at      timestamptz,
  executed_at  timestamptz,
  error        text
);

create index control_commands_device_status_idx
  on public.control_commands (device_id, status, created_at desc);

alter table public.control_commands enable row level security;

create policy "commands: read authenticated" on public.control_commands
  for select to authenticated using (true);
create policy "commands: create operators+owners" on public.control_commands
  for insert to authenticated
  with check (
    exists (select 1 from public.profiles p
            where p.id = auth.uid() and p.role in ('owner','operator'))
    and auth.uid() = created_by
  );
-- status transitions only via service role (device ack path)
```

**Command validation (server-side, e.g. Edge Function):**

```ts
const ALLOWED: Record<string, (p: any) => boolean> = {
  pump:    (p) => typeof p.value === 'boolean',
  fan:     (p) => typeof p.value === 'boolean',
  misting: (p) => typeof p.value === 'boolean',
  mode:    (p) => p.value === 'auto' || p.value === 'manual',
  settings:(p) => Object.keys(p).every(k => k in SETTING_KEYS && Number.isFinite(p[k])),
  restart: () => true,
};
```

### 3.7 `dosing_logs`

```sql
create table public.dosing_logs (
  id                 uuid primary key default gen_random_uuid(),
  device_id          uuid not null references public.devices (id) on delete cascade,
  pump_id            text not null,               -- 'A' | 'B'
  reason             text,                        -- 'ph_high' | 'ph_low' | 'ec_high' | 'ec_low' | 'manual'
  duration_ms        integer not null check (duration_ms > 0),
  estimated_volume_ml numeric(7,2),
  result             text not null default 'ok',  -- 'ok' | 'blocked' | 'fault'
  created_at         timestamptz not null default now()
);

create index dosing_logs_device_time_idx on public.dosing_logs (device_id, created_at desc);

alter table public.dosing_logs enable row level security;
create policy "dosing: read authenticated" on public.dosing_logs
  for select to authenticated using (true);
```

### 3.8 `alerts`

```sql
create table public.alerts (
  id          uuid primary key default gen_random_uuid(),
  device_id   uuid not null references public.devices (id) on delete cascade,
  severity    severity not null default 'warning',
  alert_type  text not null,   -- 'out_of_range' | 'sensor_fault' | 'low_flow' | 'dosing_fault' | 'offline' | 'power'
  message     text not null,
  created_at  timestamptz not null default now(),
  resolved_at timestamptz
);

create index alerts_open_idx on public.alerts (resolved_at, created_at desc);

alter table public.alerts enable row level security;
create policy "alerts: read authenticated" on public.alerts
  for select to authenticated using (true);
create policy "alerts: resolve operators+owners" on public.alerts
  for update to authenticated
  using (exists (select 1 from public.profiles p
                 where p.id = auth.uid() and p.role in ('owner','operator')));
```

### 3.9 `device_events`

```sql
create table public.device_events (
  id         uuid primary key default gen_random_uuid(),
  device_id  uuid not null references public.devices (id) on delete cascade,
  event_type text not null,   -- 'boot' | 'watchdog' | 'wifi_loss' | 'mqtt_loss' | 'sensor_fail' | 'restart'
  details    jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index device_events_device_time_idx on public.device_events (device_id, created_at desc);

alter table public.device_events enable row level security;
create policy "events: read authenticated" on public.device_events
  for select to authenticated using (true);
```

## 4. Migration (existing databases created before NPK support)

Run these if the database already exists with the earlier, non-NPK schema.
Each statement is idempotent; `alter type` must be executed on its own (not
combined with statements that use the new value).

```sql
alter table public.sensor_readings
  add column if not exists npk_n numeric(6,1),
  add column if not exists npk_p numeric(6,1),
  add column if not exists npk_k numeric(6,1);

alter table public.device_states
  add column if not exists dosing_n_on boolean not null default false,
  add column if not exists dosing_p_on boolean not null default false,
  add column if not exists dosing_k_on boolean not null default false;

alter table public.control_settings
  add column if not exists npk_n_min numeric(6,1) not null default 80.0,
  add column if not exists npk_n_max numeric(6,1) not null default 160.0,
  add column if not exists npk_p_min numeric(6,1) not null default 20.0,
  add column if not exists npk_p_max numeric(6,1) not null default 50.0,
  add column if not exists npk_k_min numeric(6,1) not null default 100.0,
  add column if not exists npk_k_max numeric(6,1) not null default 200.0,
  add column if not exists npk_dosing_max_runtime_s integer not null default 5,
  add column if not exists npk_dose_cooldown_s integer not null default 300,
  add column if not exists npk_dosing_enabled boolean not null default true;

alter type cmd_type add value if not exists 'dose';
```

The web app reads `sensor_readings` with `select *`, so after the migration the
dashboard, history charts and CSV export pick the NPK columns up with no code
change. Until the firmware publishes NPK values, the columns stay `null` and
the UI shows "—".

## 5. Realtime

```sql
alter publication supabase_realtime add table public.sensor_readings;
alter publication supabase_realtime add table public.device_states;
alter publication supabase_realtime add table public.alerts;
alter publication supabase_realtime add table public.control_commands;
```

## 6. Security checklist

- [x] RLS enabled on all 9 tables
- [x] Reads restricted to `authenticated`; anonymous access denied by default
- [x] Configuration changes and command creation restricted to `owner`/`operator`
- [x] Device ingestion and status transitions use the service role (server-side only)
- [x] Only a **hash** of the device key stored in `devices.device_key_hash`
- [x] Telemetry retention/pruning job for `sensor_readings`
- [x] No Wi-Fi passwords or plaintext credentials anywhere in the database
