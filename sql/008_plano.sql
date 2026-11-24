-- =====================================================================
-- DiliGLA · 008 · andamento dos planos de trabalho (Plano Vivíssima)
--
-- O plano em si — dias, processos, micrometas e metas por semana — é fixo e
-- mora em js/plano-vivissima.js. O que muda com o trabalho da equipe mora
-- aqui: a marcação de cada micrometa e a situação de cada processo.
--
-- A coluna "plano" deixa a mesma tabela servir aos planos seguintes sem
-- misturar o andamento de um com o de outro.
--
-- Todos enxergam o andamento de todos. Quem escreve na base (diligente ou
-- administração) pode marcar; a leitura só enxerga.
-- =====================================================================

create table if not exists plano_marcas (
  plano   text not null,                   -- 'vivissima-1812'
  tarefa  text not null,                   -- id da micrometa no plano: t001, t002, ...
  feito   boolean not null default false,
  por     uuid references membros(id) on delete set null,
  em      timestamptz not null default now(),
  primary key (plano, tarefa)
);
comment on table plano_marcas is 'Micrometas cumpridas de cada plano de trabalho.';

create table if not exists plano_situacoes (
  plano    text not null,
  npu      text not null,                  -- como está no plano: 0000000-00.0000.8.17.0000
  situacao text not null,                  -- Pendente, Comunicação acionada, ..., Expedido, Impedimento
  por      uuid references membros(id) on delete set null,
  em       timestamptz not null default now(),
  primary key (plano, npu)
);
comment on table plano_situacoes is 'Situação de cada processo dentro de um plano de trabalho.';

alter table plano_marcas    enable row level security;
alter table plano_situacoes enable row level security;

do $$
declare t text;
begin
  foreach t in array array['plano_marcas', 'plano_situacoes'] loop
    execute format('drop policy if exists %I on %I', t || '_le', t);
    execute format('create policy %I on %I for select to authenticated using (true)', t || '_le', t);
    execute format('drop policy if exists %I on %I', t || '_insere', t);
    execute format('create policy %I on %I for insert to authenticated with check (dg_escreve())', t || '_insere', t);
    execute format('drop policy if exists %I on %I', t || '_altera', t);
    execute format('create policy %I on %I for update to authenticated using (dg_escreve()) with check (dg_escreve())', t || '_altera', t);
    execute format('drop policy if exists %I on %I', t || '_apaga', t);
    execute format('create policy %I on %I for delete to authenticated using (dg_gestora())', t || '_apaga', t);
    execute format('revoke all on %I from anon', t);
    execute format('grant select, insert, update, delete on %I to authenticated', t);
  end loop;
end $$;
