-- =====================================================================
-- DiliGLA · 004 · operações
-- A importação, a proposta e o aceite moram aqui dentro, e não no
-- navegador, por três razões: a regra do merge fica num lugar só, a
-- transação é atômica, e nenhuma delas depende de o usuário ter permissão
-- direta de escrita nas tabelas.
-- =====================================================================

-- Chave de comparação: minúsculas, sem acento, sem espaço sobrando.
create or replace function dg_chave(t text)
returns text language sql immutable set search_path = public as $$
  select btrim(regexp_replace(
    lower(translate(coalesce(t, ''),
      'ÁÀÃÂÄÉÈÊËÍÌÎÏÓÒÕÔÖÚÙÛÜÇÑáàãâäéèêëíìîïóòõôöúùûüçñ',
      'AAAAAEEEEIIIIOOOOOUUUUCNaaaaaeeeeiiiiooooouuuucn')),
    '\s+', ' ', 'g'))
$$;

-- Só os 20 dígitos do CNJ.
create or replace function dg_npu(t text)
returns text language sql immutable set search_path = public as $$
  select nullif(regexp_replace(coalesce(t, ''), '[^0-9]', '', 'g'), '')
$$;

-- "R$ 12.345,67" -> 12345.67 ; "12345.67" -> 12345.67
create or replace function dg_valor(t text)
returns numeric language plpgsql immutable set search_path = public as $$
declare s text;
begin
  s := regexp_replace(coalesce(t, ''), '[^0-9,.-]', '', 'g');
  if s = '' then return null; end if;
  -- se tem vírgula, ela é o separador decimal e o ponto é milhar
  if position(',' in s) > 0 then
    s := replace(replace(s, '.', ''), ',', '.');
  end if;
  return s::numeric;
exception when others then return null;
end $$;

create or replace function dg_membro_por_nome(t text)
returns uuid language sql stable set search_path = public as $$
  select id from membros
   where ativo and (dg_chave(nome) = dg_chave(t)
                    or dg_chave(t) = any (select dg_chave(a) from unnest(apelidos) a))
   order by case when dg_chave(nome) = dg_chave(t) then 0 else 1 end
   limit 1
$$;

create or replace function dg_materia_por_nome(t text)
returns integer language sql stable set search_path = public as $$
  select id from materias
   where ativa and (dg_chave(nome) = dg_chave(t) or dg_chave(codigo) = dg_chave(t)
                    or dg_chave(t) = any (select dg_chave(a) from unnest(apelidos) a))
   order by case when dg_chave(nome) = dg_chave(t) then 0 else 1 end, ordem
   limit 1
$$;

-- ======================================================================
-- Importação semanal
-- A planilha manda em: responsável, grupo, matéria, carteira, bloco, fase,
-- valor, prioridade e objetivo. O que foi produzido aqui dentro — objetivo
-- atingido, observação, condição, providências, movimentos e o que veio do
-- MNI — não é tocado. Toda sobrescrita vira linha no histórico.
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
  v_cart      integer;
  v_bloco     text;
  v_valor     numeric;
  atual       processos%rowtype;
  n_criados   int := 0;
  n_atual     int := 0;
  n_ignorados int := 0;
  mudancas    text[];
  recusas     jsonb := '[]'::jsonb;
  id_import   bigint;
