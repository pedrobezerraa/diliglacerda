-- =====================================================================
-- DiliGLA · 012 · observação pelo card do Plano
--
-- Cada card de processo do Plano ganha "adicionar observação". A observação
-- é a mesma da carteira: quando o processo está na base, ela grava em
-- processos.observacao (e aparece na aba Carteiras). Quando o processo não
-- está na base, ela fica guardada no próprio plano, em plano_situacoes.
--
-- Passa por uma função porque o plano reparte o trabalho de um jeito e a
-- carteira de outro: quem diligencia o processo no plano nem sempre é o
-- responsável na carteira, e a regra de escrita de processos só deixa o
-- responsável alterar. Aqui basta ter acesso de escrita, e a alteração fica
-- no histórico do processo, com quem fez.
-- =====================================================================

alter table plano_situacoes add column if not exists observacao text;
alter table plano_situacoes add column if not exists obs_por uuid references membros(id) on delete set null;
alter table plano_situacoes add column if not exists obs_em timestamptz;
-- uma linha pode nascer só da observação, antes de qualquer situação marcada
alter table plano_situacoes alter column situacao set default 'Pendente';

create or replace function dg_observacao_plano(p_plano text, p_npu text, p_texto text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  eu    uuid := auth.uid();
  texto text := nullif(btrim(coalesce(p_texto, '')), '');
  pr    processos%rowtype;
begin
  if not dg_escreve() then raise exception 'Sem permissão para alterar a observação.'; end if;
  if coalesce(btrim(p_plano), '') = '' or coalesce(btrim(p_npu), '') = '' then
    raise exception 'Plano ou processo não informado.';
  end if;

  select * into pr from processos where npu = dg_npu(p_npu);
  if found then
    if texto is distinct from pr.observacao then
      update processos set observacao = texto, atualizado_por = eu where id = pr.id;
      insert into historico (processo_id, tipo, texto, de, para, por)
      values (pr.id, 'edit', 'Observação alterada pelo Plano', pr.observacao, texto, eu);
    end if;
    return jsonb_build_object('ok', true, 'onde', 'processo');
  end if;

  insert into plano_situacoes (plano, npu, observacao, obs_por, obs_em)
  values (p_plano, p_npu, texto, eu, now())
  on conflict (plano, npu) do update
    set observacao = excluded.observacao, obs_por = excluded.obs_por, obs_em = excluded.obs_em;
  return jsonb_build_object('ok', true, 'onde', 'plano');
end $$;

revoke execute on function dg_observacao_plano(text, text, text) from public, anon;
grant execute on function dg_observacao_plano(text, text, text) to authenticated;
