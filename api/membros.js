// Cria a conta de um integrante da equipe, por dentro da DiliGLA.
//
// Só quem tem acesso de administração (a gestora e Pedro Miguel) pode usar.
// A conta nasce já confirmada, com a senha provisória escolhida na tela, e
// com nome, cargo, acesso e apelidos acertados — a pessoa entra direto.
//
// Precisa da variável SUPABASE_SERVICE_ROLE_KEY na Vercel (a chave secreta
// do projeto: Supabase → Project Settings → API Keys). Ela fica só aqui no
// servidor e nunca vai para o navegador. Sem ela, a função responde 501 e a
// tela cai no cadastro comum (a pessoa pode precisar confirmar o e-mail).
const ACESSOS = new Set(["gestora", "diligente", "leitura"]);

function responder(res, status, corpo) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(corpo));
}

async function lerCorpo(req) {
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string") return JSON.parse(req.body || "{}");
  const partes = [];
  for await (const p of req) partes.push(p);
  return JSON.parse(Buffer.concat(partes).toString("utf8") || "{}");
}

// as chaves novas (sb_secret_...) não são JWT e vão só no apikey
function cabecalhoServico(chave) {
  const h = { apikey: chave, "Content-Type": "application/json" };
  if (chave.startsWith("eyJ")) h.Authorization = `Bearer ${chave}`;
  return h;
}

module.exports = async (req, res) => {
  if (req.method !== "POST") return responder(res, 405, { erro: "Use POST." });

  const url = process.env.SUPABASE_URL;
  const anon = process.env.SUPABASE_ANON_KEY;
  const servico = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !anon || !servico) {
    return responder(res, 501, { erro: "sem_chave_servico" });
  }

  const token = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (!token) return responder(res, 401, { erro: "Entre no sistema antes de criar contas." });

  let corpo;
  try { corpo = await lerCorpo(req); } catch { return responder(res, 400, { erro: "Pedido mal formado." }); }

  const email = String(corpo.email || "").trim().toLowerCase();
  const senha = String(corpo.senha || "");
  const nome = String(corpo.nome || "").trim();
  const cargo = String(corpo.cargo || "").trim() || null;
  const papel = ACESSOS.has(corpo.papel) ? corpo.papel : "diligente";
  const apelidos = Array.isArray(corpo.apelidos)
    ? corpo.apelidos.map(a => String(a).trim()).filter(Boolean).slice(0, 20) : [];

  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return responder(res, 400, { erro: "E-mail inválido." });
  if (senha.length < 8) return responder(res, 400, { erro: "A senha precisa de pelo menos 8 caracteres." });
  if (!nome) return responder(res, 400, { erro: "Escreva o nome completo." });

  try {
    // 1. quem pede tem acesso de administração? Pergunta ao próprio banco,
    //    com o token de quem pediu: a regra é a mesma das políticas.
    const r1 = await fetch(`${url}/rest/v1/rpc/dg_gestora`, {
      method: "POST",
      headers: { apikey: anon, Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: "{}",
    });
    if (r1.status === 401) return responder(res, 401, { erro: "Sessão expirada. Entre de novo." });
    if (!r1.ok || (await r1.json()) !== true) {
      return responder(res, 403, { erro: "Só quem tem acesso de administração cria contas." });
    }

    // 2. cria a conta já confirmada
    const r2 = await fetch(`${url}/auth/v1/admin/users`, {
      method: "POST",
      headers: cabecalhoServico(servico),
      body: JSON.stringify({ email, password: senha, email_confirm: true,
                             user_metadata: { nome, cargo } }),
    });
    const j2 = await r2.json().catch(() => ({}));
    if (!r2.ok) {
      const m = String(j2.msg || j2.message || j2.error_description || j2.error || "");
      if (/already|registered|exists/i.test(m)) {
        return responder(res, 409, { erro: `Já existe uma conta com ${email}. Ajuste o acesso dela na lista da equipe.` });
      }
      if (/password/i.test(m)) return responder(res, 400, { erro: `Senha recusada pelo Supabase: ${m}` });
      return responder(res, 502, { erro: m || "O Supabase não criou a conta." });
    }
    const id = j2.id || (j2.user && j2.user.id);

    // 3. o gatilho do banco criou a linha em membros como leitura; aqui ela
    //    recebe o acesso, o cargo e os apelidos escolhidos na tela
    const r3 = await fetch(`${url}/rest/v1/membros?id=eq.${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: { ...cabecalhoServico(servico), Prefer: "return=representation" },
      body: JSON.stringify({ nome, cargo, papel, apelidos, ativo: true }),
    });
    const j3 = await r3.json().catch(() => null);
    if (!r3.ok) {
      return responder(res, 502, { erro: "A conta foi criada, mas não deu para acertar o acesso. "
                                       + "Ajuste na lista da equipe.", id });
    }
    return responder(res, 200, { id, membro: Array.isArray(j3) ? j3[0] : j3 });
  } catch (e) {
    return responder(res, 502, { erro: `Falha ao falar com o Supabase: ${e.message}` });
  }
};
