create table if not exists public.rnc_anexos (
  id uuid primary key default gen_random_uuid(),
  rnc_id uuid not null references public.rnc_registros(id) on delete cascade,
  nome_arquivo text not null,
  content_type text not null,
  tamanho_bytes bigint not null check (tamanho_bytes > 0 and tamanho_bytes <= 8388608),
  storage_path text not null unique,
  enviado_por text,
  criado_em timestamptz not null default now()
);

create index if not exists rnc_anexos_rnc_id_idx on public.rnc_anexos(rnc_id);
alter table public.rnc_anexos enable row level security;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('rnc-anexos', 'rnc-anexos', false, 8388608, array['image/jpeg','image/png','image/webp','application/pdf'])
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

create or replace function public.rnc_registrar_historico()
returns trigger
language plpgsql
set search_path = public
as $function$
declare
  v_old jsonb;
  v_new jsonb;
  v_changed jsonb := '{}'::jsonb;
  v_key text;
begin
  if tg_op = 'INSERT' then
    insert into public.rnc_historico(rnc_id, evento, detalhes)
    values (
      new.id,
      'RNC criada',
      jsonb_build_object(
        'numero', new.numero,
        'status', new.status,
        'emissor', new.emissor,
        'disposicao', new.disposicao
      )
    );
    return new;
  elsif tg_op = 'UPDATE' then
    v_old := to_jsonb(old);
    v_new := to_jsonb(new);

    for v_key in select jsonb_object_keys(v_new)
    loop
      if v_key not in ('created_at','updated_at','created_by','updated_by','criado_em','atualizado_em')
         and v_old -> v_key is distinct from v_new -> v_key then
        v_changed := v_changed || jsonb_build_object(
          v_key,
          jsonb_build_object('de', v_old -> v_key, 'para', v_new -> v_key)
        );
      end if;
    end loop;

    if v_changed <> '{}'::jsonb then
      insert into public.rnc_historico(rnc_id, evento, detalhes)
      values (new.id, 'RNC atualizada', v_changed);
    end if;
    return new;
  end if;

  return null;
end
$function$;
