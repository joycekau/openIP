-- oneIP × CoraX — auto-list a creator token the moment an account is created.
--
-- Target project: CoraX Supabase (aokaupvmtakfegdpyvky), which owns the relational oneIP model.
-- On every new public.profiles row we insert one DRAFT token into public.oneip_creator_tokens.
-- The on-chain mint happens later (wallet-signed); launch_status flips 'draft' -> 'launched' then.
--
-- Design / safety:
--   • creator_id = profiles.user_id  (FK oneip_creator_tokens.creator_id -> auth.users(id) ON DELETE CASCADE)
--   • mint_address is NOT NULL + UNIQUE, and no real mint exists yet at signup, so we write a
--     deterministic placeholder 'draft:<user_id>' — unique per creator and idempotent.
--   • Idempotent two ways: an EXISTS guard + ON CONFLICT (mint_address) DO NOTHING.
--   • SECURITY DEFINER so it runs under RLS; search_path pinned to public.
--   • NON-FATAL: the insert is wrapped so a failure only warns — it can never abort account creation
--     (this trigger sits on the critical signup path).
--   • Hooked AFTER INSERT ON profiles, so trigger_set_default_username has already set NEW.username.

create or replace function public.oneip_auto_create_creator_token()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name   text;
  v_symbol text;
begin
  -- one draft token per creator
  if exists (select 1 from public.oneip_creator_tokens where creator_id = NEW.user_id) then
    return NEW;
  end if;

  v_name := coalesce(nullif(btrim(NEW.display_name), ''), nullif(btrim(NEW.username), ''), 'Creator');
  -- symbol: uppercase alphanumerics of the name, capped at 6, with a non-empty fallback
  v_symbol := left(upper(regexp_replace(v_name, '[^A-Za-z0-9]', '', 'g')), 6);
  if length(coalesce(v_symbol, '')) < 1 then
    v_symbol := 'TOKEN';
  end if;

  begin
    insert into public.oneip_creator_tokens (creator_id, name, symbol, mint_address, launch_status)
    values (NEW.user_id, left(v_name, 60), v_symbol, 'draft:' || NEW.user_id::text, 'draft')
    on conflict (mint_address) do nothing;
  exception when others then
    -- never block signup on token creation
    raise warning 'oneip_auto_create_creator_token failed for user_id=%: %', NEW.user_id, sqlerrm;
  end;

  return NEW;
end;
$$;

drop trigger if exists trg_oneip_auto_create_token on public.profiles;
create trigger trg_oneip_auto_create_token
after insert on public.profiles
for each row execute function public.oneip_auto_create_creator_token();

-- ─────────────────────────────────────────────────────────────────────────────
-- OPTIONAL backfill for the accounts that already exist (run only if you want the
-- existing users listed too; leave commented to apply to NEW signups only).
--
-- insert into public.oneip_creator_tokens (creator_id, name, symbol, mint_address, launch_status)
-- select p.user_id,
--        left(coalesce(nullif(btrim(p.display_name), ''), nullif(btrim(p.username), ''), 'Creator'), 60),
--        coalesce(nullif(left(upper(regexp_replace(
--          coalesce(nullif(btrim(p.display_name), ''), nullif(btrim(p.username), ''), 'Creator'),
--          '[^A-Za-z0-9]', '', 'g')), 6), ''), 'TOKEN'),
--        'draft:' || p.user_id::text,
--        'draft'
-- from public.profiles p
-- where not exists (select 1 from public.oneip_creator_tokens t where t.creator_id = p.user_id)
-- on conflict (mint_address) do nothing;
