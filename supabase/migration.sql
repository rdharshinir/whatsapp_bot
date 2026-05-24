-- WhatsApp AI Agent — Database Schema
-- Run this in your Supabase SQL Editor or via Supabase CLI

-- Conversations table
create table if not exists conversations (
  id uuid default gen_random_uuid() primary key,
  phone text unique not null,
  name text,
  mode text not null default 'agent' check (mode in ('agent', 'human')),
  updated_at timestamp with time zone default now(),
  created_at timestamp with time zone default now()
);

-- Messages table
create table if not exists messages (
  id uuid default gen_random_uuid() primary key,
  conversation_id uuid references conversations(id) on delete cascade not null,
  role text not null check (role in ('user', 'assistant')),
  content text not null,
  whatsapp_msg_id text unique,
  created_at timestamp with time zone default now()
);

-- Indexes
create index if not exists idx_messages_conversation on messages(conversation_id);
create index if not exists idx_conversations_updated on conversations(updated_at desc);

-- Enable Realtime for both tables
alter publication supabase_realtime add table conversations;
alter publication supabase_realtime add table messages;

-- Row Level Security (permissive for service role usage)
alter table conversations enable row level security;
alter table messages enable row level security;

-- Allow all operations for authenticated and service_role
create policy "Allow all for service role" on conversations for all using (true) with check (true);
create policy "Allow all for service role" on messages for all using (true) with check (true);

-- Allow anon to read (for frontend realtime subscriptions)
create policy "Allow anon read conversations" on conversations for select using (true);
create policy "Allow anon read messages" on messages for select using (true);
