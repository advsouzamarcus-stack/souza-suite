create extension if not exists pgcrypto;

create table if not exists public.users (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email text not null unique,
  password_hash text not null,
  role text not null default 'advogado' check (role in ('admin','advogado','estagiario','recepcao')),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.clients (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  cpf_cnpj text,
  phone text,
  email text,
  address text,
  notes text,
  source text,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.cases (
  id uuid primary key default gen_random_uuid(),
  client_id uuid references public.clients(id) on delete cascade,
  process_number text not null,
  court text,
  tribunal text,
  class_name text,
  subject text,
  phase text,
  status text not null default 'ativo',
  last_movement_at timestamptz,
  datajud_payload jsonb,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(process_number)
);

create table if not exists public.tasks (
  id uuid primary key default gen_random_uuid(),
  case_id uuid references public.cases(id) on delete cascade,
  client_id uuid references public.clients(id) on delete cascade,
  title text not null,
  description text,
  due_at timestamptz,
  status text not null default 'pendente' check (status in ('pendente','em_andamento','concluida','cancelada')),
  priority text not null default 'media' check (priority in ('baixa','media','alta','urgente')),
  assigned_to uuid references public.users(id) on delete set null,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.appointments (
  id uuid primary key default gen_random_uuid(),
  client_id uuid references public.clients(id) on delete set null,
  title text not null,
  description text,
  starts_at timestamptz not null,
  ends_at timestamptz,
  status text not null default 'agendado' check (status in ('agendado','confirmado','realizado','cancelado','remarcado')),
  channel text,
  google_event_id text,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.financial_records (
  id uuid primary key default gen_random_uuid(),
  client_id uuid references public.clients(id) on delete set null,
  case_id uuid references public.cases(id) on delete set null,
  description text not null,
  amount numeric(12,2) not null default 0,
  kind text not null default 'receita' check (kind in ('receita','despesa')),
  status text not null default 'pendente' check (status in ('pendente','pago','atrasado','cancelado')),
  due_at date,
  paid_at date,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.leads (
  id uuid primary key default gen_random_uuid(),
  name text,
  phone text,
  email text,
  source text,
  stage text not null default 'novo',
  summary text,
  metadata jsonb not null default '{}'::jsonb,
  converted_client_id uuid references public.clients(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.conversations (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid references public.leads(id) on delete set null,
  client_id uuid references public.clients(id) on delete set null,
  channel text not null,
  external_thread_id text,
  status text not null default 'aberta',
  ai_enabled boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid references public.conversations(id) on delete cascade,
  direction text not null check (direction in ('inbound','outbound')),
  sender text,
  body text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.datajud_events (
  id uuid primary key default gen_random_uuid(),
  case_id uuid references public.cases(id) on delete cascade,
  process_number text not null,
  tribunal text,
  event_type text,
  movement_at timestamptz,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.integration_jobs (
  id uuid primary key default gen_random_uuid(),
  integration text not null,
  status text not null default 'pending',
  input jsonb not null default '{}'::jsonb,
  output jsonb not null default '{}'::jsonb,
  error text,
  run_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_clients_name on public.clients using gin (to_tsvector('portuguese', coalesce(name,'')));
create index if not exists idx_cases_process_number on public.cases(process_number);
create index if not exists idx_appointments_starts_at on public.appointments(starts_at);
create index if not exists idx_datajud_events_process_number on public.datajud_events(process_number);
create index if not exists idx_conversations_channel_external on public.conversations(channel, external_thread_id);
