-- =====================================================================
-- DiliGLA · 001 · estrutura
-- Setor de Diligências · Guimarães & Lacerda Advogados
--
-- Desenho em uma frase: um processo é uma linha, tem um responsável, uma
-- carteira estratégica e uma etiqueta de origem; o que a planilha semanal
-- manda (carteira, fase, valor, prioridade, objetivo) é separado do que o
-- setor produz aqui (objetivo atingido, observação, providências), para que
-- a importação da semana seguinte nunca apague trabalho feito.
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------- enums
do $$ begin
  create type papel_dg as enum ('gestora', 'diligente', 'leitura');
exception when duplicate_object then null; end $$;

do $$ begin
  create type categoria_vinculo as enum ('propria', 'realocada', 'tutelada');
exception when duplicate_object then null; end $$;

do $$ begin
  create type tipo_objetivo as enum ('conclusao', 'acompanhamento');
exception when duplicate_object then null; end $$;

-- As cinco condições do item 4.1 do plano.
do $$ begin
  create type condicao_dg as enum ('atuar', 'validar', 'monitorar', 'espera', 'interno');
exception when duplicate_object then null; end $$;

do $$ begin
  create type status_transferencia as enum ('proposta', 'aceita', 'recusada', 'cancelada');
exception when duplicate_object then null; end $$;

do $$ begin
  create type origem_proposta as enum ('gatilho', 'declarada', 'importacao');
exception when duplicate_object then null; end $$;

-- =====================================================================
-- Pessoas
-- O papel aqui é o papel NO SETOR DE DILIGÊNCIAS, e não o papel no
-- Panorama: lá Pedro Miguel e Bruna constam como gestora, e aqui são
-- diligentes. Os dois sistemas não compartilham essa noção.
-- =====================================================================
create table if not exists membros (
  id          uuid primary key,              -- = auth.users.id
  nome        text not null,
  email       text not null unique,
  papel       papel_dg not null default 'diligente',
  ativo       boolean not null default true,
  -- como a pessoa aparece na coluna Responsável da planilha, em todas as
  -- grafias já vistas ("Pedro Miguel", "Pedro", "PEDRO MIGUEL")
  apelidos    text[] not null default '{}',
  meta_diaria integer not null default 15,   -- item 4.1 do plano
  criado_em   timestamptz not null default now()
);
comment on table membros is 'Quem trabalha no setor e com que papel. O papel é próprio do DiliGLA.';

-- =====================================================================
-- Tabelas de referência
-- São tabelas, e não enums, porque a gestora precisa acrescentar matéria
-- ou carteira sem esperar um deploy.
-- =====================================================================
create table if not exists materias (
  id       serial primary key,
  codigo   text not null unique,
  nome     text not null,
  -- toda grafia que já apareceu em planilha ou no Panorama e que deve cair
  -- nesta matéria; usado para normalizar a importação
  apelidos text[] not null default '{}',
  ordem    integer not null default 0,
  ativa    boolean not null default true
);

create table if not exists carteiras (
  id            serial primary key,
  codigo        text not null unique,
  nome          text not null,
  enquadramento text,
  funcao        text,
  ordem         integer not null default 0,
  ativa         boolean not null default true
);
comment on table carteiras is 'Carteira estratégica (Presença, Viva, ...), que é coisa diferente da carteira-pessoa.';

-- Blocos da custódia temporária (item 3.1). A etiqueta de origem acompanha
-- o processo em todos os controles e não muda quando ele troca de mão.
create table if not exists blocos (
  codigo    text primary key,
  nome      text not null,
  origem    text,                            -- Brenda, Gerlane, Ana Letícia
  natureza  categoria_vinculo not null default 'tutelada',
  -- quem custodia hoje; é o alvo da regra 'custodiante_do_bloco' dos gatilhos
  custodiante_apelido text,
  previstos integer,                         -- quantidade do plano de 13/11
  ordem     integer not null default 0
);

-- Os verbos que classificam o objetivo (item 6.2). Em tabela para que a
-- gestora possa acrescentar um verbo sem mexer no código.
create table if not exists objetivo_verbos (
  verbo text primary key,
  tipo  tipo_objetivo not null
);

-- =====================================================================
-- Processos
-- =====================================================================
create table if not exists processos (
  id            uuid primary key default gen_random_uuid(),
  npu           text not null unique check (npu ~ '^[0-9]{20}$'),

  -- organização por grupo: "12 Funafin"
  grupo_numero  integer,
  materia_id    integer references materias(id) on delete set null,

  responsavel_id uuid references membros(id) on delete restrict,
  carteira_id    integer references carteiras(id) on delete set null,
  bloco_codigo   text references blocos(codigo) on delete set null,
  categoria      categoria_vinculo not null default 'propria',

  -- vindos da planilha / do Panorama
  fase          text,
  valor         numeric(14,2),
  prioridade    text check (prioridade in ('Alta', 'Média', 'Baixa')),
  objetivo      text,

  -- produzidos aqui dentro
  observacao    text,
  atingido      timestamptz,
  condicao      condicao_dg,
  revisado_em   timestamptz,                 -- alimenta o ritmo do item 4.1

  -- vindos do MNI
  juizo         text,
  orgao_2g      text,
  colegiado     text,
  erro          text,
  consultado_em timestamptz,

  ativo         boolean not null default true,
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  atualizado_por uuid references membros(id) on delete set null
);

create index if not exists ix_processos_resp    on processos(responsavel_id) where ativo;
create index if not exists ix_processos_carteira on processos(carteira_id);
create index if not exists ix_processos_grupo   on processos(materia_id, grupo_numero);
create index if not exists ix_processos_aberto  on processos(responsavel_id) where ativo and atingido is null;

