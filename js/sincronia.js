// =====================================================================
// DiliGLA · ponte entre a tela e o banco
//
// A grade continua trabalhando sobre o mesmo objeto BD de sempre, em
// memória. O que mudou é de onde ele vem e para onde vai: antes nascia e
// morria no localStorage, agora nasce do Supabase e volta para lá.
//
// A escrita é por diferença. Guardamos um espelho do que o banco tem; a
// cada gravar(), comparamos e mandamos só os campos que mudaram. Isso
// deixou os onze pontos do sistema que chamam gravar() intactos — nenhum
// deles precisou saber que existe banco.
// =====================================================================
window.DGS = (function () {
  "use strict";

  // o que vive no banco e, portanto, entra na comparação
  const CAMPOS = ["objetivo", "observacao", "fase", "prioridade", "atingido",
                  "condicao", "carteira_id", "bloco_codigo", "categoria",
                  "grupo_numero", "materia_id", "responsavel_id", "valor",
                  "juizo", "orgao_2g", "colegiado", "erro", "consultado_em",
                  "revisado_em"];

  const ref = {           // tabelas de referência, carregadas uma vez
    membros: [], materias: [], carteiras: [], blocos: [], gatilhos: [], verbos: [],
  };
  let espelho = {};       // npu -> { campo: valor } como o banco tem
  let transferencias = [];

  const porId   = (lista, id) => lista.find(x => x.id === id) || null;
  const chaveTxt = t => String(t ?? "").normalize("NFKD")
                          .replace(/[̀-ͯ]/g, "").toLowerCase().trim();

  function membroPorNome(nome) {
    const c = chaveTxt(nome);
    if (!c) return null;
    return ref.membros.find(m => chaveTxt(m.nome) === c)
        || ref.membros.find(m => (m.apelidos || []).some(a => chaveTxt(a) === c))
        || null;
  }
  function carteiraPorNome(n) {
    const c = chaveTxt(n);
    return ref.carteiras.find(x => chaveTxt(x.nome) === c || chaveTxt(x.codigo) === c) || null;
  }
  function materiaPorNome(n) {
    const c = chaveTxt(n);
    return ref.materias.find(x => chaveTxt(x.nome) === c || chaveTxt(x.codigo) === c)
        || ref.materias.find(x => (x.apelidos || []).some(a => chaveTxt(a) === c)) || null;
  }

  // ------------------------------------------------- do banco para o BD
  function hidratar(dados) {
    ref.membros   = dados.membros   || [];
    ref.materias  = dados.materias  || [];
    ref.carteiras = dados.carteiras || [];
    ref.blocos    = dados.blocos    || [];
    ref.gatilhos  = dados.gatilhos  || [];
    ref.verbos    = dados.verbos    || [];
    transferencias = dados.transferencias || [];

    const BD = {
      versao: 2, processos: {}, ordem: [], mov: {}, consultas: {}, extras: [],
      regras: { sentenca: [], acordao: [], conclusao: [] }, usar2g: true,
    };
    const porUuid = {};

    for (const p of dados.processos || []) {
      const reg = {
        id: p.id, npu: p.npu,
        resp: p.responsavel || "Sem responsável",
        responsavel_id: p.responsavel_id,
        objetivo: p.objetivo || "", observacao: p.observacao || "",
        fase: p.fase || "", prioridade: p.prioridade || "",
        atingido: p.atingido || "", condicao: p.condicao || "",
        carteira_id: p.carteira_id, carteira: p.carteira || "",
        bloco_codigo: p.bloco_codigo, bloco: p.bloco || "", origem_bloco: p.origem_bloco || "",
        categoria: p.categoria || "propria",
        grupo_numero: p.grupo_numero, materia_id: p.materia_id,
        materia: p.materia || "", grupo: p.grupo || "",
        valor: p.valor == null ? null : Number(p.valor),
        juizo: p.juizo || "", orgao: p.juizo || "", orgao_2g: p.orgao_2g || "",
        colegiado: p.colegiado || "", erro: p.erro || "",
        consultado_em: p.consultado_em || "", revisado_em: p.revisado_em || "",
        revisar_ate: p.revisar_ate || "", tipo_objetivo: p.tipo_objetivo || "",
        transferencia_aberta: !!p.transferencia_aberta,
        ativo: p.ativo !== false,
      };
      BD.processos[p.npu] = reg;
      BD.ordem.push(p.npu);
      porUuid[p.id] = p.npu;
      BD.mov[p.npu] = {};
    }

    for (const m of dados.movimentos || []) {
      const npu = porUuid[m.processo_id];
      if (!npu) continue;
      BD.mov[npu][m.chave] = {
        data: m.data, texto: m.texto, tipo: m.tipo || "", grau: m.grau || "1",
        codigo: m.codigo ?? "", captado: m.captado_em || "",
      };
    }

    // abas: toda pessoa que diligencia tem aba, mesmo sem processo ainda
    BD.extras = ref.membros.filter(m => m.ativo && m.papel !== "leitura").map(m => m.nome);
    espelhar(BD);
    return BD;
  }

  function espelhar(BD) {
    espelho = {};
    for (const npu of BD.ordem) {
      const p = BD.processos[npu] || {};
      const e = {};
      for (const c of CAMPOS) e[c] = p[c] ?? null;
      espelho[npu] = e;
    }
  }

  // --------------------------------------------- do BD para o banco
  // Só o que mudou, campo a campo. Um processo sem id ainda não existe no
  // banco e é criado pela importação, não por aqui.
  function sincronizar(BD) {
    let mudados = 0;
    for (const npu of BD.ordem) {
      const p = BD.processos[npu];
      if (!p || !p.id) continue;

      // a aba é escolhida pelo nome; o banco guarda o id de quem responde
      if (p.resp) {
        const m = membroPorNome(p.resp);
        if (m) p.responsavel_id = m.id;
      }

      const antes = espelho[npu] || {};
      const campos = {};
      for (const c of CAMPOS) {
        const novo = p[c] === "" ? null : (p[c] ?? null);
        const velho = antes[c] === "" ? null : (antes[c] ?? null);
        if (String(novo) !== String(velho)) campos[c] = novo;
      }
      if (Object.keys(campos).length) {
        DG.alterarProcesso(p.id, campos);
        espelho[npu] = { ...antes, ...campos };
        mudados++;
      }
    }
    sincronizarMovimentos(BD);
    return mudados;
  }

  // Andamentos novos sobem em lote, com upsert: consultar o PJe duas vezes
  // não duplica linha nenhuma.
  const movEnviados = new Set();
  function sincronizarMovimentos(BD) {
    const novos = [];
    for (const npu of BD.ordem) {
      const p = BD.processos[npu];
      if (!p || !p.id) continue;
      for (const [chave, m] of Object.entries(BD.mov[npu] || {})) {
        const marca = p.id + "|" + chave;
        if (movEnviados.has(marca)) continue;
        movEnviados.add(marca);
        novos.push({
          processo_id: p.id, chave, data: m.data, texto: m.texto,
          tipo: m.tipo || null, grau: m.grau || null,
          codigo: m.codigo === "" ? null : m.codigo,
        });
      }
    }
    if (novos.length) DG.registrarMovimentos(novos);
  }

  // marca os andamentos que já vieram do banco, para não devolvê-los
  function marcarMovimentosCarregados(BD) {
    for (const npu of BD.ordem) {
      const p = BD.processos[npu];
      if (!p || !p.id) continue;
      for (const chave of Object.keys(BD.mov[npu] || {})) movEnviados.add(p.id + "|" + chave);
    }
  }

  // ------------------------------------------------------------ gatilhos
  // O gatilho é o ato obtido, e não a diligência realizada (item 5 do
  // plano). Lemos o texto do andamento, não só a existência dele.
  function gatilhosDoMovimento(mov, processo) {
    const texto = chaveTxt(mov.texto);
    const achados = [];
    for (const g of ref.gatilhos) {
      if (!g.ativo) continue;
      let bate = false;
      if (g.tipo_movimento && mov.tipo === g.tipo_movimento) bate = true;
      if (!bate && g.padrao) {
        try { bate = new RegExp(g.padrao, "i").test(texto); } catch { bate = false; }
      }
      if (!bate) continue;
      // gatilho de faixa de valor só vale se o valor couber na faixa
      const v = processo && processo.valor;
      if (g.exige_valor) {
        if (v == null) continue;
        if (g.valor_min != null && v <= Number(g.valor_min)) continue;
        if (g.valor_max != null && v > Number(g.valor_max)) continue;
      }
      achados.push(g);
    }
    return achados;
  }

  // Varre o que foi captado e devolve as passagens que cabem propor. Não
  // propõe nada sozinho: quem decide é a pessoa, na tela de passagens.
  function sugestoes(BD, apenasDe) {
    // o que já foi decidido não volta a ser sugerido: um ato se obtém uma vez,
    // e uma recusa não deve reaparecer a cada consulta ao PJe
    const decididos = new Set();
    for (const t of transferencias) {
      if (t.status === "proposta" || t.status === "cancelada") continue;
      if (t.gatilho_codigo) decididos.add(t.processo_id + "|" + t.gatilho_codigo);
      if (t.movimento_chave) decididos.add(t.processo_id + "@" + t.movimento_chave);
    }
    const fora = [];
    for (const npu of BD.ordem) {
      const p = BD.processos[npu];
      if (!p || !p.id || !p.ativo || p.transferencia_aberta) continue;
      if (apenasDe && p.resp !== apenasDe) continue;
      const movs = Object.entries(BD.mov[npu] || {})
        .map(([chave, m]) => ({ ...m, chave }))
        .sort((a, b) => String(b.data).localeCompare(String(a.data)));
      for (const m of movs.slice(0, 12)) {
        if (decididos.has(p.id + "@" + m.chave)) continue;
        const gs = gatilhosDoMovimento(m, p).filter(g => !decididos.has(p.id + "|" + g.codigo));
        if (gs.length) { fora.push({ npu, processo: p, movimento: m, gatilho: gs[0] }); break; }
      }
    }
    return fora;
  }

  function destinoDe(gatilho, processo) {
    const bloco = gatilho.bloco_destino || processo.bloco_codigo;
    let nome = null;
    if (gatilho.regra_responsavel === "manter") nome = processo.resp;
    else if (gatilho.regra_responsavel === "custodiante_do_bloco") {
      const b = ref.blocos.find(x => x.codigo === bloco);
      nome = (b && b.custodiante_apelido) || processo.resp;
    } else nome = gatilho.regra_responsavel;
    const m = membroPorNome(nome);
    const cart = ref.carteiras.find(c => c.codigo === gatilho.carteira_destino);
    return {
      responsavel: m ? m.nome : (nome || "—"),
      responsavel_id: m ? m.id : null,
      carteira: cart ? cart.nome : (processo.carteira || "—"),
      bloco: bloco || "—",
    };
  }

  function tipoDoObjetivo(objetivo) {
    const primeiro = chaveTxt(String(objetivo || "").trim().split(/\s+/)[0]);
    const v = ref.verbos.find(x => x.verbo === primeiro);
    return v ? v.tipo : "conclusao";
  }

  return {
    hidratar, espelhar, sincronizar, marcarMovimentosCarregados,
    gatilhosDoMovimento, sugestoes, destinoDe, tipoDoObjetivo,
    membroPorNome, carteiraPorNome, materiaPorNome, porId, chaveTxt,
    get ref() { return ref; },
    get transferencias() { return transferencias; },
    set transferencias(t) { transferencias = t; },
  };
})();
