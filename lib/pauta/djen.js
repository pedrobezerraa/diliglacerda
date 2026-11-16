'use strict';
// Cliente da API de comunicações do DJEN (Diário de Justiça Eletrônico Nacional)
// Endpoint público, sem autenticação: https://comunicaapi.pje.jus.br/api/v1/comunicacao
// Observação: a API costuma bloquear IPs de fora do Brasil (HTTP 403).

const BASE = 'https://comunicaapi.pje.jus.br/api/v1/comunicacao';
const POR_PAGINA = 50; // acima disso a API às vezes devolve "items" vazio
const MAX_PAGINAS = 4;

const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

async function consultarDJEN(cnj, { fetchFn = fetch, timeoutMs = 12000, pausaMs = 400 } = {}) {
  const itens = [];
  let total = null;

  for (let pagina = 1; pagina <= MAX_PAGINAS; pagina++) {
    const url = new URL(BASE);
    url.searchParams.set('numeroProcesso', cnj.digitos);
    url.searchParams.set('pagina', String(pagina));
    url.searchParams.set('itensPorPagina', String(POR_PAGINA));

    let resp;
    try {
      resp = await fetchFn(url.toString(), {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (e) {
      return parcial(itens, total, `Falha de conexão com o DJEN: ${e.message}`);
    }

    if (resp.status === 403) {
      return parcial(itens, total,
        'DJEN recusou a conexão (HTTP 403). Essa API costuma bloquear servidores fora do Brasil.');
    }
    if (!resp.ok) return parcial(itens, total, `DJEN respondeu HTTP ${resp.status}.`);

    let json;
    try {
      json = await resp.json();
    } catch {
      return parcial(itens, total, 'DJEN devolveu uma resposta que não é JSON.');
    }

    const lote = Array.isArray(json?.items) ? json.items : [];
    if (typeof json?.count === 'number') total = json.count;
    itens.push(...lote);

    const acabou = lote.length < POR_PAGINA || (total !== null && itens.length >= total);
    if (acabou) break;
    if (pausaMs) await esperar(pausaMs); // a API devolve HTTP 500 sob rajadas
  }

  return { ok: true, erro: null, total: total ?? itens.length, itens, truncado: total !== null && itens.length < total };
}

function parcial(itens, total, erro) {
  return { ok: itens.length > 0, erro, total: total ?? itens.length, itens, truncado: true };
}

// Lê um campo aceitando variações de nome (a API mistura camelCase e snake_case)
function campo(item, ...nomes) {
  for (const n of nomes) {
    if (item?.[n] !== undefined && item?.[n] !== null && item?.[n] !== '') return item[n];
  }
  return null;
}

module.exports = { consultarDJEN, campo };
