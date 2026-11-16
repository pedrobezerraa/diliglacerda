'use strict';
// Cliente da API Pública do DataJud (CNJ)
// Docs: https://datajud-wiki.cnj.jus.br/api-publica/

// Chave pública divulgada pelo CNJ. Ela pode mudar a qualquer momento:
// se a API passar a responder 401/403, pegue a chave nova em
// https://datajud-wiki.cnj.jus.br/api-publica/acesso e defina DATAJUD_API_KEY.
const CHAVE_PUBLICA_PADRAO =
  'cDZHYzlZa0JadVREZDJCendQbXY6SkJlTzNjLV9TRENyQk1RdnFKZGRQdw==';

const BASE = 'https://api-publica.datajud.cnj.jus.br';

async function consultarDataJud(cnj, opcoes = {}) {
  const { fetchFn = fetch, apiKey, timeoutMs = 12000 } = opcoes;
  const pausasRepeticao = opcoes.pausasRepeticao ?? [1500, 3500];
  if (!cnj.alias) {
    return { ok: false, encontrado: false, erro: 'Tribunal sem endpoint no DataJud.', hits: [] };
  }
  const url = `${BASE}/api_publica_${cnj.alias}/_search`;
  const chave = apiKey || CHAVE_PUBLICA_PADRAO;

  // O DataJud público limita o ritmo (HTTP 429) e às vezes oscila (5xx). Numa
  // verificação de carteira inteira isso aparece; uma segunda tentativa depois
  // de uma pausa curta resolve a maior parte, sem passar do tempo da função.
  const pedir = () => fetchFn(url, {
    method: 'POST',
    headers: {
      Authorization: `APIKey ${chave}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({ size: 10, query: { match: { numeroProcesso: cnj.digitos } } }),
    signal: AbortSignal.timeout(timeoutMs),
  });

  let resp;
  const inicio = Date.now();
  try {
    resp = await pedir();
    for (const pausa of pausasRepeticao) {
      if (resp.status !== 429 && resp.status < 500) break;
      // a função tem 30 s na Vercel: se o DataJud já gastou demais, desiste
      if (Date.now() - inicio > 9000) break;
      if (pausa) await new Promise((r) => setTimeout(r, pausa));
      resp = await pedir();
    }
  } catch (e) {
    return { ok: false, encontrado: false, erro: `Falha de conexão com o DataJud: ${e.message}`, hits: [] };
  }
  if (resp.status === 429) {
    return { ok: false, encontrado: false, hits: [],
             erro: 'DataJud limitou as consultas agora (HTTP 429). Tente de novo em alguns minutos.' };
  }

  if (resp.status === 401 || resp.status === 403) {
    return {
      ok: false, encontrado: false, hits: [],
      erro: `DataJud recusou a chave (HTTP ${resp.status}). Atualize DATAJUD_API_KEY.`,
    };
  }
  if (!resp.ok) {
    return { ok: false, encontrado: false, erro: `DataJud respondeu HTTP ${resp.status}.`, hits: [] };
  }

  let json;
  try {
    json = await resp.json();
  } catch {
    return { ok: false, encontrado: false, erro: 'DataJud devolveu uma resposta que não é JSON.', hits: [] };
  }

  const hits = (json?.hits?.hits ?? [])
    .map((h) => h?._source)
    .filter((s) => s && typeof s === 'object');

  return { ok: true, encontrado: hits.length > 0, erro: null, hits };
}

module.exports = { CHAVE_PUBLICA_PADRAO, consultarDataJud };
