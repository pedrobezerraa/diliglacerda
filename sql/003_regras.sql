-- =====================================================================
-- DiliGLA · 003 · visões, permissões e operações
-- =====================================================================

-- ------------------------------------------------------- quem está aqui
create or replace function dg_papel()
returns papel_dg language sql stable security definer set search_path = public as $$
  select papel from membros where id = auth.uid() and ativo
$$;

create or replace function dg_gestora()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(dg_papel() = 'gestora', false)
$$;

create or replace function dg_escreve()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(dg_papel() in ('gestora', 'diligente'), false)
$$;

-- Primeiro login: a pessoa ganha uma linha em membros com papel de leitura.
-- Quem promove a diligente ou gestora é a gestora, na tela de equipe. Assim
-- ninguém entra com permissão de escrita por ter apenas criado uma conta.
create or replace function dg_ao_criar_usuario()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into membros (id, nome, email, papel)
  values (new.id,
          coalesce(new.raw_user_meta_data->>'nome', split_part(new.email, '@', 1)),
          new.email,
          case when not exists (select 1 from membros)
               then 'gestora'::papel_dg else 'leitura'::papel_dg end)
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists tg_dg_novo_usuario on auth.users;
create trigger tg_dg_novo_usuario after insert on auth.users
  for each row execute function dg_ao_criar_usuario();

-- ================================================================ visões
-- As visões rodam com a permissão de quem consulta, e não com a de quem as
-- criou: sem isso, uma visão seria porta lateral entregando linha que o RLS
-- da tabela negaria.
create or replace view v_processos with (security_invoker = on) as
select
  p.id, p.npu, p.grupo_numero,
  m.codigo as materia_codigo, m.nome as materia,
  case when p.grupo_numero is not null and m.nome is not null
       then p.grupo_numero || ' ' || m.nome end as grupo,
  p.responsavel_id, r.nome as responsavel,
  p.carteira_id, c.codigo as carteira_codigo, c.nome as carteira,
  p.bloco_codigo, b.nome as bloco, b.origem as origem_bloco,
  p.categoria, p.fase, p.valor, p.prioridade,
  p.objetivo, tipo_do_objetivo(p.objetivo) as tipo_objetivo,
  p.observacao, p.atingido, p.condicao, p.revisado_em,
  p.juizo, p.orgao_2g, p.colegiado, p.erro, p.consultado_em,
  p.ativo, p.atualizado_em,
  u.data  as ultimo_movimento_em,
  u.texto as ultimo_movimento,
  coalesce(n.total, 0) as movimentos,
  -- ritmo do item 4.1: Alta 2 dias úteis, Média quinzenal, Baixa mensal
  case p.prioridade
    when 'Alta'  then coalesce(p.revisado_em, p.criado_em) + interval '2 days'
    when 'Média' then coalesce(p.revisado_em, p.criado_em) + interval '15 days'
    else              coalesce(p.revisado_em, p.criado_em) + interval '30 days'
  end as revisar_ate,
  exists (select 1 from transferencias t
           where t.processo_id = p.id and t.status = 'proposta') as transferencia_aberta
from processos p
left join membros   r on r.id = p.responsavel_id
left join materias  m on m.id = p.materia_id
left join carteiras c on c.id = p.carteira_id
left join blocos    b on b.codigo = p.bloco_codigo
left join lateral (
  select mv.data, mv.texto from movimentos mv
   where mv.processo_id = p.id order by mv.data desc limit 1) u on true
left join lateral (
  select count(*)::int total from movimentos mv where mv.processo_id = p.id) n on true;

-- Quantas diligências cada pessoa registrou por dia, contra a meta de 15.
create or replace view v_metas with (security_invoker = on) as
select pr.por as membro_id, mb.nome, (pr.em at time zone 'America/Recife')::date as dia,
       count(*)::int as providencias, mb.meta_diaria
from providencias pr join membros mb on mb.id = pr.por
group by 1, 2, 3, 5;

-- Consolidado do setor, que é o que a gestora olha na sexta.
create or replace view v_painel with (security_invoker = on) as
select
  mb.id as membro_id, mb.nome,
  count(*) filter (where p.ativo)                                         as processos,
  count(*) filter (where p.ativo and tipo_do_objetivo(p.objetivo) = 'conclusao')        as de_conclusao,
  count(*) filter (where p.ativo and tipo_do_objetivo(p.objetivo) = 'conclusao'
                     and p.atingido is not null)                          as atingidos,
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

