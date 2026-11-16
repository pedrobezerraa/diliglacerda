-- =====================================================================
-- DiliGLA · 006 · pauta de julgamento
--
-- O resultado da última verificação de pauta de cada processo (DataJud +
-- DJEN, pela função /api/pauta). Fica no banco, e não só na tela de quem
-- verificou, por dois motivos: a equipe inteira enxerga quem está em pauta
-- sem refazer a consulta, e a carteira mostra a data da sessão na linha do
-- processo.
--
-- Uma linha por processo: a verificação seguinte substitui a anterior.
-- =====================================================================

create table if not exists pautas (
  processo_id    uuid primary key references processos(id) on delete cascade,
  -- incluido_em_pauta, adiado, retirado_de_pauta, julgado,
  -- sem_registro_de_pauta ou indeterminado (ver api/pauta.js)
  situacao       text not null,
  incluido       boolean not null default false,
  resumo         text,
  proxima_sessao jsonb,          -- { inicio, fim, hora, orgao, fonte }
  ultima_sessao  jsonb,
  eventos        jsonb not null default '[]'::jsonb,
  avisos         jsonb not null default '[]'::jsonb,
  fontes         jsonb,
  consultado_em  timestamptz not null default now(),
  consultado_por uuid references membros(id) on delete set null
);
comment on table pautas is 'Última verificação de pauta de cada processo (DataJud + DJEN).';

alter table pautas enable row level security;

-- todos enxergam; quem escreve na base pode registrar uma verificação
drop policy if exists pautas_le on pautas;
create policy pautas_le on pautas for select to authenticated using (true);
drop policy if exists pautas_insere on pautas;
create policy pautas_insere on pautas for insert to authenticated with check (dg_escreve());
drop policy if exists pautas_altera on pautas;
create policy pautas_altera on pautas for update to authenticated
  using (dg_escreve()) with check (dg_escreve());
drop policy if exists pautas_apaga on pautas;
create policy pautas_apaga on pautas for delete to authenticated using (dg_gestora());

revoke all on pautas from anon;
grant select, insert, update, delete on pautas to authenticated;
