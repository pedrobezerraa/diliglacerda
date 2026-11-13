-- =====================================================================
-- DiliGLA · 005 · cargo, contas criadas pela coordenação e distribuição
--                 das carteiras completas por estagiário
--
-- Três mudanças:
--  1. Cargo e acesso passam a ser coisas separadas. O cargo é o que a
--     pessoa é no escritório (Gestora, Estagiário, ...); o acesso é o que
--     ela pode fazer no sistema. Pedro Miguel é estagiário com acesso de
--     administração; a gestora também tem acesso de administração.
--     O valor interno do acesso de administração continua sendo 'gestora'
--     no enum papel_dg, para não reescrever as políticas; na tela ele
--     aparece como "Administração".
--  2. Quem tem acesso de administração define nome, cargo e acesso das
--     contas criadas pela tela de Equipe (dg_definir_papel ganhou p_nome e
--     p_cargo).
--  3. A importação passa a entender a planilha "Carteiras completas por
--     estagiário": uma aba por pessoa, categoria (Própria / Realocada /
--     Tutelada), jurisdição, grupo no formato "AD 45", situação no
--     relatório e movimentação de carteira, e o responsável escolhido na
--     tela vem como id, sem depender da grafia do nome.
-- =====================================================================

-- ------------------------------------------------------------- colunas
alter table membros   add column if not exists cargo text;
alter table processos add column if not exists jurisdicao text;
-- o grupo como veio da planilha; é o que aparece quando a matéria não é
-- reconhecida ("Indiv - Genilda", "91 SG")
alter table processos add column if not exists grupo_rotulo text;

comment on column membros.cargo is
  'Cargo no escritório (Gestora, Estagiário, ...). Não dá permissão nenhuma: quem decide é papel.';

-- ------------------------------------------- Pedro Miguel: estagiário admin
-- A conta nasceu com o nome tirado do e-mail ("pedromiguel"). O nome certo
-- importa: é por ele que os blocos e os gatilhos acham o custodiante.
update membros
   set nome     = 'Pedro Miguel',
       cargo    = 'Estagiário',
       papel    = 'gestora',
       apelidos = array(select distinct a from unnest(apelidos || array['Pedro Miguel', 'Pedro', 'pedromiguel']) a)
 where dg_chave(nome) in ('pedromiguel', 'pedro miguel');

update membros set cargo = case papel when 'gestora' then 'Gestora' else 'Estagiário(a)' end
 where cargo is null;

-- ------------------------------------------------------------ matérias
-- Grupos que aparecem na planilha de 13/11 e não tinham matéria.
insert into materias (codigo, nome, apelidos, ordem) values
  ('abono',             'Abono',             array['abono'], 10),
  ('abono_restituicao', 'Abono Restituição', array['abono restituicao'], 11),
  ('abono_concessao',   'Abono Concessão',   array['abono concessao'], 12),
  ('lp_municipal',      'LP Municipal',      array['lp municipal', 'licenca premio municipal'], 13)
on conflict (codigo) do update
  set nome = excluded.nome, apelidos = excluded.apelidos, ordem = excluded.ordem;

-- ---------------------------------------------------------------- valor
-- Aceita "R$ 12.345,67", "12,345.67" e "12345.67": quando há vírgula e
-- ponto, o separador decimal é o que vem por último.
create or replace function dg_valor(t text)
returns numeric language plpgsql immutable set search_path = public as $$
declare s text;
begin
  s := regexp_replace(coalesce(t, ''), '[^0-9,.-]', '', 'g');
  if s = '' then return null; end if;
  if position(',' in s) > 0 and position('.' in s) > 0 then
    if length(s) - length(regexp_replace(s, '^.*,', '')) > length(s) - length(regexp_replace(s, '^.*\.', '')) then
      s := replace(replace(s, '.', ''), ',', '.');       -- 12.345,67
    else
      s := replace(s, ',', '');                          -- 12,345.67
    end if;
  elsif position(',' in s) > 0 then
    s := replace(s, ',', '.');
  end if;
  return s::numeric;
exception when others then return null;
end $$;

-- "Tutelada – custódia temporária" -> tutelada
create or replace function dg_categoria(t text)
returns categoria_vinculo language sql immutable set search_path = public as $$
  select case
    when dg_chave(t) like 'propri%'  then 'propria'::categoria_vinculo
    when dg_chave(t) like 'realoc%'  then 'realocada'::categoria_vinculo
    when dg_chave(t) like 'tutel%'   then 'tutelada'::categoria_vinculo
  end
