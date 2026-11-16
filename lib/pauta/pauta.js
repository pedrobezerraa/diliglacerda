'use strict';
// Núcleo: junta DataJud + DJEN e responde se o processo foi incluído em pauta
const { analisar } = require('./cnj');
const { consultarDataJud } = require('./datajud');
const { consultarDJEN, campo } = require('./djen');
const { semAcento, semHtml, paraIso, dataBr, trecho } = require('./texto');

const TIPOS = {
  inclusao_em_pauta: 'Inclusão em pauta',
  pedido_de_inclusao: 'Pedido de inclusão em pauta',
  retirada_de_pauta: 'Retirada de pauta',
  adiamento: 'Adiamento do julgamento',
  resultado_julgamento: 'Resultado do julgamento / acórdão',
};

// Códigos da Tabela Processual Unificada (TPU/CNJ) usados como reforço.
// A classificação principal é pelo nome do movimento, que é mais estável.
const CODIGOS_TPU = {
  1204: 'inclusao_em_pauta',
  897: 'retirada_de_pauta',
};

// ---------- DataJud: movimentos ----------

function textoMovimento(m) {
  const compl = (m?.complementosTabelados ?? [])
    .map((c) => [c?.nome, c?.descricao].filter(Boolean).join(': '))
    .filter(Boolean);
  return { nome: m?.nome ?? '', complementos: compl };
}

function classificarMovimento(m) {
  const { nome, complementos } = textoMovimento(m);
  const t = semAcento(`${nome} ${complementos.join(' ')}`);

  if (/pauta/.test(t)) {
    if (/retirad|exclusao|excluid/.test(t)) return 'retirada_de_pauta';
    if (/pedido|solicitac/.test(t)) return 'pedido_de_inclusao';
    return 'inclusao_em_pauta';
  }
  if (/adiad|adiamento/.test(t) && /julgamento|sessao/.test(t)) return 'adiamento';
  if (/sessao virtual/.test(t) && /inclu|inserid/.test(t)) return 'inclusao_em_pauta';
  return CODIGOS_TPU[Number(m?.codigo)] ?? null;
}

function eventosDataJud(hits) {
  const eventos = [];
  for (const h of hits) {
    for (const m of h.movimentos ?? []) {
      const tipo = classificarMovimento(m);
      if (!tipo) continue;
      const { nome, complementos } = textoMovimento(m);
      eventos.push({
        data: paraIso(m.dataHora),
        tipo,
        tipo_descricao: TIPOS[tipo],
        descricao: complementos.length ? `${nome} (${complementos.join('; ')})` : nome,
        fonte: 'DataJud',
        grau: h.grau ?? null,
        orgao: m.orgaoJulgador?.nomeOrgao ?? m.orgaoJulgador?.nome ?? h.orgaoJulgador?.nome ?? null,
        codigo_tpu: m.codigo ?? null,
        sessao: null,
        link: null,
      });
    }
  }
  return eventos;
}

function resumoInstancias(hits) {
  return hits.map((h) => {
    const movs = [...(h.movimentos ?? [])].sort((a, b) =>
      String(paraIso(b.dataHora)).localeCompare(String(paraIso(a.dataHora))));
    const ult = movs[0];
    return {
      grau: h.grau ?? null,
      classe: h.classe?.nome ?? null,
      orgao_julgador: h.orgaoJulgador?.nome ?? null,
      data_ajuizamento: paraIso(h.dataAjuizamento),
      atualizado_em: paraIso(h.dataHoraUltimaAtualizacao),
      total_movimentos: movs.length,
      ultimo_movimento: ult ? { data: paraIso(ult.dataHora), nome: ult.nome ?? null } : null,
    };
  });
}

// ---------- DJEN: publicações ----------

function classificarPublicacao(item) {
  const texto = semAcento(`${campo(item, 'tipoDocumento', 'tipo_documento') ?? ''} ${semHtml(campo(item, 'texto') ?? '')}`);

  if (/retirad[oa]s? de pauta|exclusao de pauta|excluid[oa]s? (da|de) pauta/.test(texto)) return 'retirada_de_pauta';
  if (/(adiad[oa]s?|adiamento)\b.{0,80}(julgamento|sessao)|(julgamento|sessao).{0,80}\badiad/.test(texto)) return 'adiamento';
  if (/certidao de julgamento|resultado (do|de) julgamento|\bacordao\b|\bementa\b/.test(texto)) return 'resultado_julgamento';
  if (/\bpauta\b|sessao (virtual|presencial|telepresencial|hibrida|ordinaria|extraordinaria|de julgamento)/.test(texto)) {
    return 'inclusao_em_pauta';
  }
  return null;
}