-- ============================================================ permissões
alter table membros        enable row level security;
alter table materias       enable row level security;
alter table carteiras      enable row level security;
alter table blocos         enable row level security;
alter table objetivo_verbos enable row level security;
alter table gatilhos       enable row level security;
alter table processos      enable row level security;
alter table movimentos     enable row level security;
alter table providencias   enable row level security;
alter table transferencias enable row level security;
alter table importacoes    enable row level security;
alter table historico      enable row level security;

-- Referências: todo mundo lê, só a gestora altera.
do $$
declare t text;
begin
  foreach t in array array['materias','carteiras','blocos','objetivo_verbos','gatilhos'] loop
    execute format('drop policy if exists le_todos on %I', t);
    execute format('create policy le_todos on %I for select to authenticated using (true)', t);
    execute format('drop policy if exists gestora_altera on %I', t);
    execute format('create policy gestora_altera on %I for all to authenticated
                    using (dg_gestora()) with check (dg_gestora())', t);
  end loop;
end $$;

-- Equipe: todos se veem, a gestora define papéis.
drop policy if exists membros_le on membros;
create policy membros_le on membros for select to authenticated using (true);
drop policy if exists membros_gestora on membros;
create policy membros_gestora on membros for all to authenticated
  using (dg_gestora()) with check (dg_gestora());
-- cada um pode corrigir o próprio nome, mas não o próprio papel
drop policy if exists membros_proprio on membros;
create policy membros_proprio on membros for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid() and papel = dg_papel());

-- Processos: todos enxergam a operação inteira, porque a passagem entre
-- carteiras só funciona se o destino puder ver o que vai receber. Escrever,
-- só no que é seu — ou qualquer um, se for a gestora.
drop policy if exists processos_le on processos;
create policy processos_le on processos for select to authenticated using (true);
drop policy if exists processos_edita on processos;
create policy processos_edita on processos for update to authenticated
  using (dg_gestora() or (dg_escreve() and responsavel_id = auth.uid()))
  with check (dg_gestora() or (dg_escreve() and responsavel_id = auth.uid()));
drop policy if exists processos_gestora on processos;
create policy processos_gestora on processos for all to authenticated
  using (dg_gestora()) with check (dg_gestora());

-- Movimentos e providências acompanham o dono do processo.
drop policy if exists mov_le on movimentos;
create policy mov_le on movimentos for select to authenticated using (true);
drop policy if exists mov_escreve on movimentos;
create policy mov_escreve on movimentos for all to authenticated
  using (dg_gestora() or exists (select 1 from processos p
          where p.id = processo_id and p.responsavel_id = auth.uid() and dg_escreve()))
  with check (dg_gestora() or exists (select 1 from processos p
          where p.id = processo_id and p.responsavel_id = auth.uid() and dg_escreve()));

drop policy if exists prov_le on providencias;
create policy prov_le on providencias for select to authenticated using (true);
drop policy if exists prov_escreve on providencias;
create policy prov_escreve on providencias for insert to authenticated
  with check (dg_escreve() and por = auth.uid());
drop policy if exists prov_apaga on providencias;
create policy prov_apaga on providencias for delete to authenticated
  using (dg_gestora() or por = auth.uid());

-- Transferências: enxergam quem entrega, quem recebe e a gestora.
drop policy if exists transf_le on transferencias;
create policy transf_le on transferencias for select to authenticated
  using (dg_gestora() or de_responsavel = auth.uid() or para_responsavel = auth.uid());

drop policy if exists hist_le on historico;
create policy hist_le on historico for select to authenticated using (true);
drop policy if exists hist_escreve on historico;
create policy hist_escreve on historico for insert to authenticated with check (dg_escreve());

drop policy if exists imp_le on importacoes;
create policy imp_le on importacoes for select to authenticated using (true);
drop policy if exists imp_escreve on importacoes;
create policy imp_escreve on importacoes for insert to authenticated
  with check (dg_escreve() and por = auth.uid());
