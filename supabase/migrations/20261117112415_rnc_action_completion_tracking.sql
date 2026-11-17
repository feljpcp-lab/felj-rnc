alter table public.rnc_acoes
  add column if not exists concluida_em timestamptz;

create index if not exists rnc_acoes_concluida_em_idx
  on public.rnc_acoes (concluida_em)
  where status = 'Concluída';

create or replace function public.rnc_acao_registrar_historico()
returns trigger
language plpgsql
set search_path = public
as $function$
begin
  if tg_op = 'INSERT' then
    if new.status = 'Concluída' and new.concluida_em is null then
      new.concluida_em := now();
    elsif new.status <> 'Concluída' then
      new.concluida_em := null;
    end if;
    insert into public.rnc_historico(rnc_id, evento, detalhes)
    values (new.rnc_id, 'Ação criada', jsonb_build_object('acao_id',new.id,'tipo',new.tipo,'descricao',new.descricao,'responsavel',new.responsavel,'prazo',new.prazo,'status',new.status,'concluida_em',new.concluida_em));
    new.atualizado_em := now();
    return new;
  elsif tg_op = 'UPDATE' then
    if new.status = 'Concluída' then
      if old.status is distinct from 'Concluída' then new.concluida_em := coalesce(new.concluida_em,now());
      else new.concluida_em := coalesce(new.concluida_em,old.concluida_em,now()); end if;
    else new.concluida_em := null;
    end if;
    insert into public.rnc_historico(rnc_id, evento, detalhes)
    values (new.rnc_id,
      case when old.status is distinct from new.status and new.status='Concluída' then 'Ação concluída'
           when old.status is distinct from new.status and old.status='Concluída' then 'Ação reaberta'
           else 'Ação atualizada' end,
      jsonb_build_object('acao_id',new.id,
        'de',jsonb_build_object('tipo',old.tipo,'descricao',old.descricao,'responsavel',old.responsavel,'prazo',old.prazo,'status',old.status,'concluida_em',old.concluida_em),
        'para',jsonb_build_object('tipo',new.tipo,'descricao',new.descricao,'responsavel',new.responsavel,'prazo',new.prazo,'status',new.status,'concluida_em',new.concluida_em)));
    new.atualizado_em := now();
    return new;
  elsif tg_op = 'DELETE' then
    insert into public.rnc_historico(rnc_id, evento, detalhes)
    values (old.rnc_id, 'Ação removida', jsonb_build_object('acao_id',old.id,'tipo',old.tipo,'descricao',old.descricao,'responsavel',old.responsavel,'prazo',old.prazo,'status',old.status,'concluida_em',old.concluida_em));
    return old;
  end if;
  return null;
end
$function$;