-- O tipo do objetivo sai do primeiro verbo, pela tabela de verbos. É função
-- e não coluna calculada porque a tabela de verbos pode mudar depois.
create or replace function tipo_do_objetivo(p_objetivo text)
returns tipo_objetivo language sql stable set search_path = public as $$
  select coalesce(
    (select v.tipo from objetivo_verbos v
      where lower(split_part(btrim(coalesce(p_objetivo, '')), ' ', 1)) = v.verbo
      limit 1),
    'conclusao'::tipo_objetivo)
$$;

-- =====================================================================
-- Movimentações lidas do PJe
-- =====================================================================
create table if not exists movimentos (
  processo_id uuid not null references processos(id) on delete cascade,
  chave       text not null,                 -- data|texto, como no DiliGLA atual
  data        timestamptz not null,
  texto       text not null,
  tipo        text,                          -- sentenca, acordao, conclusao, ...
  grau        text,
  codigo      text,
  captado_em  timestamptz not null default now(),
  primary key (processo_id, chave)
);
create index if not exists ix_movimentos_data on movimentos(processo_id, data desc);

-- =====================================================================
-- Providências
-- Diligência feita não é objetivo atingido (item 6.2). Ela mora aqui, e é
-- daqui que sai a conta das 15 por dia.
-- =====================================================================
create table if not exists providencias (
  id            bigserial primary key,
  processo_id   uuid not null references processos(id) on delete cascade,
  por           uuid references membros(id) on delete set null,
  em            timestamptz not null default now(),
  texto         text not null,
  condicao      condicao_dg,
  proximo_marco date,
  prazo         date
);
create index if not exists ix_providencias_dia on providencias(por, em desc);
create index if not exists ix_providencias_proc on providencias(processo_id, em desc);

-- =====================================================================
-- Gatilhos de mudança de carteira (item 5)
-- O gatilho é o ato obtido, não a diligência realizada.
-- =====================================================================
create table if not exists gatilhos (
  codigo            text primary key,
  ato               text not null,           -- "Sentença proferida"
  sai_de            text not null,
  vai_para          text not null,
  -- reconhecimento no texto do andamento; nulo = só declaração manual
  padrao            text,
  tipo_movimento    text,                    -- casa com movimentos.tipo
  carteira_destino  text references carteiras(codigo) on delete set null,
  bloco_destino     text references blocos(codigo) on delete set null,
  -- como achar o próximo responsável: 'manter', 'custodiante_do_bloco',
  -- 'por_valor' (faixas do item 5) ou o apelido de um membro
  regra_responsavel text not null default 'manter',
  valor_min         numeric(14,2),
  valor_max         numeric(14,2),
  exige_valor       boolean not null default false,
  ordem             integer not null default 0,
  ativo             boolean not null default true
);

-- =====================================================================
-- Transferências
-- Nada se move sem aceite do destino (item 5).
-- =====================================================================
create table if not exists transferencias (
  id                 bigserial primary key,
  processo_id        uuid not null references processos(id) on delete cascade,
  gatilho_codigo     text references gatilhos(codigo) on delete set null,
  origem             origem_proposta not null default 'declarada',

  de_responsavel     uuid references membros(id) on delete set null,
  para_responsavel   uuid references membros(id) on delete set null,
  de_carteira        integer references carteiras(id) on delete set null,
  para_carteira      integer references carteiras(id) on delete set null,
  de_bloco           text references blocos(codigo) on delete set null,
  para_bloco         text references blocos(codigo) on delete set null,

  ato                text not null,          -- o ato obtido, em palavras
  movimento_chave    text,                   -- o andamento que disparou
  valor_remanescente numeric(14,2),
  prazo              date,
  observacao         text,

  status             status_transferencia not null default 'proposta',
  criada_por         uuid references membros(id) on delete set null,
  criada_em          timestamptz not null default now(),
  decidida_por       uuid references membros(id) on delete set null,
  decidida_em        timestamptz,
  motivo             text
);
create index if not exists ix_transf_pendentes on transferencias(para_responsavel, status)
  where status = 'proposta';
create index if not exists ix_transf_processo on transferencias(processo_id, criada_em desc);

-- Um processo não pode ter duas propostas abertas ao mesmo tempo: a segunda
-- proposta sobre o mesmo processo confundiria quem aceita.
create unique index if not exists ux_transf_uma_aberta
  on transferencias(processo_id) where status = 'proposta';

-- =====================================================================
-- Importações da planilha semanal
-- =====================================================================
create table if not exists importacoes (
  id          bigserial primary key,
  por         uuid references membros(id) on delete set null,
  em          timestamptz not null default now(),
  arquivo     text,
  aba         text,
  linhas      integer not null default 0,
  criados     integer not null default 0,
  atualizados integer not null default 0,
  ignorados   integer not null default 0,
  relatorio   jsonb not null default '{}'::jsonb
);

-- =====================================================================
-- Histórico
-- =====================================================================
create table if not exists historico (
  id          bigserial primary key,
  processo_id uuid references processos(id) on delete cascade,
  tipo        text not null,      -- import, edit, objetivo, providencia, transferencia, consulta
  texto       text not null,
  de          text,
  para        text,
  por         uuid references membros(id) on delete set null,
  em          timestamptz not null default now()
);
create index if not exists ix_historico_proc on historico(processo_id, em desc);
create index if not exists ix_historico_dia on historico(em desc);

-- ------------------------------------------------- atualizado_em sozinho
create or replace function toca_atualizado_em()
returns trigger language plpgsql set search_path = public as $$
begin
  new.atualizado_em := now();
  return new;
end $$;

drop trigger if exists tg_processos_touch on processos;
create trigger tg_processos_touch before update on processos
  for each row execute function toca_atualizado_em();