begin
  if not dg_escreve() then
    raise exception 'Sem permissão para importar. Peça à gestora para liberar seu acesso.';
  end if;

  for l in select * from jsonb_array_elements(coalesce(p_linhas, '[]'::jsonb)) loop
    v_npu := dg_npu(l->>'npu');
    if v_npu is null or length(v_npu) <> 20 then
      n_ignorados := n_ignorados + 1;
      recusas := recusas || jsonb_build_object('npu', l->>'npu', 'motivo', 'número fora do padrão CNJ');
      continue;
    end if;

    v_resp := dg_membro_por_nome(l->>'responsavel');

    -- Um diligente só importa o que é dele. A gestora importa a planilha toda.
    if not sou_gestora then
      if v_resp is null then v_resp := eu; end if;
      if v_resp <> eu then
        n_ignorados := n_ignorados + 1;
        recusas := recusas || jsonb_build_object('npu', l->>'npu',
          'motivo', 'linha de outro responsável; só a gestora importa a planilha inteira');
        continue;
      end if;
    end if;

    -- "12 Funafin" numa coluna só, ou número e matéria em colunas separadas
    v_grupo := btrim(coalesce(l->>'grupo', ''));
    if v_grupo <> '' then
      v_num := nullif(substring(v_grupo from '^\s*(\d+)'), '')::integer;
      v_mat := dg_materia_por_nome(btrim(regexp_replace(v_grupo, '^\s*\d+\s*[-–.]?\s*', '')));
    else
      v_num := nullif(regexp_replace(coalesce(l->>'grupo_numero', ''), '[^0-9]', '', 'g'), '')::integer;
      v_mat := dg_materia_por_nome(l->>'materia');
    end if;
    if v_mat is null then v_mat := dg_materia_por_nome(l->>'materia'); end if;

    select id into v_cart from carteiras
      where dg_chave(nome) = dg_chave(l->>'carteira') or dg_chave(codigo) = dg_chave(l->>'carteira');
    select codigo into v_bloco from blocos
      where dg_chave(codigo) = dg_chave(l->>'bloco') or dg_chave(nome) = dg_chave(l->>'bloco');
    v_valor := dg_valor(l->>'valor');

    select * into atual from processos where npu = v_npu;

    if not found then
      insert into processos (npu, grupo_numero, materia_id, responsavel_id, carteira_id,
                             bloco_codigo, categoria, fase, valor, prioridade, objetivo,
                             observacao, atualizado_por)
      values (v_npu, v_num, v_mat, v_resp, v_cart, v_bloco,
              coalesce(nullif(l->>'categoria','')::categoria_vinculo, 'propria'),
              nullif(btrim(l->>'fase'), ''), v_valor,
              nullif(btrim(l->>'prioridade'), ''), nullif(btrim(l->>'objetivo'), ''),
              nullif(btrim(l->>'observacao'), ''), eu);
      n_criados := n_criados + 1;
      insert into historico (processo_id, tipo, texto, por)
        select id, 'import', 'Entrou pela planilha' || coalesce(' (' || p_aba || ')', ''), eu
          from processos where npu = v_npu;
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

      update processos set
        grupo_numero = coalesce(v_num, grupo_numero),
        materia_id   = coalesce(v_mat, materia_id),
        responsavel_id = coalesce(v_resp, responsavel_id),
        carteira_id  = coalesce(v_cart, carteira_id),
        bloco_codigo = coalesce(v_bloco, bloco_codigo),
        categoria    = coalesce(nullif(l->>'categoria','')::categoria_vinculo, categoria),
        fase         = coalesce(nullif(btrim(l->>'fase'), ''), fase),
        valor        = coalesce(v_valor, valor),
        prioridade   = coalesce(nullif(btrim(l->>'prioridade'), ''), prioridade),
        objetivo     = coalesce(nullif(btrim(l->>'objetivo'), ''), objetivo),
        -- observação só é preenchida pela planilha quando ainda não existe
        -- nenhuma aqui dentro: o que a pessoa escreveu vale mais
        observacao   = coalesce(observacao, nullif(btrim(l->>'observacao'), '')),
        atualizado_por = eu
      where id = atual.id;

      n_atual := n_atual + 1;
      if array_length(mudancas, 1) > 0 then
        insert into historico (processo_id, tipo, texto, por)
        values (atual.id, 'import', 'Planilha alterou — ' || array_to_string(mudancas, '; '), eu);
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

-- ======================================================================
-- Transferência: propor
-- Resolve o destino pela regra do gatilho e deixa a proposta pendente.
-- ======================================================================
create or replace function dg_propor(p_processo uuid, p_gatilho text,
                                     p_ato text default null,
                                     p_valor numeric default null,
                                     p_prazo date default null,
                                     p_observacao text default null,
                                     p_movimento text default null,
                                     p_origem origem_proposta default 'declarada',
                                     p_para_responsavel uuid default null)
returns bigint language plpgsql security definer set search_path = public as $$
declare
  eu    uuid := auth.uid();
  pr    processos%rowtype;
  g     gatilhos%rowtype;
  v_resp uuid;
  v_cart integer;
  v_bloco text;
  novo  bigint;
begin
  if not dg_escreve() then raise exception 'Sem permissão.'; end if;
  select * into pr from processos where id = p_processo;
  if not found then raise exception 'Processo não encontrado.'; end if;
  if not dg_gestora() and pr.responsavel_id is distinct from eu then
    raise exception 'Só o responsável pelo processo, ou a gestora, pode propor a passagem.';
  end if;
  if exists (select 1 from transferencias where processo_id = p_processo and status = 'proposta') then
    raise exception 'Já existe uma passagem aguardando aceite neste processo.';
  end if;

  select * into g from gatilhos where codigo = p_gatilho and ativo;
  if not found then raise exception 'Gatilho % não existe.', p_gatilho; end if;

  if g.exige_valor and coalesce(p_valor, pr.valor) is null then
    raise exception 'Este gatilho depende do valor, e o processo está sem valor informado.';
  end if;

  v_bloco := coalesce(g.bloco_destino, pr.bloco_codigo);
  select id into v_cart from carteiras where codigo = g.carteira_destino;
  v_cart := coalesce(v_cart, pr.carteira_id);

  v_resp := case
    when p_para_responsavel is not null then p_para_responsavel
    when g.regra_responsavel = 'manter' then pr.responsavel_id
    when g.regra_responsavel = 'custodiante_do_bloco'
      then coalesce(dg_membro_por_nome((select custodiante_apelido from blocos where codigo = v_bloco)),
                    pr.responsavel_id)
    else coalesce(dg_membro_por_nome(g.regra_responsavel), pr.responsavel_id)
  end;

  insert into transferencias (processo_id, gatilho_codigo, origem,
    de_responsavel, para_responsavel, de_carteira, para_carteira, de_bloco, para_bloco,
    ato, movimento_chave, valor_remanescente, prazo, observacao, criada_por)
  values (p_processo, g.codigo, p_origem,
    pr.responsavel_id, v_resp, pr.carteira_id, v_cart, pr.bloco_codigo, v_bloco,
    coalesce(nullif(btrim(p_ato), ''), g.ato), p_movimento,
    coalesce(p_valor, pr.valor), p_prazo, p_observacao, eu)
  returning id into novo;

  insert into historico (processo_id, tipo, texto, por)
  values (p_processo, 'transferencia',
          'Passagem proposta: ' || coalesce(nullif(btrim(p_ato), ''), g.ato)
          || ' · para ' || coalesce((select nome from membros where id = v_resp), '—'), eu);
  return novo;
