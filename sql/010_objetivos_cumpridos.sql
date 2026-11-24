-- =====================================================================
-- DiliGLA · 010 · próximo objetivo, sem perder o que foi cumprido
--
-- Cada processo tem um objetivo por vez. Quando ele é atingido, a pessoa
-- escolhe o próximo (da lista dos objetivos já usados na base) e o
-- concluído vai para objetivos_cumpridos. Ele continua contando: o
-- relatório de objetivos e o Painel do setor somam o histórico ao que está
-- marcado hoje, na data em que foi atingido e para quem era o responsável
-- naquele momento.
--
-- A troca é feita por dg_proximo_objetivo, numa transação só: guarda o
-- cumprido, põe o novo em aberto e deixa a linha no histórico do processo.
-- =====================================================================

create table if not exists objetivos_cumpridos (
  id             bigserial primary key,
  processo_id    uuid not null references processos(id) on delete cascade,
  objetivo       text not null,
  tipo           tipo_objetivo not null,          -- como era classificado quando foi cumprido
  atingido_em    timestamptz not null,
  responsavel_id uuid references membros(id) on delete set null,   -- de quem era o processo
  registrado_por uuid references membros(id) on delete set null,
  substituido_em timestamptz not null default now()
);
create index if not exists ix_cumpridos_resp on objetivos_cumpridos(responsavel_id, atingido_em);
create index if not exists ix_cumpridos_proc on objetivos_cumpridos(processo_id);
comment on table objetivos_cumpridos is 'Objetivos atingidos e já substituídos pelo próximo; seguem contando nos relatórios.';

alter table objetivos_cumpridos enable row level security;
drop policy if exists cumpridos_le on objetivos_cumpridos;
create policy cumpridos_le on objetivos_cumpridos for select to authenticated using (true);
-- a escrita normal é pela função; a administração pode corrigir à mão
drop policy if exists cumpridos_gestora on objetivos_cumpridos;
create policy cumpridos_gestora on objetivos_cumpridos for all to authenticated
  using (dg_gestora()) with check (dg_gestora());
revoke all on objetivos_cumpridos from anon;
grant select, insert, update, delete on objetivos_cumpridos to authenticated;
grant usage on sequence objetivos_cumpridos_id_seq to authenticated;

-- ======================================================================
-- Trocar o objetivo atingido pelo próximo
-- ======================================================================
create or replace function dg_proximo_objetivo(p_processo uuid, p_objetivo text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  eu   uuid := auth.uid();
  novo text := nullif(btrim(coalesce(p_objetivo, '')), '');
  pr   processos%rowtype;
begin
  if not dg_escreve() then raise exception 'Sem permissão para trocar o objetivo.'; end if;
  if novo is null then raise exception 'Escolha o próximo objetivo.'; end if;
  select * into pr from processos where id = p_processo for update;
  if not found then raise exception 'Processo não encontrado.'; end if;
  if not dg_gestora() and pr.responsavel_id is distinct from eu then
    raise exception 'Só o responsável pelo processo, ou a administração, define o próximo objetivo.';
  end if;
  if pr.atingido is null then
    raise exception 'O objetivo atual ainda não está marcado como atingido.';
  end if;

  insert into objetivos_cumpridos (processo_id, objetivo, tipo, atingido_em, responsavel_id, registrado_por)
  values (pr.id, coalesce(nullif(btrim(pr.objetivo), ''), '(sem objetivo)'), tipo_do_objetivo(pr.objetivo),
          pr.atingido, pr.responsavel_id, eu);

  update processos set objetivo = novo, atingido = null, condicao = null,
                       revisado_em = now(), atualizado_por = eu
   where id = pr.id;

  insert into historico (processo_id, tipo, texto, de, para, por)
  values (pr.id, 'objetivo', 'Objetivo atingido e substituído pelo próximo', pr.objetivo, novo, eu);

  return jsonb_build_object('ok', true);
end $$;
revoke execute on function dg_proximo_objetivo(uuid, text) from public, anon;
grant execute on function dg_proximo_objetivo(uuid, text) to authenticated;

-- ======================================================================
-- Painel do setor: o que foi cumprido e substituído continua contando
-- ======================================================================
create or replace view v_painel with (security_invoker = on) as
select
  mb.id as membro_id, mb.nome,
  count(*) filter (where p.ativo)                                         as processos,
  count(*) filter (where p.ativo and tipo_do_objetivo(p.objetivo) = 'conclusao')
    + (select count(*) from objetivos_cumpridos oc
        where oc.responsavel_id = mb.id and tipo_do_objetivo(oc.objetivo) = 'conclusao') as de_conclusao,
  count(*) filter (where p.ativo and tipo_do_objetivo(p.objetivo) = 'conclusao'
                     and p.atingido is not null)
    + (select count(*) from objetivos_cumpridos oc
        where oc.responsavel_id = mb.id and tipo_do_objetivo(oc.objetivo) = 'conclusao') as atingidos,
  count(*) filter (where p.ativo and tipo_do_objetivo(p.objetivo) = 'acompanhamento')   as acompanhamento,
  count(*) filter (where p.ativo and p.categoria = 'tutelada')            as tutelados,
  count(*) filter (where p.ativo and p.prioridade = 'Alta')               as alta,
  count(*) filter (where p.ativo and not exists
                    (select 1 from movimentos mv where mv.processo_id = p.id)) as sem_andamento,
  count(*) filter (where p.ativo and p.erro is not null)                  as com_erro
from membros mb
left join processos p on p.responsavel_id = mb.id
where mb.ativo
group by 1, 2;
