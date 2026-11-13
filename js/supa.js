// =====================================================================
// DiliGLA · camada de dados
//
// Falamos com o Supabase pela API REST, no fetch puro, sem SDK. Não é
// purismo: a biblioteca viria de um CDN, e já aconteceu de um CDN falhar
// para uma pessoa do setor e derrubar o relatório inteiro. Sem dependência
// externa, o que carrega a página carrega o sistema.
//
// A escrita é otimista: a alteração entra na tela na hora, vai para uma fila
// gravada no próprio navegador e sobe para o banco em seguida. Se a internet
// cair no meio de uma diligência, nada se perde — a fila sobrevive a fechar
// a aba e sobe sozinha quando a conexão voltar.
// =====================================================================
window.DG = (function () {
  "use strict";

  const cfg = { url: "", chave: "" };
  const CHAVE_SESSAO = "digla:sessao";
  const CHAVE_FILA   = "digla:fila";

  let sessao = null;     // { access_token, refresh_token, expira_em, usuario }
  let eu = null;         // linha de membros
  const ouvintes = {};

  function emitir(evento, dado) { (ouvintes[evento] || []).forEach(f => f(dado)); }
  function ao(evento, f) { (ouvintes[evento] = ouvintes[evento] || []).push(f); }

  // ------------------------------------------------------------ partida
  async function iniciar() {
    Object.assign(cfg, window.DG_CONFIG || {});
    // se a Vercel guardar os valores em variável de ambiente, eles mandam
    try {
      const r = await fetch("/api/config", { cache: "no-store" });
      if (r.ok) {
        const j = await r.json();
        if (j && j.url && j.chave) Object.assign(cfg, j);
      }
    } catch { /* sem a função, valem os do config.js */ }

    if (!cfg.url || cfg.url.includes("SEU-PROJETO")) {
      throw new Error("A DiliGLA ainda não sabe o endereço do banco. "
        + "Preencha js/config.js ou as variáveis SUPABASE_URL e SUPABASE_ANON_KEY na Vercel.");
    }

    try { sessao = JSON.parse(localStorage.getItem(CHAVE_SESSAO) || "null"); } catch { sessao = null; }
    if (sessao) {
      try { await garantirToken(); eu = await buscarMeuPerfil(); }
      catch { sessao = null; localStorage.removeItem(CHAVE_SESSAO); }
    }
    escoarFila();
    return eu;
  }

  function guardarSessao(j) {
    sessao = {
      access_token: j.access_token,
      refresh_token: j.refresh_token,
      expira_em: Date.now() + (j.expires_in || 3600) * 1000 - 60000,
      usuario: j.user || (sessao && sessao.usuario) || null,
    };
    localStorage.setItem(CHAVE_SESSAO, JSON.stringify(sessao));
  }

  async function garantirToken() {
    if (!sessao) throw new Error("sem sessão");
    if (Date.now() < sessao.expira_em) return sessao.access_token;
    const r = await fetch(`${cfg.url}/auth/v1/token?grant_type=refresh_token`, {
      method: "POST",
      headers: { apikey: cfg.chave, "Content-Type": "application/json" },
      body: JSON.stringify({ refresh_token: sessao.refresh_token }),
    });
    if (!r.ok) throw new Error("sessão expirada");
    guardarSessao(await r.json());
    return sessao.access_token;
  }

  // -------------------------------------------------------------- login
  async function entrar(email, senha) {
    const r = await fetch(`${cfg.url}/auth/v1/token?grant_type=password`, {
      method: "POST",
      headers: { apikey: cfg.chave, "Content-Type": "application/json" },
      body: JSON.stringify({ email: String(email).trim(), password: senha }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      const m = String(j.error_description || j.msg || j.message || "");
      if (/invalid login/i.test(m)) throw new Error("E-mail ou senha não conferem.");
      if (/email not confirmed/i.test(m)) throw new Error("Confirme o e-mail antes de entrar. Veja a caixa de entrada.");
      throw new Error(m || "Não foi possível entrar.");
    }
    guardarSessao(j);
    eu = await buscarMeuPerfil();
    emitir("entrou", eu);
    return eu;
  }

  async function criarConta(email, senha, nome) {
    const r = await fetch(`${cfg.url}/auth/v1/signup`, {
      method: "POST",
      headers: { apikey: cfg.chave, "Content-Type": "application/json" },
      body: JSON.stringify({ email: String(email).trim(), password: senha, data: { nome } }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.msg || j.error_description || "Não foi possível criar a conta.");
    if (j.access_token) { guardarSessao(j); eu = await buscarMeuPerfil(); }
    return j;
  }

  // A administração cria a conta de outra pessoa. O caminho principal é a
  // função /api/membros, que usa a chave secreta do Supabase no servidor e
  // deixa a conta pronta para entrar. Se ela não estiver configurada, cai no
  // cadastro comum — sem guardar a sessão da conta nova, para quem está
  // criando continuar logado — e acerta o acesso pela dg_definir_papel.
  async function criarMembro({ email, senha, nome, cargo, papel, apelidos }) {
    const token = await garantirToken();
    let r = null;
    try {
      r = await fetch("/api/membros", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ email, senha, nome, cargo, papel, apelidos }),
      });
    } catch { r = null; }
    if (r && r.ok) return { ...(await r.json()), confirmada: true };
    if (r && r.status !== 404 && r.status !== 501 && r.status !== 405) {
      const j = await r.json().catch(() => ({}));
      throw new Error(j.erro || `erro ${r.status}`);
    }

    const s = await fetch(`${cfg.url}/auth/v1/signup`, {
      method: "POST",
      headers: { apikey: cfg.chave, "Content-Type": "application/json" },
      body: JSON.stringify({ email: String(email).trim(), password: senha, data: { nome, cargo } }),
    });
    const j = await s.json().catch(() => ({}));
    if (!s.ok) {
      const m = String(j.msg || j.error_description || j.message || "");
      if (/already|registered/i.test(m)) throw new Error(`Já existe uma conta com ${email}.`);
      if (s.status === 429 || /rate limit/i.test(m)) {
        throw new Error("O Supabase atingiu o limite de e-mails de confirmação por hora, e a conta "
          + "não foi criada. Para não depender de e-mail: desligue “Confirm email” no Supabase "
          + "(Authentication → Sign In / Providers → Email) ou cadastre a SUPABASE_SERVICE_ROLE_KEY "
          + "na Vercel. Depois é só tentar de novo.");
      }
      throw new Error(m || "Não foi possível criar a conta.");
    }
    const id = (j.user && j.user.id) || j.id;
    if (!id) throw new Error("O Supabase não devolveu a conta criada.");
    await rpc("dg_definir_papel", {
      p_membro: id, p_papel: papel, p_apelidos: apelidos || [], p_ativo: true,
      p_nome: nome, p_cargo: cargo || "",
    });
    return { id, confirmada: !!j.access_token || !!(j.user && j.user.email_confirmed_at) };
  }

  async function recuperarSenha(email) {
    const r = await fetch(`${cfg.url}/auth/v1/recover`, {
      method: "POST",
      headers: { apikey: cfg.chave, "Content-Type": "application/json" },
      body: JSON.stringify({ email: String(email).trim() }),
    });
    if (!r.ok) throw new Error("Não foi possível enviar o e-mail de recuperação.");
  }

  async function trocarSenha(nova) {
    await req("PUT", "/auth/v1/user", { password: nova }, true);
  }

  function sair() {
    sessao = null; eu = null;
    localStorage.removeItem(CHAVE_SESSAO);
    emitir("saiu");
  }

  // ---------------------------------------------------------- requisição
  async function req(metodo, caminho, corpo, cru, prefer) {
    const token = await garantirToken();
    const cabecalho = {
      apikey: cfg.chave,
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    };
    if (prefer) cabecalho.Prefer = prefer;
    else if (!cru) cabecalho.Prefer = "return=representation";
    const r = await fetch(cfg.url + caminho, {
      method: metodo, headers: cabecalho,
      body: corpo === undefined ? undefined : JSON.stringify(corpo),
    });
    if (r.status === 204) return null;
    const texto = await r.text();
    let j = null;
    try { j = texto ? JSON.parse(texto) : null; } catch { j = texto; }
    if (!r.ok) {
      const msg = (j && (j.message || j.error_description || j.msg)) || `erro ${r.status}`;
      const e = new Error(msg);
      e.status = r.status;
      e.detalhe = j && j.details;
      throw e;
    }
    return j;
  }

  const ler  = caminho => req("GET", "/rest/v1" + caminho);
  const rpc  = (nome, args) => req("POST", `/rest/v1/rpc/${nome}`, args || {});

  async function buscarMeuPerfil() {
    const l = await ler(`/membros?id=eq.${sessao.usuario ? sessao.usuario.id : meuId()}&select=*`);
    return (l && l[0]) || null;
  }
  function meuId() {
    if (sessao && sessao.usuario) return sessao.usuario.id;
    try { return JSON.parse(atob(sessao.access_token.split(".")[1])).sub; } catch { return null; }
  }

  // ========================================================== fila de escrita
  // Cada item é { id, tabela, chave, campos } ou { id, rpc, args }. Itens da
  // mesma linha e mesmo campo são fundidos, para que vinte teclas digitadas
  // numa célula não virem vinte requisições.
  let fila = [];
  try { fila = JSON.parse(localStorage.getItem(CHAVE_FILA) || "[]"); } catch { fila = []; }
  let escoando = false, tempoEscoar = null;

  function salvarFila() {
    try { localStorage.setItem(CHAVE_FILA, JSON.stringify(fila)); } catch { /* cheio; a fila segue em memória */ }
    emitir("fila", fila.length);
  }

  function enfileirar(item) {
    if (item.tabela) {
      const igual = fila.find(f => f.tabela === item.tabela && f.chave === item.chave && !f.enviando);
      if (igual) { Object.assign(igual.campos, item.campos); salvarFila(); agendar(); return; }
    }
    fila.push({ ...item, id: Math.random().toString(36).slice(2), tentativas: 0 });
    salvarFila(); agendar();
  }

  function agendar(ms) {
    clearTimeout(tempoEscoar);
    tempoEscoar = setTimeout(escoarFila, ms === undefined ? 400 : ms);
  }

  async function escoarFila() {
    if (escoando || !fila.length || !sessao) return;
    escoando = true;
    emitir("sincronizando", true);
    try {
      while (fila.length) {
        const item = fila[0];
        try {
          if (item.rpc) await rpc(item.rpc, item.args);
          else if (item.caminho) await req(item.metodo || "POST", item.caminho, item.corpo, true,
                        item.upsert ? "resolution=merge-duplicates" : null);
          else await req("PATCH", `/rest/v1/${item.tabela}?${item.chave}`, item.campos, true);
          fila.shift(); salvarFila();
        } catch (e) {
          item.tentativas++;
          // 4xx não melhora com insistência: o item é descartado e a pessoa avisada
          if (e.status && e.status >= 400 && e.status < 500) {
            fila.shift(); salvarFila();
            emitir("recusado", { item, erro: e.message });
          } else {
            salvarFila();
            agendar(Math.min(30000, 2000 * item.tentativas));
            break;
          }
        }
      }
    } finally {
      escoando = false;
      emitir("sincronizando", false);
      emitir("fila", fila.length);
    }
  }

  window.addEventListener("online", () => agendar(100));
  window.addEventListener("beforeunload", e => {
    if (!fila.length) return;
    e.preventDefault(); e.returnValue = "";
  });

  // ===================================================== carga e escrita
  // Tudo de uma vez, em páginas, porque mil processos cabem com folga na
  // memória e a grade fica instantânea depois disso.
  async function paginado(caminho, passo) {
    const tamanho = passo || 1000;
    let de = 0, tudo = [];
    for (;;) {
      const lote = await ler(`${caminho}${caminho.includes("?") ? "&" : "?"}limit=${tamanho}&offset=${de}`);
      tudo = tudo.concat(lote || []);
      if (!lote || lote.length < tamanho) return tudo;
      de += tamanho;
    }
  }

  async function carregarTudo() {
    const [membros, materias, carteiras, blocos, gatilhos, verbos] = await Promise.all([
      ler("/membros?select=*&order=nome"),
      ler("/materias?select=*&order=ordem"),
      ler("/carteiras?select=*&order=ordem"),
      ler("/blocos?select=*&order=ordem"),
      ler("/gatilhos?select=*&order=ordem"),
      ler("/objetivo_verbos?select=*"),
    ]);
    const processos = await paginado("/v_processos?select=*&order=npu");
    const movimentos = await paginado("/movimentos?select=*&order=data");
    const transferencias = await ler(
      "/transferencias?select=*,processo:processos(npu)&order=criada_em.desc&limit=400");
    return { membros, materias, carteiras, blocos, gatilhos, verbos,
             processos, movimentos, transferencias };
  }

  // Alterar um campo de um processo. Entra na tela na hora; sobe depois.
  function alterarProcesso(id, campos) {
    enfileirar({ tabela: "processos", chave: `id=eq.${id}`, campos });
  }

  // Andamentos do PJe: upsert, para que consultar duas vezes não duplique
  // linha nenhuma. Vão em lotes, que uma carteira grande traz milhares.
  function registrarMovimentos(linhas) {
    for (let i = 0; i < linhas.length; i += 500) {
      enfileirar({
        metodo: "POST",
        caminho: "/rest/v1/movimentos?on_conflict=processo_id,chave",
        corpo: linhas.slice(i, i + 500),
        upsert: true,
      });
    }
  }

  return {
    iniciar, ao, entrar, criarConta, criarMembro, recuperarSenha, trocarSenha, sair,
    get eu() { return eu; },
    get logado() { return !!sessao && !!eu; },
    get pendentes() { return fila.length; },
    get config() { return { ...cfg }; },
    meuId, ler, rpc, req, paginado, carregarTudo, alterarProcesso, registrarMovimentos,
    enfileirar, escoarFila,
    gestora: () => !!eu && eu.papel === "gestora",
    escreve: () => !!eu && (eu.papel === "gestora" || eu.papel === "diligente"),
  };
})();