end $$;

-- ======================================================================
-- Transferência: aceitar ou recusar
-- A passagem só se completa com o aceite do destino (item 5).
-- ======================================================================
create or replace function dg_decidir(p_id bigint, p_aceitar boolean,
                                      p_motivo text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  eu uuid := auth.uid();
  t  transferencias%rowtype;
begin
  select * into t from transferencias where id = p_id;
  if not found then raise exception 'Passagem não encontrada.'; end if;
  if t.status <> 'proposta' then raise exception 'Esta passagem já foi decidida.'; end if;
  if not dg_gestora() and t.para_responsavel is distinct from eu then
    raise exception 'Só quem recebe, ou a gestora, pode aceitar a passagem.';
  end if;

  if p_aceitar then
    update processos set
      responsavel_id = coalesce(t.para_responsavel, responsavel_id),
      carteira_id    = coalesce(t.para_carteira, carteira_id),
      bloco_codigo   = coalesce(t.para_bloco, bloco_codigo),
      -- o ato obtido abre um objetivo novo: o anterior deixa de valer
      atingido       = null,
      condicao       = null,
      revisado_em    = now(),
      atualizado_por = eu
    where id = t.processo_id;

    -- cessão sem saldo e recebimento confirmado tiram o processo de circulação
    if t.gatilho_codigo in ('cessao_sem_saldo', 'alvara_recebido') then
      update processos set ativo = false where id = t.processo_id;
    end if;

    update transferencias set status = 'aceita', decidida_por = eu, decidida_em = now(),
                              motivo = p_motivo where id = p_id;
    insert into historico (processo_id, tipo, texto, de, para, por)
    values (t.processo_id, 'transferencia', 'Passagem aceita: ' || t.ato,
            (select nome from membros where id = t.de_responsavel),
            (select nome from membros where id = t.para_responsavel), eu);
  else
    update transferencias set status = 'recusada', decidida_por = eu, decidida_em = now(),
                              motivo = p_motivo where id = p_id;
    insert into historico (processo_id, tipo, texto, por)
    values (t.processo_id, 'transferencia',
            'Passagem recusada: ' || t.ato || coalesce(' — ' || p_motivo, ''), eu);
  end if;

  return jsonb_build_object('ok', true, 'status', case when p_aceitar then 'aceita' else 'recusada' end);
end $$;

-- A gestora pode criar e desativar membros; o convite em si é feito pelo
-- Supabase Auth, e esta função só acerta nome, papel e apelidos.
create or replace function dg_definir_papel(p_membro uuid, p_papel papel_dg,
                                            p_apelidos text[] default null,
                                            p_ativo boolean default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not dg_gestora() then raise exception 'Só a gestora altera papéis.'; end if;
  if p_membro = auth.uid() and p_papel <> 'gestora' then
    raise exception 'Você não pode tirar o próprio papel de gestora. Peça a outra gestora.';
  end if;
  update membros set papel = p_papel,
                     apelidos = coalesce(p_apelidos, apelidos),
                     ativo = coalesce(p_ativo, ativo)
   where id = p_membro;
end $$;

-- Nenhuma função fica ao alcance de quem não entrou. Elas já recusam o anônimo
-- por dentro, mas a porta não deve nem existir para ele.
revoke execute on function dg_importar(jsonb, text, text) from public, anon;
revoke execute on function dg_propor(uuid, text, text, numeric, date, text, text, origem_proposta, uuid) from public, anon;
revoke execute on function dg_decidir(bigint, boolean, text) from public, anon;
revoke execute on function dg_definir_papel(uuid, papel_dg, text[], boolean) from public, anon;
revoke execute on function dg_papel()   from public, anon;
revoke execute on function dg_gestora() from public, anon;
revoke execute on function dg_escreve() from public, anon;
-- esta só existe para o gatilho de criação de conta; ninguém a chama pela API
revoke execute on function dg_ao_criar_usuario() from public, anon, authenticated;

-- as três primeiras são chamadas de dentro das políticas de RLS, que são
-- avaliadas com a permissão de quem consulta: o authenticated precisa do execute
grant execute on function dg_papel(), dg_gestora(), dg_escreve() to authenticated;
grant execute on function dg_importar(jsonb, text, text) to authenticated;
grant execute on function dg_propor(uuid, text, text, numeric, date, text, text, origem_proposta, uuid) to authenticated;
grant execute on function dg_decidir(bigint, boolean, text) to authenticated;
grant execute on function dg_definir_papel(uuid, papel_dg, text[], boolean) to authenticated;