$$;

-- ================================================================ visão
-- Mesmas colunas de antes, na mesma ordem; o grupo cai no rótulo da
-- planilha quando a matéria não é reconhecida, e a jurisdição entra no fim.
-- Continua rodando com a permissão de quem consulta (ver 003).
create or replace view v_processos with (security_invoker = on) as
select
  p.id, p.npu, p.grupo_numero,
  m.codigo as materia_codigo, m.nome as materia,
  coalesce(case when p.grupo_numero is not null and m.nome is not null
                then p.grupo_numero || ' ' || m.nome end,
           p.grupo_rotulo) as grupo,
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
  case p.prioridade
    when 'Alta'  then coalesce(p.revisado_em, p.criado_em) + interval '2 days'
    when 'Média' then coalesce(p.revisado_em, p.criado_em) + interval '15 days'
    else              coalesce(p.revisado_em, p.criado_em) + interval '30 days'
  end as revisar_ate,
  exists (select 1 from transferencias t
           where t.processo_id = p.id and t.status = 'proposta') as transferencia_aberta,
  p.jurisdicao
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

-- ======================================================== novo usuário
-- O cargo pode vir nos metadados (não dá permissão nenhuma). O papel nunca
-- vem de lá: continua nascendo como leitura, e quem promove é a
-- administração.
create or replace function dg_ao_criar_usuario()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into membros (id, nome, email, papel, cargo)
  values (new.id,
          coalesce(nullif(btrim(new.raw_user_meta_data->>'nome'), ''), split_part(new.email, '@', 1)),
          new.email,
          case when not exists (select 1 from membros)
               then 'gestora'::papel_dg else 'leitura'::papel_dg end,
          nullif(btrim(new.raw_user_meta_data->>'cargo'), ''))
  on conflict (id) do nothing;
  return new;
end $$;

