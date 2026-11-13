// Intermediário entre a página da GLAnda e o serviço público MNI do PJe do TJPE (1º e 2º graus).
// Existe porque o navegador não pode chamar o TJPE diretamente (regra de segurança CORS).
// Esta é a tradução fiel da lógica que roda na versão em Python.

const ENDERECOS = {
  "1": process.env.MNI_URL || "https://pjemni.app.tjpe.jus.br/1g/servico-intercomunicacao-2.2.2",
  "2": process.env.MNI_URL_2G || "https://pjemni.app.tjpe.jus.br/2g/servico-intercomunicacao-2.2.2",
};
const NS_OPERACAO = "http://www.cnj.jus.br/servico-intercomunicacao-2.2.2/";
const NS_CAMPOS = "http://www.cnj.jus.br/tipos-servico-intercomunicacao-2.2.2";
const LIMITE_MOVIMENTOS = 300;

// Códigos da Tabela Processual Unificada (CNJ) que representam julgamento/sentença
const CODIGOS_SENTENCA = new Set([219, 220, 221, 466, 456, 458, 459, 461, 462, 463, 464, 465,
  11374, 11376, 11380, 11381, 12256, 12298, 14848, 196, 193, 385]);
const CODIGOS_CONCLUSAO = new Set([51]);
// Julgamento de recurso no 2º grau; não confirmados em fonte oficial do CNJ, por isso a
// classificação se apoia sobretudo no grau e no texto. Dá para acrescentar outros na tela.
const CODIGOS_ACORDAO = new Set([237, 238, 239, 240, 241, 242, 236, 235, 456, 11373, 11375, 11379]);
const NOMES_ACORDAO = { 237: "Provimento", 238: "Provimento em parte", 242: "Não provimento",
  236: "Não conhecimento de recurso", 235: "Conhecimento de recurso" };
const NOMES_TPU = { ...NOMES_ACORDAO,
  219: "Julgado procedente", 220: "Julgado improcedente", 221: "Julgado procedente em parte",
  466: "Homologada a transação", 456: "Extinção do processo", 196: "Extinção da execução",
  26: "Distribuição", 51: "Conclusão", 85: "Juntada de petição", 60: "Expedição de documento",
  11010: "Despacho de mero expediente", 581: "Juntada de documento", 848: "Trânsito em julgado",
  22: "Baixa definitiva", 246: "Arquivamento definitivo", 123: "Remessa", 67: "Juntada" };
const PALAVRAS_PADRAO = {
  acordao: ["acordao", "provimento", "provido", "improvido", "desprovid", "nao conhecimento",
    "conhecido o recurso", "julgamento do recurso", "negou-se", "deu-se", "recurso",
    "apelacao", "agravo", "embargos de declaracao"],
  sentenca: ["julgad", "procedencia", "improcedencia", "procedente", "improcedente",
    "extincao", "extinta", "extinto", "resolucao do merito", "proferida sentenca",
    "proferido sentenca", "prolatada sentenca", "sentenca proferida", "sentenca publicada",
    "homologacao de transacao", "homologada a transacao", "homologado o acordo",
    "homologacao de acordo", "homologada a desistencia", "homologacao da desistencia",
    "homologada a renuncia", "homologacao da renuncia"],
  conclusao: ["conclus"],
};
const TIPOS_REGRA = ["sentenca", "acordao", "conclusao"];

// ---------------------------------------------------------------- utilidades
// NFKD (e não NFD) para igualar o Python: decompõe também "º", "ª" e similares
const semAcento = t => String(t ?? "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
const soDigitos = t => String(t ?? "").replace(/\D/g, "");

function decodificar(t) {
  return String(t ?? "")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/g, "&");
}

// Horário de Brasília (sem horário de verão desde 2019)
function agoraBrasilia() {
  return new Date(Date.now() - 3 * 3600000);
}