const MESES = {
  janeiro: '01', fevereiro: '02', marco: '03', abril: '04', maio: '05', junho: '06',
  julho: '07', agosto: '08', setembro: '09', outubro: '10', novembro: '11', dezembro: '12',
};

const RE_DATA = new RegExp(
  String.raw`(\d{1,2})[\/.](\d{1,2})[\/.](\d{4})|(\d{1,2})(?:º)? de (${Object.keys(MESES).join('|')}) de (\d{4})`,
  'g'
);

function isoDeMatch(m) {
  if (m[1]) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  return `${m[6]}-${MESES[m[5]]}-${m[4].padStart(2, '0')}`;
}

// Procura a data da sessão perto das palavras "sessão" ou "pauta"
function extrairSessao(textoPlano) {
  const t = semAcento(textoPlano);
  const ancoras = [...t.matchAll(/sessao|pauta/g)].map((m) => m.index);

  for (const ini of ancoras) {
    const janela = t.slice(ini, ini + 350);
    RE_DATA.lastIndex = 0;
    const datas = [...janela.matchAll(RE_DATA)];
    if (!datas.length) continue;

    const primeira = datas[0];
    const sessao = { inicio: isoDeMatch(primeira), fim: null, hora: null };

    // Sessão virtual com período: "de 10/03/2026 a 17/03/2026"
    const segunda = datas[1];
    if (segunda) {
      const entre = janela.slice(primeira.index + primeira[0].length, segunda.index);
      if (/^\s*(a|ate|e)\s*(o dia\s*)?$/.test(entre)) sessao.fim = isoDeMatch(segunda);
    }

    const depois = janela.slice(primeira.index, primeira.index + 120);
    const h = depois.match(/\b(?:as|a partir das|horario:?)\s*(\d{1,2})\s*(?:h|:|horas)\s*(\d{2})?/);
    if (h) sessao.hora = `${h[1].padStart(2, '0')}:${h[2] ?? '00'}`;
    return sessao;
  }
  return null;
}

function eventosDJEN(itens) {
  const eventos = [];
  for (const item of itens) {
    const tipo = classificarPublicacao(item);
    if (!tipo) continue;
    const textoPlano = semHtml(campo(item, 'texto') ?? '');
    const hash = campo(item, 'hash');
    eventos.push({
      data: paraIso(campo(item, 'data_disponibilizacao', 'dataDisponibilizacao', 'datadisponibilizacao')),
      tipo,
      tipo_descricao: TIPOS[tipo],
      descricao: [campo(item, 'tipoComunicacao', 'tipo_comunicacao'), campo(item, 'tipoDocumento', 'tipo_documento')]
        .filter(Boolean).join(' – ') || 'Publicação no DJEN',
      fonte: 'DJEN',
      grau: null,
      orgao: campo(item, 'nomeOrgao', 'nome_orgao'),
      codigo_tpu: null,
      sessao: tipo === 'resultado_julgamento' ? null : extrairSessao(textoPlano),
      link: campo(item, 'link') ?? (hash ? `https://comunicaapi.pje.jus.br/api/v1/comunicacao/${hash}/certidao` : null),
      trecho: trecho(textoPlano),
    });
  }
  return eventos;
}

// ---------- Combinação ----------

const SITUACAO_POR_TIPO = {
  inclusao_em_pauta: 'incluido_em_pauta',
  pedido_de_inclusao: 'incluido_em_pauta',
  adiamento: 'adiado',
  retirada_de_pauta: 'retirado_de_pauta',
  resultado_julgamento: 'julgado',
};

const ordemDesc = (a, b) => String(b.data ?? '').localeCompare(String(a.data ?? ''));