-- ===================================================== definir acesso
drop function if exists dg_definir_papel(uuid, papel_dg, text[], boolean);
create or replace function dg_definir_papel(p_membro uuid, p_papel papel_dg,
                                            p_apelidos text[] default null,
                                            p_ativo boolean default null,
                                            p_nome text default null,
                                            p_cargo text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not dg_gestora() then
    raise exception 'Só quem tem acesso de administração altera a equipe.';
  end if;
  if p_membro = auth.uid() and (p_papel <> 'gestora' or p_ativo is false) then
    raise exception 'Você não pode tirar o próprio acesso de administração. Peça a outra pessoa com esse acesso.';
  end if;
  update membros set papel    = p_papel,
                     apelidos = coalesce(p_apelidos, apelidos),
                     ativo    = coalesce(p_ativo, ativo),
                     nome     = coalesce(nullif(btrim(p_nome), ''), nome),
                     cargo    = case when p_cargo is null then cargo
                                     else nullif(btrim(p_cargo), '') end
   where id = p_membro;
  if not found then raise exception 'Pessoa não encontrada na equipe.'; end if;
end $$;
revoke execute on function dg_definir_papel(uuid, papel_dg, text[], boolean, text, text) from public, anon;
grant execute on function dg_definir_papel(uuid, papel_dg, text[], boolean, text, text) to authenticated;
-- esta só existe para o gatilho de criação de conta; ninguém a chama pela API
revoke execute on function dg_ao_criar_usuario() from public, anon, authenticated;
-- usada só por dentro da dg_importar, que roda como dona das funções
revoke execute on function dg_categoria(text) from public, anon;

-- ======================================================================
-- Importação semanal (revista)
-- Igual à 004 no que importa: a planilha manda em responsável, grupo,
-- matéria, carteira, bloco, categoria, fase, valor, prioridade e objetivo;
-- o que foi produzido aqui dentro não é tocado. Novidades:
--  · responsavel_id: o responsável escolhido na tela, por id;
--  · grupo "AD 45" (número no fim) e rótulo do grupo guardado;
--  · categoria por extenso ("Tutelada – custódia temporária");
--  · jurisdição;
--  · situação "Atingido" marca o objetivo como atingido, se ainda não
--    estiver; a situação e a movimentação de carteira vão para o histórico.
-- ======================================================================
create or replace function dg_importar(p_linhas jsonb, p_arquivo text default null,
                                       p_aba text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  eu          uuid := auth.uid();
  sou_gestora boolean := dg_gestora();
  l           jsonb;
  v_npu       text;
  v_resp      uuid;
  v_mat       integer;
  v_num       integer;
  v_grupo     text;
  v_mat_txt   text;
  v_cart      integer;
  v_bloco     text;
  v_valor     numeric;
  v_cat       categoria_vinculo;
  v_atingiu   boolean;
  v_nota      text;
  v_id        uuid;
  atual       processos%rowtype;
  n_criados   int := 0;
  n_atual     int := 0;
  n_ignorados int := 0;
  mudancas    text[];
  recusas     jsonb := '[]'::jsonb;
  id_import   bigint;
begin
  if not dg_escreve() then
    raise exception 'Sem permissão para importar. Peça à administração para liberar seu acesso.';
  end if;

  for l in select * from jsonb_array_elements(coalesce(p_linhas, '[]'::jsonb)) loop
    v_npu := dg_npu(l->>'npu');
    if v_npu is null or length(v_npu) <> 20 then
      n_ignorados := n_ignorados + 1;
      recusas := recusas || jsonb_build_object('npu', l->>'npu', 'motivo', 'número fora do padrão CNJ');
      continue;
    end if;

    -- o id escolhido na tela vale mais que a grafia do nome
    v_resp := null;
    if coalesce(l->>'responsavel_id', '') ~ '^[0-9a-fA-F-]{36}$' then
      select id into v_resp from membros where id = (l->>'responsavel_id')::uuid and ativo;
    end if;
    if v_resp is null then v_resp := dg_membro_por_nome(l->>'responsavel'); end if;

    if not sou_gestora then
      if v_resp is null then v_resp := eu; end if;
      if v_resp <> eu then
        n_ignorados := n_ignorados + 1;
        recusas := recusas || jsonb_build_object('npu', l->>'npu',
          'motivo', 'linha de outro responsável; só a administração distribui a planilha inteira');
        continue;
      end if;
    end if;

    -- "12 Funafin", "AD 45" ou número e matéria em colunas separadas
    v_grupo := btrim(coalesce(l->>'grupo', ''));
    v_num := null; v_mat := null;
    if v_grupo <> '' then
      if v_grupo ~ '^\s*\d' then
        v_num := substring(v_grupo from '^\s*(\d+)')::integer;
        v_mat_txt := btrim(regexp_replace(v_grupo, '^\s*\d+\s*[-–.]?\s*', ''));
      elsif v_grupo ~ '\d+(\.\d+)?\.?\s*$' then
        v_num := substring(v_grupo from '(\d+)(?:\.\d+)?\.?\s*$')::integer;
        v_mat_txt := btrim(regexp_replace(v_grupo, '\s*\d+(\.\d+)?\.?\s*$', ''));
      else
        v_mat_txt := v_grupo;
      end if;
      v_mat := dg_materia_por_nome(v_mat_txt);
    else
      v_num := nullif(regexp_replace(coalesce(l->>'grupo_numero', ''), '[^0-9]', '', 'g'), '')::integer;
    end if;
    if v_mat is null then v_mat := dg_materia_por_nome(l->>'materia'); end if;

    v_cart := null; v_bloco := null;
    select id into v_cart from carteiras
      where dg_chave(nome) = dg_chave(l->>'carteira') or dg_chave(codigo) = dg_chave(l->>'carteira');
    select codigo into v_bloco from blocos
      where dg_chave(codigo) = dg_chave(l->>'bloco') or dg_chave(nome) = dg_chave(l->>'bloco');
    v_valor := dg_valor(l->>'valor');
    v_cat := dg_categoria(l->>'categoria');
    v_atingiu := dg_chave(l->>'situacao') = 'atingido';

    v_nota := concat_ws(' · ',
      nullif('Situação no relatório: ' || nullif(btrim(l->>'situacao'), ''), ''),
      nullif(btrim(l->>'movimentacao'), ''));

    select * into atual from processos where npu = v_npu;

    if not found then
      insert into processos (npu, grupo_numero, materia_id, grupo_rotulo, responsavel_id,
                             carteira_id, bloco_codigo, categoria, jurisdicao, fase, valor,
                             prioridade, objetivo, observacao, atingido, atualizado_por)
      values (v_npu, v_num, v_mat, nullif(v_grupo, ''), v_resp, v_cart, v_bloco,
              coalesce(v_cat, 'propria'),
              nullif(btrim(l->>'jurisdicao'), ''),
              nullif(btrim(l->>'fase'), ''), v_valor,
              nullif(btrim(l->>'prioridade'), ''), nullif(btrim(l->>'objetivo'), ''),
              nullif(btrim(l->>'observacao'), ''),
              case when v_atingiu then now() end, eu)
      returning id into v_id;
      n_criados := n_criados + 1;
      insert into historico (processo_id, tipo, texto, por)
      values (v_id, 'import', 'Entrou pela planilha' || coalesce(' (' || p_aba || ')', '')
                              || coalesce(' — ' || nullif(v_nota, ''), ''), eu);
    else
      mudancas := '{}';
      if v_resp is not null and v_resp is distinct from atual.responsavel_id then
        mudancas := mudancas || format('responsável: %s → %s',
          coalesce((select nome from membros where id = atual.responsavel_id), '—'),
          coalesce((select nome from membros where id = v_resp), '—'));
      end if;
      if nullif(btrim(l->>'fase'), '') is not null
         and nullif(btrim(l->>'fase'), '') is distinct from atual.fase then
        mudancas := mudancas || format('fase: %s → %s', coalesce(atual.fase, '—'), btrim(l->>'fase'));
      end if;
      if nullif(btrim(l->>'prioridade'), '') is not null
         and nullif(btrim(l->>'prioridade'), '') is distinct from atual.prioridade then
        mudancas := mudancas || format('prioridade: %s → %s',
          coalesce(atual.prioridade, '—'), btrim(l->>'prioridade'));
      end if;
      if nullif(btrim(l->>'objetivo'), '') is not null
         and nullif(btrim(l->>'objetivo'), '') is distinct from atual.objetivo then
        mudancas := mudancas || format('objetivo: %s → %s',
          coalesce(atual.objetivo, '—'), btrim(l->>'objetivo'));
      end if;
      if v_cart is not null and v_cart is distinct from atual.carteira_id then
        mudancas := mudancas || format('carteira: %s → %s',
          coalesce((select nome from carteiras where id = atual.carteira_id), '—'),
          (select nome from carteiras where id = v_cart));
      end if;
      if v_cat is not null and v_cat is distinct from atual.categoria then
        mudancas := mudancas || format('categoria: %s → %s', atual.categoria, v_cat);
      end if;
      if v_atingiu and atual.atingido is null then
        mudancas := mudancas || 'objetivo marcado como atingido pela planilha'::text;
      end if;

      update processos set
        grupo_numero = coalesce(v_num, grupo_numero),
        materia_id   = coalesce(v_mat, materia_id),
        grupo_rotulo = coalesce(nullif(v_grupo, ''), grupo_rotulo),
        responsavel_id = coalesce(v_resp, responsavel_id),
        carteira_id  = coalesce(v_cart, carteira_id),
        bloco_codigo = coalesce(v_bloco, bloco_codigo),
        categoria    = coalesce(v_cat, categoria),
        jurisdicao   = coalesce(nullif(btrim(l->>'jurisdicao'), ''), jurisdicao),
        fase         = coalesce(nullif(btrim(l->>'fase'), ''), fase),
        valor        = coalesce(v_valor, valor),
        prioridade   = coalesce(nullif(btrim(l->>'prioridade'), ''), prioridade),
        objetivo     = coalesce(nullif(btrim(l->>'objetivo'), ''), objetivo),
        observacao   = coalesce(observacao, nullif(btrim(l->>'observacao'), '')),
        atingido     = case when v_atingiu and atingido is null then now() else atingido end,
        ativo        = true,
        atualizado_por = eu
      where id = atual.id;

      n_atual := n_atual + 1;
      if array_length(mudancas, 1) > 0 or nullif(btrim(l->>'movimentacao'), '') is not null then
        insert into historico (processo_id, tipo, texto, por)
        values (atual.id, 'import',
                concat_ws(' — ',
                  'Planilha' || coalesce(' (' || p_aba || ')', ''),
                  nullif(array_to_string(mudancas, '; '), ''),
                  nullif(btrim(l->>'movimentacao'), '')), eu);
      end if;
    end if;
  end loop;

  insert into importacoes (por, arquivo, aba, linhas, criados, atualizados, ignorados, relatorio)
  values (eu, p_arquivo, p_aba, jsonb_array_length(coalesce(p_linhas, '[]'::jsonb)),
          n_criados, n_atual, n_ignorados, jsonb_build_object('recusas', recusas))
  returning id into id_import;

  return jsonb_build_object('importacao', id_import, 'criados', n_criados,
                            'atualizados', n_atual, 'ignorados', n_ignorados,
                            'recusas', recusas);
end $$;

revoke execute on function dg_importar(jsonb, text, text) from public, anon;
grant execute on function dg_importar(jsonb, text, text) to authenticated;