/** "AAAAMMDDhhmmss" do MNI vira um instante tratado como horário de Brasília. */
function dataMni(valor) {
  const v = soDigitos(valor);
  if (v.length < 8) return null;
  const c = v.padEnd(14, "0");
  const d = Date.UTC(+c.slice(0, 4), +c.slice(4, 6) - 1, +c.slice(6, 8),
                     +c.slice(8, 10), +c.slice(10, 12), +c.slice(12, 14));
  return Number.isNaN(d) ? null : new Date(d);
}

function iso(d) {
  if (!d) return "";
  return d.toISOString().slice(0, 19);
}

function formatar(n) {
  return `${n.slice(0, 7)}-${n.slice(7, 9)}.${n.slice(9, 13)}.${n[13]}.${n.slice(14, 16)}.${n.slice(16)}`;
}

// ---------------------------------------------------------------- leitura do XML do PJe
/** O PJe responde em MTOM (multipart): há cabeçalhos MIME em volta do XML. */
function extrairEnvelope(texto) {
  const inicio = texto.search(/<(?:[A-Za-z0-9_.-]+:)?Envelope[\s>]/);
  const fins = [...texto.matchAll(/<\/(?:[A-Za-z0-9_.-]+:)?Envelope\s*>/g)];
  if (inicio < 0 || !fins.length) throw new Error("resposta do PJe em formato desconhecido");
  const ultimo = fins[fins.length - 1];
  return texto.slice(inicio, ultimo.index + ultimo[0].length);
}

/** Lê os atributos de uma tag de abertura. */
function atributos(tag) {
  const saida = {};
  for (const m of tag.matchAll(/([A-Za-z_][\w.:-]*)\s*=\s*"([^"]*)"|([A-Za-z_][\w.:-]*)\s*=\s*'([^']*)'/g)) {
    saida[(m[1] || m[3]).split(":").pop()] = decodificar(m[2] ?? m[4]);
  }
  return saida;
}

/** Devolve [{attrs, interior}] de cada elemento com esse nome local, respeitando aninhamento. */
function elementos(xml, nome) {
  const achados = [];
  const abre = new RegExp(`<(?:[A-Za-z0-9_.-]+:)?${nome}(\\s[^>]*?)?(/?)>`, "g");
  const fecha = new RegExp(`</(?:[A-Za-z0-9_.-]+:)?${nome}\\s*>`, "g");
  let m;
  while ((m = abre.exec(xml))) {
    const attrs = atributos(m[1] || "");
    if (m[2] === "/") { achados.push({ attrs, interior: "" }); continue; }
    // acha o fechamento correspondente, pulando elementos de mesmo nome aninhados
    let nivel = 1, pos = abre.lastIndex, fim = -1;
    while (nivel > 0) {
      abre.lastIndex = pos; fecha.lastIndex = pos;
      const a = abre.exec(xml), f = fecha.exec(xml);
      if (!f) break;
      if (a && a.index < f.index) { if (a[2] !== "/") nivel++; pos = abre.lastIndex; }
      else { nivel--; pos = fecha.lastIndex; if (!nivel) fim = f.index; }
    }
    if (fim < 0) break;
    achados.push({ attrs, interior: xml.slice(m.index + m[0].length, fim) });
    abre.lastIndex = pos;
  }
  return achados;
}

function textoDe(xml, nome) {
  const e = elementos(xml, nome)[0];
  return e ? decodificar(e.interior.replace(/<[^>]*>/g, "")).trim() : "";
}