function montarResposta(cnj, dj, djen, agora = new Date()) {
  const eventos = [...eventosDataJud(dj.hits ?? []), ...eventosDJEN(djen.itens ?? [])].sort(ordemDesc);
  const hoje = agora.toISOString().slice(0, 10);

  const incluido = eventos.some((e) =>
    ['inclusao_em_pauta', 'pedido_de_inclusao', 'adiamento', 'retirada_de_pauta'].includes(e.tipo));

  let situacao;
  if (!dj.ok && !djen.ok) situacao = 'indeterminado';
  else if (!eventos.length) situacao = 'sem_registro_de_pauta';
  else situacao = SITUACAO_POR_TIPO[eventos[0].tipo];

  const comSessao = eventos.filter((e) => e.sessao?.inicio);
  const futuras = comSessao
    .filter((e) => (e.sessao.fim ?? e.sessao.inicio) >= hoje)
    .sort((a, b) => a.sessao.inicio.localeCompare(b.sessao.inicio));
  const proxima = futuras[0] ?? null;
  const ultimaInformada = [...comSessao].sort((a, b) => b.sessao.inicio.localeCompare(a.sessao.inicio))[0] ?? null;

  const avisos = [];
  if (!dj.ok) avisos.push(dj.erro);
  else if (!dj.encontrado) avisos.push('Processo não encontrado no DataJud (pode ser sigiloso ou ainda não ter sido enviado pelo tribunal).');
  if (!djen.ok) avisos.push(djen.erro);
  else if (djen.erro) avisos.push(djen.erro);
  if (djen.truncado && djen.ok) avisos.push(`O DJEN tem ${djen.total} publicações; só as mais recentes foram analisadas.`);

  return {
    numero: cnj.digitos,
    numero_formatado: cnj.formatado,
    tribunal: cnj.sigla,
    incluido_em_pauta: incluido,
    situacao,
    resumo: escreverResumo({ situacao, incluido, eventos, proxima, ultimaInformada }),
    proxima_sessao: proxima ? { ...proxima.sessao, orgao: proxima.orgao, fonte: proxima.fonte } : null,
    ultima_sessao_informada: ultimaInformada
      ? { ...ultimaInformada.sessao, orgao: ultimaInformada.orgao, fonte: ultimaInformada.fonte }
      : null,
    eventos,
    processo: { instancias: resumoInstancias(dj.hits ?? []) },
    fontes: {
      datajud: { ok: dj.ok, encontrado: !!dj.encontrado, erro: dj.erro ?? null },
      djen: { ok: djen.ok, publicacoes: djen.total ?? 0, erro: djen.erro ?? null },
    },
    avisos,
    consultado_em: agora.toISOString(),
  };
}

function escreverResumo({ situacao, incluido, eventos, proxima, ultimaInformada }) {
  if (situacao === 'indeterminado') {
    return 'Não foi possível consultar as fontes agora. Tente novamente em alguns minutos.';
  }
  if (situacao === 'sem_registro_de_pauta') {
    return 'Não há registro de inclusão em pauta no DataJud nem no DJEN.';
  }
  const ult = eventos[0];
  const quando = ult.data ? ` em ${dataBr(ult.data)}` : '';
  const partes = [];
  switch (situacao) {
    case 'incluido_em_pauta':
      partes.push(`Sim. O processo foi incluído em pauta (último registro${quando}, fonte: ${ult.fonte}).`);
      break;
    case 'adiado':
      partes.push(`O processo foi pautado e o julgamento foi adiado${quando} (fonte: ${ult.fonte}).`);
      break;
    case 'retirado_de_pauta':
      partes.push(`O processo foi pautado, mas o último registro é de retirada de pauta${quando} (fonte: ${ult.fonte}).`);
      break;
    case 'julgado':
      partes.push(incluido
        ? `O processo foi pautado e já há publicação de resultado de julgamento${quando}.`
        : `Há publicação de resultado de julgamento${quando}.`);
      break;
  }
  if (proxima) {
    const fim = proxima.sessao.fim ? ` a ${dataBr(proxima.sessao.fim)}` : '';
    const hora = proxima.sessao.hora ? ` às ${proxima.sessao.hora}` : '';
    partes.push(`Próxima sessão informada: ${dataBr(proxima.sessao.inicio)}${fim}${hora}.`);
  } else if (ultimaInformada && situacao !== 'julgado') {
    partes.push(`Última sessão informada: ${dataBr(ultimaInformada.sessao.inicio)}.`);
  }
  return partes.join(' ');
}

// Ponto de entrada usado pela API
async function verificarPauta(numero, opcoes = {}) {
  const cnj = analisar(numero); // lança NumeroInvalidoError se inválido
  const [dj, djen] = await Promise.all([
    consultarDataJud(cnj, opcoes),
    consultarDJEN(cnj, opcoes),
  ]);
  return montarResposta(cnj, dj, djen, opcoes.agora);
}

module.exports = { TIPOS, classificarMovimento, classificarPublicacao, extrairSessao, montarResposta, verificarPauta };
