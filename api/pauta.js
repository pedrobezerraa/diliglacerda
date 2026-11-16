// O processo entrou em pauta de julgamento?
//
// GET /api/pauta?numero=0000000-00.0000.8.17.0000
//
// Cruza duas fontes públicas do CNJ: o DataJud (movimentos como "Inclusão em
// pauta", "Retirada de pauta", "Adiamento") e o DJEN (publicações de pauta, com
// a data da sessão, e de resultado de julgamento). A lógica mora em lib/pauta/.
//
// Existe como função, e não no navegador, por dois motivos: o DataJud exige uma
// chave no cabeçalho e nenhuma das duas APIs libera CORS. E roda em São Paulo
// (vercel.json, "regions"): o DJEN costuma recusar (HTTP 403) quem vem de fora
// do Brasil.
const { verificarPauta } = require("../lib/pauta/pauta");
const { NumeroInvalidoError } = require("../lib/pauta/cnj");

function responder(res, status, corpo) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(corpo));
}

module.exports = async (req, res) => {
  if (req.method !== "GET") return responder(res, 405, { erro: "Use GET /api/pauta?numero=..." });

  const url = new URL(req.url, "http://localhost");
  const numero = url.searchParams.get("numero") || url.searchParams.get("processo");
  if (!numero) {
    return responder(res, 400, { erro: 'Informe o parâmetro "numero". Ex.: /api/pauta?numero=0000000-00.0000.8.17.0000' });
  }

  try {
    const resultado = await verificarPauta(numero, { apiKey: process.env.DATAJUD_API_KEY });
    const status = resultado.situacao === "indeterminado" ? 502 : 200;
    // dez minutos de cache na borda: verificar a carteira inteira duas vezes
    // seguidas não deve virar o dobro de consultas às APIs públicas
    if (status === 200) res.setHeader("Cache-Control", "public, s-maxage=600, stale-while-revalidate=300");
    return responder(res, status, resultado);
  } catch (e) {
    if (e instanceof NumeroInvalidoError) return responder(res, 400, { erro: e.message });
    console.error(e);
    return responder(res, 500, { erro: "Erro interno ao consultar o processo." });
  }
};
