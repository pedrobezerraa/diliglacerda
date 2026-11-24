-- =====================================================================
-- DiliGLA · 009 · o conteúdo dos planos de trabalho
--
-- O plano (dias, processos, micrometas, metas por semana e os textos do
-- topo) tem número de processo, valor de honorário e anotação interna. Por
-- isso ele mora aqui, atrás do login, e não num arquivo do repositório: o
-- repositório é público, e um arquivo estático a Vercel entrega a qualquer
-- um que tenha o endereço.
--
-- Quem tem acesso de administração carrega o plano pela própria tela,
-- escolhendo o HTML do plano. O andamento continua em plano_marcas e
-- plano_situacoes (sql/008), ligado pelo id do plano.
-- =====================================================================

create table if not exists planos (
  id         text primary key,               -- ex.: plano-2026-11-25-a-2026-12-18
  titulo     text not null,
  dados      jsonb not null,                 -- { cabecalho, days, procs, tasks, goals }
  ativo      boolean not null default true,
  criado_por uuid references membros(id) on delete set null,
  criado_em  timestamptz not null default now()
);
comment on table planos is 'Conteúdo dos planos de trabalho; o andamento fica em plano_marcas e plano_situacoes.';

alter table planos enable row level security;

drop policy if exists planos_le on planos;
create policy planos_le on planos for select to authenticated using (true);
drop policy if exists planos_gestora on planos;
create policy planos_gestora on planos for all to authenticated
  using (dg_gestora()) with check (dg_gestora());

revoke all on planos from anon;
grant select, insert, update, delete on planos to authenticated;
