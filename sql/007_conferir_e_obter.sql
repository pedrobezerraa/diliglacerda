-- =====================================================================
-- DiliGLA · 007 · "Conferir ... e obter" conta como conclusão
--
-- O tipo do objetivo sai do primeiro verbo (tabela objetivo_verbos), e
-- "Conferir" é de acompanhamento. A exceção, definida pela gestão: quando o
-- objetivo começa com "Conferir" e também manda obter o ato ("Conferir
-- intimação e obtê-la se ausente", "Conferir prazo e obter intimação"), há um
-- ato a alcançar, e ele conta como conclusão.
--
-- Continuam de acompanhamento "Monitorar ... e obter ..." e "Conferir
-- arquivamento e validar ato residual".
--
-- A mesma regra está em js/sincronia.js (tipoDoObjetivo), que alimenta o
-- relatório de objetivos; esta alimenta o Painel do setor.
-- =====================================================================

create or replace function tipo_do_objetivo(p_objetivo text)
returns tipo_objetivo language sql stable set search_path = public as $$
  select case
    when dg_chave(p_objetivo) ~ '^conferir\M.*\mobt(er|e-l[ao]s?)\M' then 'conclusao'::tipo_objetivo
    else coalesce(
      (select v.tipo from objetivo_verbos v
        where lower(split_part(btrim(coalesce(p_objetivo, '')), ' ', 1)) = v.verbo
        limit 1),
      'conclusao'::tipo_objetivo)
  end
$$;
