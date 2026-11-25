-- =====================================================================
-- DiliGLA · 011 · corrigir o número de um processo já importado
--
-- O número entra pela planilha, e às vezes entra errado (dígito trocado,
-- zero à esquerda comido pelo Excel). Esta função troca o número de um
-- processo que já está na base sem perder o trabalho feito nele: objetivo,
-- observação, diligências, passagens, histórico e objetivos cumpridos ficam,
-- porque se ligam ao processo pelo id, e não pelo número.
--
-- O que foi buscado com o número antigo sai, porque era de outro processo:
-- os andamentos do PJe, os dados do órgão julgador e a verificação de pauta.
-- Tudo isso volta na próxima consulta, já com o número certo.
-- =====================================================================

-- dígito verificador do número único (Res. CNJ 65/2008): módulo 97
create or replace function dg_npu_valido(t text)
returns boolean language sql immutable set search_path = public as $$
  select t ~ '^[0-9]{20}$'
     and ((substr(t, 1, 7) || substr(t, 10, 11) || substr(t, 8, 2))::numeric % 97) = 1
$$;

create or replace function dg_alterar_npu(p_processo uuid, p_npu text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  eu    uuid := auth.uid();
  novo  text := dg_npu(p_npu);
  pr    processos%rowtype;
  outro text;
begin
  if not dg_escreve() then raise exception 'Sem permissão para alterar o número.'; end if;
  select * into pr from processos where id = p_processo for update;
  if not found then raise exception 'Processo não encontrado.'; end if;
  if not dg_gestora() and pr.responsavel_id is distinct from eu then
    raise exception 'Só o responsável pelo processo, ou a administração, altera o número.';
  end if;
  if novo is null or length(novo) <> 20 then
    raise exception 'O número precisa ter os 20 dígitos do padrão CNJ (NNNNNNN-DD.AAAA.J.TR.OOOO).';
  end if;
  if not dg_npu_valido(novo) then
    raise exception 'O dígito verificador não confere: confira o número.';
  end if;
  if novo = pr.npu then raise exception 'O número informado é o mesmo de antes.'; end if;
  select coalesce(m.nome, 'sem responsável') into outro
    from processos p left join membros m on m.id = p.responsavel_id where p.npu = novo;
  if found then
    raise exception 'Esse número já está na base, na carteira de %.', outro;
  end if;

  update processos set npu = novo, juizo = null, orgao_2g = null, colegiado = null,
                       erro = null, consultado_em = null, atualizado_por = eu
   where id = pr.id;
  delete from movimentos where processo_id = pr.id;
  delete from pautas where processo_id = pr.id;

  insert into historico (processo_id, tipo, texto, de, para, por)
  values (pr.id, 'edit', 'Número do processo corrigido', pr.npu, novo, eu);

  return jsonb_build_object('ok', true, 'npu', novo);
end $$;

revoke execute on function dg_alterar_npu(uuid, text) from public, anon;
grant execute on function dg_alterar_npu(uuid, text) to authenticated;