function lerResposta(corpo, grau = "1") {
  const xml = extrairEnvelope(corpo);
  const falha = elementos(xml, "Fault")[0];
  if (falha) {
    const texto = decodificar(falha.interior.replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();
    const erro = new Error(texto.slice(0, 300) || "o PJe recusou a consulta");
    erro.mni = true;
    throw erro;
  }
  const mensagem = textoDe(xml, "mensagem");
  const proc = elementos(xml, "processo")[0];
  if (!proc) return { encontrado: false, mensagem: mensagem || "processo não encontrado" };

  const dados = elementos(proc.interior, "dadosBasicos")[0];
  let orgao = "", classe = "", ajuizamento = null, colegiado = "";
  if (dados) {
    const org = elementos(dados.interior, "orgaoJulgador")[0];
    orgao = org ? (org.attrs.nomeOrgao || "") : "";
    classe = dados.attrs.classeProcessual || "";
    ajuizamento = dataMni(dados.attrs.dataAjuizamento);
    // o TJPE manda o colegiado num parâmetro livre, separado do gabinete
    for (const par of elementos(dados.interior, "outroParametro")) {
      if (/orgaoJulgadorColegiado:descricao$/.test(par.attrs.nome || "")) colegiado = par.attrs.valor || "";
    }
  }

  const movimentos = [];
  for (const m of elementos(proc.interior, "movimento")) {
    const nac = elementos(m.interior, "movimentoNacional")[0];
    const loc = elementos(m.interior, "movimentoLocal")[0];
    const cod = nac ? (nac.attrs.codigoNacional || "") : "";
    const codigo = /^\d+$/.test(cod) ? parseInt(cod, 10) : null;
    let nome = (loc ? loc.attrs.descricao : "") || NOMES_TPU[codigo] || "";
    if (!nome) nome = codigo ? `Movimento ${codigo}` : "Movimento local";
    const comps = elementos(m.interior, "complemento")
      .map(c => decodificar(c.interior.replace(/<[^>]*>/g, "")).replace(/\s+/g, " ").trim())
      .filter(Boolean);
    const texto = [nome, ...comps.filter(c => c !== nome)].join(" | ").slice(0, 300);
    movimentos.push({ data: dataMni(m.attrs.dataHora), codigo, grau, texto });
  }
  const ordenados = movimentos.filter(m => m.data).sort((a, b) => a.data - b.data);
  return { encontrado: true, mensagem, orgao, classe, colegiado, relator: relatorDoOrgao(orgao),
           ajuizamento, movimentos: ordenados };
}

// No 2º grau o nome do órgão às vezes já é o gabinete do relator
// ("Gabinete do Des. Fulano de Tal 2ª TCRC (2)"). Quando é, o nome sai daí — dado do
// próprio campo, não adivinhado. Quando o gabinete é anônimo ("3ª Câmara de Direito
// Público - 2º Gabinete") devolve vazio, de propósito: melhor em branco que inventado.
function relatorDoOrgao(nomeOrgao) {
  const m = /gabinete\s+(?:d[oa]s?\s+)?(?:des(?:embargador)?(?:a)?|dr(?:a)?|ju[ií]z(?:a)?|min(?:istro|istra)?)\.?\s+(.+)$/i
    .exec(String(nomeOrgao || ""));
  if (!m) return "";
  // corta o que vem depois do nome: sigla da turma, número, parênteses, travessão
  const nome = m[1].split(/\s+(?=\d|\()|\s+-\s+/)[0]
    .replace(/^(?:convocad[oa]|substitut[oa]|auxiliar|titular|federal|relator[a]?)\s+/i, "")
    .replace(/\s+/g, " ").trim();
  if (!/^[A-Za-zÀ-ÿ'.]+(?:\s+[A-Za-zÀ-ÿ'.]+){1,6}$/.test(nome)) return "";
  return nome;
}

// ---------------------------------------------------------------- classificação
function combina(texto, codigo, tipo, extras) {
  const lista = [...(PALAVRAS_PADRAO[tipo] || []), ...((extras && extras[tipo]) || [])];
  for (const p of lista) {
    if (!p) continue;
    if (/^\d+$/.test(p)) { if (codigo !== null && parseInt(p, 10) === codigo) return true; }
    else if (texto.includes(p)) return true;
  }
  return false;
}

function tipoMovimento(m, extras) {
  const texto = semAcento(m.texto);
  const codigo = m.codigo;
  // conclusão vem primeiro: "conclusos para julgamento" é conclusão, não julgamento
  if (CODIGOS_CONCLUSAO.has(codigo) || combina(texto, codigo, "conclusao", extras)) return "conclusao";
  const decide = CODIGOS_SENTENCA.has(codigo) || CODIGOS_ACORDAO.has(codigo)
    || texto.startsWith("sentenca") || texto.startsWith("acordao")
    || combina(texto, codigo, "sentenca", extras) || combina(texto, codigo, "acordao", extras);
  if (!decide) return "";
  // no 2º grau qualquer julgamento é acórdão; no 1º, sentença
  return m.grau === "2" ? "acordao" : "sentenca";
}

function grupoDe(orgao, classe) {
  const texto = semAcento(orgao);
  if (texto.includes("juizado") || texto.includes("turma recursal")) return "Juizados";
  if (!orgao && ["436", "14695", "14696", "11875"].includes(String(classe))) return "Juizados";
  return "Justiça Comum";
}

/** Mesma identidade usada pela versão em Python, para as ciências já dadas continuarem valendo. */
const crypto = require("crypto");
function resumoTexto(t) {
  return crypto.createHash("md5").update(semAcento(t), "utf8").digest("hex").slice(0, 8);
}

function chaveMovimento(numero, m) {
  const sufixo = (m.grau || "1") === "1" ? "" : "|g2";
  return `${numero}|${iso(m.data)}|${m.codigo ?? ""}|${resumoTexto(m.texto)}${sufixo}`;
}

function inicioJanela(janela) {
  const agora = agoraBrasilia();
  const texto = String(janela || "72");
  if (texto.startsWith("desde:")) {
    const dia = texto.slice(6, 16);
    if (/^\d{4}-\d{2}-\d{2}$/.test(dia)) return new Date(dia + "T00:00:00Z");
    return new Date(agora.getTime() - 72 * 3600000);
  }
  return new Date(agora.getTime() - (texto === "24" ? 24 : 72) * 3600000);
}

function montar(numero, r, janela, r2, extras) {
  r2 = r2 || {};
  const achou = !!r.encontrado, achou2 = !!r2.encontrado;
  const principal = achou ? r : (achou2 ? r2 : r);
  const base = {
    numero: formatar(numero), id: numero,
    grupo: grupoDe(principal.orgao || "", principal.classe || ""),
    orgao: principal.orgao || "",
    orgao_2g: (achou2 && achou) ? (r2.orgao || "") : "",
    colegiado: (achou2 ? r2.colegiado : principal.colegiado) || "",
    relator: (achou2 ? r2.relator : principal.relator) || "",
    encontrado: achou || achou2, erro: "",
  };
  if (!achou && !achou2) {
    return { ...base, grupo: "", erro: r.mensagem || "processo não encontrado" };
  }
  const movs = [...(achou ? r.movimentos : []), ...(achou2 ? r2.movimentos : [])]
    .sort((a, b) => a.data - b.data);
  for (const m of movs) m.tipo = tipoMovimento(m, extras);

  const agora = agoraBrasilia();
  const desde = inicioJanela(janela);
  const noPeriodo = movs.filter(m => m.data >= desde);
  const ultimo = movs.length ? movs[movs.length - 1] : null;

  const porTipo = {};
  for (const [chave, tipo] of [["sent", "sentenca"], ["acor", "acordao"], ["conc", "conclusao"]]) {
    const doTipo = movs.filter(m => m.tipo === tipo);
    porTipo[`${chave}_periodo`] = doTipo.filter(m => m.data >= desde).length;
    porTipo[`${chave}_data`] = doTipo.length ? iso(doTipo[doTipo.length - 1].data) : "";
    porTipo[`${chave}_texto`] = doTipo.length ? doTipo[doTipo.length - 1].texto : "";
  }

  const avisos = [];
  if ([50, 100, 200, 500].includes(movs.length)) {
    avisos.push(`vieram exatamente ${movs.length} movimentos: o serviço pode ter cortado a lista`);
  }
  if (noPeriodo.length > LIMITE_MOVIMENTOS) {
    avisos.push(`${noPeriodo.length} andamentos no período; a tela mostra os ${LIMITE_MOVIMENTOS} mais recentes`);
  }

  return {
    ...base, ...porTipo,
    graus: [...new Set(noPeriodo.map(m => m.grau || "1"))].sort(),
    ultimo_data: ultimo ? iso(ultimo.data) : "",
    ultimo_texto: ultimo ? ultimo.texto : "",
    qtd_periodo: noPeriodo.length,
    qtd_24: movs.filter(m => m.data >= new Date(agora.getTime() - 24 * 3600000)).length,
    qtd_movimentos: movs.length,
    movimentos_periodo: noPeriodo.slice(-LIMITE_MOVIMENTOS).map(m => ({
      data: iso(m.data), codigo: m.codigo, texto: m.texto, tipo: m.tipo,
      grau: m.grau || "1", chave: chaveMovimento(numero, m),
    })),
    ajuizamento: iso(principal.ajuizamento),
    aviso: avisos.join("; "),
  };
}

// ---------------------------------------------------------------- consulta ao TJPE
function envelopeSoap(numero, incluirDocumentos = false) {
  return `<?xml version="1.0" encoding="UTF-8"?><s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" `
    + `xmlns:op="${NS_OPERACAO}" xmlns:c="${NS_CAMPOS}"><s:Header/><s:Body><op:consultarProcesso>`
    + `<c:numeroProcesso>${numero}</c:numeroProcesso><c:movimentos>true</c:movimentos>`
    + `<c:incluirCabecalho>true</c:incluirCabecalho>`
    + `<c:incluirDocumentos>${incluirDocumentos ? "true" : "false"}</c:incluirDocumentos>`
    + `</op:consultarProcesso></s:Body></s:Envelope>`;
}

// O servidor do TJPE envia a cadeia de certificados incompleta: falta o intermediário.
// O navegador busca o que falta sozinho; um servidor não. Então buscamos no endereço que o
// próprio certificado indica e o acrescentamos aos confiáveis. A verificação continua valendo:
// a cadeia ainda precisa terminar numa raiz já confiável. Nada de desligar a conferência.
const http = require("http");
const https = require("https");
const tls = require("tls");
let agentePromessa = null;

function baixarCertificado(url) {
  return new Promise((ok, falhou) => {
    const cliente = url.startsWith("https:") ? https : http;
    cliente.get(url, { timeout: 15000 }, r => {
      if (r.statusCode !== 200) { r.resume(); return falhou(new Error("HTTP " + r.statusCode)); }
      const partes = [];
      r.on("data", p => partes.push(p));
      r.on("end", () => ok(Buffer.concat(partes)));
    }).on("error", falhou);
  });
}

function derParaPem(der) {
  if (der.slice(0, 1).toString() === "-") return der.toString();   // já veio em PEM
  return `-----BEGIN CERTIFICATE-----\n${der.toString("base64").match(/.{1,64}/g).join("\n")}\n-----END CERTIFICATE-----\n`;
}

function lerCertificadoDoServidor(host) {
  return new Promise((ok, falhou) => {
    const s = tls.connect({ host, port: 443, servername: host, rejectUnauthorized: false, timeout: 15000 }, () => {
      const c = s.getPeerCertificate(false);
      s.destroy();
      ok(c);
    });
    s.on("timeout", () => { s.destroy(); falhou(new Error("tempo esgotado ao ler o certificado do TJPE")); });
    s.on("error", falhou);
  });
}

async function montarAgente() {
  const host = new URL(ENDERECOS["1"]).hostname;
  const extras = [];
  try {
    let atual = await lerCertificadoDoServidor(host);
    for (let i = 0; i < 4; i++) {
      const aia = atual && atual.infoAccess && atual.infoAccess["CA Issuers - URI"];
      if (!aia || !aia.length) break;
      const der = await baixarCertificado(aia[0]);
      extras.push(derParaPem(der));
      break;   // um intermediário basta para fechar a cadeia do TJPE
    }
  } catch { /* sem o extra, resta a verificação padrão */ }
  return new https.Agent({ keepAlive: true, ca: [...tls.rootCertificates, ...extras] });
}

function agente() {
  if (!agentePromessa) agentePromessa = montarAgente();
  return agentePromessa;
}

function pedirSoap(endereco, corpo, cab, agenteHttps) {
  return new Promise((ok, falhou) => {
    const u = new URL(endereco);
    const r = (u.protocol === "https:" ? https : http).request({
      host: u.hostname, port: u.port || (u.protocol === "https:" ? 443 : 80),
      path: u.pathname + u.search, method: "POST", headers: cab,
      agent: u.protocol === "https:" ? agenteHttps : undefined, timeout: 45000,
    }, resp => {
      const partes = [];
      resp.on("data", p => partes.push(p));
      resp.on("end", () => ok({ status: resp.statusCode, texto: Buffer.concat(partes).toString("utf8") }));
    });
    r.on("timeout", () => { r.destroy(new Error("o PJe demorou demais para responder")); });
    r.on("error", falhou);
    r.write(corpo);
    r.end();
  });
}

async function consultarPje(numero, grau) {
  const cab = { "Content-Type": "text/xml; charset=utf-8", "SOAPAction": '""',
                "User-Agent": "glanda-web/1.0" };
  const corpo = Buffer.from(envelopeSoap(numero), "utf8");
  cab["Content-Length"] = String(corpo.length);   // sem isto o Node envia em pedaços, que nem todo servidor aceita
  const agenteHttps = await agente();
  let ultimo = "falha desconhecida";
  for (let tentativa = 0; tentativa < 3; tentativa++) {
    try {
      const r = await pedirSoap(ENDERECOS[grau], corpo, cab, agenteHttps);
      if (r.status === 200 || (r.status === 500 && r.texto.includes("Fault"))) return r.texto;
      ultimo = `o PJe respondeu com erro ${r.status}`;
    } catch (e) {
      const c = e.code || e.message;
      ultimo = String(c).includes("CERT") || String(c).includes("SIGNATURE")
        ? "o certificado do TJPE não pôde ser verificado"
        : `sem conexão com o PJe (${c})`;
    }
    await new Promise(r => setTimeout(r, 900 * (tentativa + 1)));
  }
  const erro = new Error(ultimo); erro.mni = true; throw erro;
}

// ---------------------------------------------------------------- rota
module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") {
    res.status(405).json({ ok: false, erro: "método não permitido" });
    return;
  }
  let pedido;
  try {
    pedido = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
  } catch {
    res.status(400).json({ ok: false, erro: "pedido inválido" });
    return;
  }

  const numero = soDigitos(pedido.numero);
  if (numero.length !== 20) {
    res.status(400).json({ ok: false, erro: "número de processo inválido" });
    return;
  }
  if (numero.slice(13, 16) !== "817") {
    res.status(200).json({ ok: true, processo: { numero: formatar(numero), grupo: "", encontrado: false,
                                                 orgao: "", erro: "número não é do TJPE" } });
    return;
  }

  const janela = String(pedido.janela || "72").slice(0, 40);
  const graus = [...String(pedido.graus || "12")].filter(g => g === "1" || g === "2");
  if (!graus.length) graus.push("1");
  const extras = {};
  for (const t of TIPOS_REGRA) {
    extras[t] = Array.isArray(pedido.regras?.[t])
      ? pedido.regras[t].slice(0, 60).map(p => semAcento(p).trim()).filter(Boolean) : [];
  }

  let resposta1 = { encontrado: false, mensagem: "" }, resposta2 = null;
  const falhas = [];
  for (const g of graus) {
    try {
      const lida = lerResposta(await consultarPje(numero, g), g);
      if (g === "1") resposta1 = lida; else resposta2 = lida;
    } catch (e) {
      falhas.push(`${g}º grau: ${e.message}`);
    }
  }

  try {
    const montado = montar(numero, resposta1, janela, resposta2, extras);
    if (falhas.length && !montado.encontrado) {
      res.status(200).json({ ok: false, erro: falhas.join("; ") });
      return;
    }
    if (falhas.length) montado.aviso = [montado.aviso, ...falhas].filter(Boolean).join("; ");
    res.status(200).json({ ok: true, processo: montado });
  } catch (e) {
    res.status(200).json({ ok: false, erro: `resposta inesperada do PJe (${e.message})` });
  }
};

module.exports.interno = { lerResposta, montar, tipoMovimento, elementos, extrairEnvelope, inicioJanela };
