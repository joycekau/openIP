-- oneIP × CoraX — auto-list a creator token the moment a creator lists their first product.
--
-- Target project: CoraX Supabase (aokaupvmtakfegdpyvky), which owns the relational oneIP model.
-- Scope decision: NOT every CoraX signup is an oneIP creator, so we do not fire on account
-- creation. A user "becomes a creator" the moment they list a product (public.channel_products),
-- so that is the trigger point. First product ⇒ one DRAFT token in public.oneip_creator_tokens.
-- The on-chain mint happens later (wallet-signed); launch_status flips 'draft' -> 'launched' then.
--
-- Design / safety:
--   • creator_id = channel_products.creator_id, which is an auth user id — the same key space as
--     oneip_creator_tokens.creator_id (FK -> auth.users(id) ON DELETE CASCADE). Verified: every
--     existing channel_products.creator_id resolves to a profiles row.
--   • name/symbol come from the creator's profile (display_name -> username -> 'Creator').
--   • mint_address is NOT NULL + UNIQUE and no real mint exists yet, so we write a deterministic
--     placeholder 'draft:<creator_id>' — unique per creator and idempotent.
--   • Idempotent two ways: an EXISTS guard (skip if the creator already has a token — so only the
--     FIRST product creates one) + ON CONFLICT (mint_address) DO NOTHING.
--   • SECURITY DEFINER so it runs under RLS; search_path pinned to public.
--   • NON-FATAL: the insert is wrapped so a failure only warns — it can never abort a product listing.
--
-- No backfill: existing accounts are intentionally left untouched. Existing creators get a token the
-- next time they list a product; regular (non-creator) accounts never get one.

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
  -- one draft token per creator; only the FIRST product creates it
  if exists (select 1 from public.oneip_creator_tokens where creator_id = NEW.creator_id) then
    return NEW;
  end if;

  select coalesce(nullif(btrim(p.display_name), ''), nullif(btrim(p.username), ''), 'Creator')
    into v_name
    from public.profiles p
   where p.user_id = NEW.creator_id
   limit 1;
  v_name := coalesce(v_name, 'Creator');

  -- symbol: uppercase alphanumerics of the name, capped at 6, with a non-empty fallback
  v_symbol := left(upper(regexp_replace(v_name, '[^A-Za-z0-9]', '', 'g')), 6);
  if length(coalesce(v_symbol, '')) < 1 then
    v_symbol := 'TOKEN';
  end if;

  begin
    insert into public.oneip_creator_tokens (creator_id, name, symbol, mint_address, launch_status)
    values (NEW.creator_id, left(v_name, 60), v_symbol, 'draft:' || NEW.creator_id::text, 'draft')
    on conflict (mint_address) do nothing;
  exception when others then
    -- never block a product listing on token creation
    raise warning 'oneip_auto_create_creator_token failed for creator_id=%: %', NEW.creator_id, sqlerrm;
  end;

  return NEW;
end;
$$;

-- Fire on product listing (drop any earlier signup-based trigger if a prior version was applied).
drop trigger if exists trg_oneip_auto_create_token on public.profiles;
drop trigger if exists trg_oneip_auto_create_token on public.channel_products;
create trigger trg_oneip_auto_create_token
after insert on public.channel_products
for each row execute function public.oneip_auto_create_creator_token();
