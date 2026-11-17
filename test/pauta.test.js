'use strict';
// Testes da consulta de pauta, com respostas simuladas do DataJud e do DJEN: node --test test/
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { analisar, NumeroInvalidoError } = require('../lib/pauta/cnj');
const { verificarPauta, extrairSessao, classificarMovimento, classificarPublicacao } = require('../lib/pauta/pauta');

// Gera um número CNJ válido do TJPE (J=8, TR=17)
function numeroValido(seq = '0012345', ano = '2024', origem = '0000') {
  const base = BigInt(`${seq}${ano}817${origem}00`);
  const dv = String(98n - (base % 97n)).padStart(2, '0');
  return `${seq}-${dv}.${ano}.8.17.${origem}`;
}
const NUM = numeroValido();

function resposta(status, corpo) {
  return { ok: status >= 200 && status < 300, status, json: async () => corpo };
}

// fetch simulado: roteia por URL
function fetchFalso({ datajud, djen }) {
  const chamadas = [];
  const fn = async (url, init) => {
    chamadas.push({ url, init });
    if (url.includes('datajud')) return typeof datajud === 'function' ? datajud(url, init) : datajud;
    if (url.includes('comunicaapi')) return typeof djen === 'function' ? djen(url, init) : djen;
    throw new Error('URL inesperada ' + url);
  };
  fn.chamadas = chamadas;
  return fn;
}

const hitG2 = (movimentos) => ({
  hits: { hits: [{ _source: {
    numeroProcesso: '', grau: 'G2', classe: { nome: 'Apelação Cível' },
    orgaoJulgador: { nome: '3ª Câmara Cível' }, dataHoraUltimaAtualizacao: '2026-11-10T10:00:00.000Z',
    movimentos,
  } }] },
});

const AGORA = new Date('2026-11-16T12:00:00Z');

test('CNJ: valida e formata', () => {
  const c = analisar(NUM.replace(/\D/g, ''));
  assert.equal(c.formatado, NUM);
  assert.equal(c.alias, 'tjpe');
  assert.equal(c.sigla, 'TJPE');
  assert.throws(() => analisar('123'), NumeroInvalidoError);
  const errado = NUM.replace(/-(\d)/, (m, d) => `-${(Number(d) + 1) % 10}`);
  assert.throws(() => analisar(errado), /verificador/);
});

test('CNJ: alias de outros tribunais', () => {
  const gerar = (seq, ano, jtr, origem) => {
    const dv = String(98n - (BigInt(`${seq}${ano}${jtr}${origem}00`) % 97n)).padStart(2, '0');
    return `${seq}${dv}${ano}${jtr}${origem}`;
  };
  assert.equal(analisar(gerar('0001111', '2023', '405', '8000')).alias, 'trf5');
  assert.equal(analisar(gerar('0001111', '2023', '506', '0001')).alias, 'trt6');
  assert.equal(analisar(gerar('0001111', '2023', '826', '0100')).alias, 'tjsp');
});

test('classifica movimentos do DataJud pelo nome', () => {
  assert.equal(classificarMovimento({ nome: 'Inclusão em pauta' }), 'inclusao_em_pauta');
  assert.equal(classificarMovimento({ nome: 'Incluído em pauta para 20/11/2026' }), 'inclusao_em_pauta');
  assert.equal(classificarMovimento({ nome: 'Pedido de Inclusão em Pauta de Sessão Virtual' }), 'pedido_de_inclusao');
  assert.equal(classificarMovimento({ nome: 'Retirada de pauta' }), 'retirada_de_pauta');
  assert.equal(classificarMovimento({ nome: 'Adiado o julgamento' }), 'adiamento');
  assert.equal(classificarMovimento({ nome: 'Conclusão', codigo: 51 }), null);
  assert.equal(classificarMovimento({ nome: 'X', codigo: 1204 }), 'inclusao_em_pauta');
});

test('classifica publicações do DJEN', () => {
  assert.equal(classificarPublicacao({ tipoDocumento: 'Pauta de Julgamento', texto: '...' }), 'inclusao_em_pauta');
  assert.equal(classificarPublicacao({ texto: 'Processo incluído na <b>Sessão Virtual</b> de 01/12/2026' }), 'inclusao_em_pauta');
  assert.equal(classificarPublicacao({ texto: 'Fica RETIRADO DE PAUTA o processo...' }), 'retirada_de_pauta');
  assert.equal(classificarPublicacao({ texto: 'ACÓRDÃO. Vistos... EMENTA: apelação' }), 'resultado_julgamento');
  assert.equal(classificarPublicacao({ texto: 'Intimação para contrarrazões no prazo de 15 dias' }), null);
});

test('extrai data, período e hora da sessão', () => {
  assert.deepEqual(
    extrairSessao('Sessão Ordinária do dia 25/11/2026, às 9h00, na sala...'),
    { inicio: '2026-11-25', fim: null, hora: '09:00' });
  assert.deepEqual(
    extrairSessao('Pauta da Sessão Virtual de 01/12/2026 a 09/12/2026.'),
    { inicio: '2026-12-01', fim: '2026-12-09', hora: null });
  assert.deepEqual(
    extrairSessao('sessão de julgamento a realizar-se em 3 de dezembro de 2026, às 14:30'),
    { inicio: '2026-12-03', fim: null, hora: '14:30' });
  assert.equal(extrairSessao('sem datas aqui'), null);
});

test('processo pautado: DataJud + DJEN', async () => {
  const fetchFn = fetchFalso({
    datajud: resposta(200, hitG2([
      { codigo: 51, nome: 'Conclusão', dataHora: '2026-10-01T10:00:00.000Z' },
      { codigo: 1204, nome: 'Inclusão em pauta', dataHora: '2026-11-05T14:00:00.000Z',
        complementosTabelados: [{ nome: 'sessão virtual', descricao: 'tipo de sessão' }] },
    ])),
    djen: resposta(200, { status: 'success', count: 2, items: [
      { id: 1, data_disponibilizacao: '2026-11-06', tipoComunicacao: 'Intimação', tipoDocumento: 'Pauta de Julgamento',
        nomeOrgao: '3ª Câmara Cível', texto: '<p>PAUTA DA SESSÃO VIRTUAL de 25/11/2026 a 02/12/2026</p>', hash: 'abc' },
      { id: 2, data_disponibilizacao: '2026-09-01', tipoComunicacao: 'Intimação', texto: 'Intimação para contrarrazões' },
    ] }),
  });

  const r = await verificarPauta(NUM, { fetchFn, agora: AGORA, pausaMs: 0 });
  assert.equal(r.incluido_em_pauta, true);
  assert.equal(r.situacao, 'incluido_em_pauta');
  assert.equal(r.eventos.length, 2);
  assert.equal(r.eventos[0].fonte, 'DJEN'); // mais recente primeiro
  assert.deepEqual(r.proxima_sessao.inicio, '2026-11-25');
  assert.match(r.resumo, /^Sim\./);
  assert.match(r.resumo, /25\/11\/2026 a 02\/12\/2026/);
  assert.equal(r.fontes.djen.publicacoes, 2);
  assert.equal(r.processo.instancias[0].ultimo_movimento.nome, 'Inclusão em pauta');

  // conferindo as requisições
  const dj = fetchFn.chamadas.find((c) => c.url.includes('datajud'));
  assert.match(dj.url, /api_publica_tjpe\/_search$/);
  assert.match(dj.init.headers.Authorization, /^APIKey /);
  assert.equal(JSON.parse(dj.init.body).query.match.numeroProcesso, NUM.replace(/\D/g, ''));
  const dn = fetchFn.chamadas.find((c) => c.url.includes('comunicaapi'));
  assert.match(dn.url, new RegExp(`numeroProcesso=${NUM.replace(/\D/g, '')}`));
});

test('sem pauta', async () => {
  const fetchFn = fetchFalso({
    datajud: resposta(200, hitG2([{ nome: 'Distribuído por sorteio', dataHora: '2026-01-01T00:00:00Z' }])),
    djen: resposta(200, { count: 0, items: [] }),
  });
  const r = await verificarPauta(NUM, { fetchFn, agora: AGORA, pausaMs: 0 });
  assert.equal(r.incluido_em_pauta, false);
  assert.equal(r.situacao, 'sem_registro_de_pauta');
  assert.deepEqual(r.avisos, []);
});

test('retirada depois da inclusão', async () => {
  const fetchFn = fetchFalso({
    datajud: resposta(200, hitG2([
      { nome: 'Inclusão em pauta', dataHora: '2026-10-01T10:00:00Z' },
      { nome: 'Retirada de pauta', dataHora: '2026-10-20T10:00:00Z' },
    ])),
    djen: resposta(200, { count: 0, items: [] }),
  });
  const r = await verificarPauta(NUM, { fetchFn, agora: AGORA, pausaMs: 0 });
  assert.equal(r.incluido_em_pauta, true);
  assert.equal(r.situacao, 'retirado_de_pauta');
});

test('DJEN bloqueado (403) ainda responde com o DataJud', async () => {
  const fetchFn = fetchFalso({
    datajud: resposta(200, hitG2([{ nome: 'Inclusão em pauta', dataHora: '2026-11-01T10:00:00Z' }])),
    djen: resposta(403, {}),
  });
  const r = await verificarPauta(NUM, { fetchFn, agora: AGORA, pausaMs: 0 });
  assert.equal(r.situacao, 'incluido_em_pauta');
  assert.equal(r.fontes.djen.ok, false);
  assert.match(r.avisos.join(' '), /fora do Brasil/);
});

test('as duas fontes falham -> indeterminado', async () => {
  const fetchFn = fetchFalso({
    datajud: async () => { throw new Error('timeout'); },
    djen: resposta(500, {}),
  });
  const r = await verificarPauta(NUM, { fetchFn, agora: AGORA, pausaMs: 0 });
  assert.equal(r.situacao, 'indeterminado');
  assert.equal(r.avisos.length, 2);
});

test('DJEN paginado', async () => {
  const pagina = (n, qtd) => Array.from({ length: qtd }, (_, i) => ({ id: n * 100 + i, data_disponibilizacao: '2026-01-01', texto: 'x' }));
  const fetchFn = fetchFalso({
    datajud: resposta(200, { hits: { hits: [] } }),
    djen: (url) => {
      const p = Number(new URL(url).searchParams.get('pagina'));
      return resposta(200, { count: 70, items: p === 1 ? pagina(1, 50) : pagina(2, 20) });
    },
  });
  const r = await verificarPauta(NUM, { fetchFn, agora: AGORA, pausaMs: 0 });
  assert.equal(fetchFn.chamadas.filter((c) => c.url.includes('comunicaapi')).length, 2);
  assert.equal(r.fontes.djen.publicacoes, 70);
  assert.match(r.avisos.join(' '), /não encontrado no DataJud/);
});

test('DataJud com limite (429) tenta de novo antes de desistir', async () => {
  let tentativas = 0;
  const fetchFn = fetchFalso({
    datajud: () => (++tentativas < 2
      ? resposta(429, {})
      : resposta(200, hitG2([{ nome: 'Inclusão em pauta', dataHora: '2026-11-01T10:00:00Z' }]))),
    djen: resposta(200, { count: 0, items: [] }),
  });
  const r = await verificarPauta(NUM, { fetchFn, agora: AGORA, pausaMs: 0, pausasRepeticao: [0, 0] });
  assert.equal(tentativas, 2);
  assert.equal(r.situacao, 'incluido_em_pauta');
  assert.equal(r.fontes.datajud.ok, true);
});

test('DataJud com limite persistente vira aviso, não erro', async () => {
  const fetchFn = fetchFalso({ datajud: resposta(429, {}), djen: resposta(200, { count: 0, items: [] }) });
  const r = await verificarPauta(NUM, { fetchFn, agora: AGORA, pausaMs: 0, pausasRepeticao: [0, 0] });
  assert.equal(r.fontes.datajud.ok, false);
  assert.match(r.avisos.join(' '), /429/);
  assert.equal(r.situacao, 'sem_registro_de_pauta');
});

// Casos tirados de publicações reais do TJPE que a primeira versão classificava errado
test('1º grau e Vice-Presidência não viram pauta nem julgamento', () => {
  const vara = 'Vara da Fazenda Pública da Comarca de Paulista';
  assert.equal(classificarPublicacao({ nomeOrgao: vara,
    texto: 'DESPACHO. O recurso foi desprovido pela 3ª Câmara de Direito Público do TJPE, cujo v. acórdão transitou em julgado. Intimem-se.' }), null);
  assert.equal(classificarPublicacao({ nomeOrgao: vara,
    texto: 'SENTENÇA. Vistos etc. Conforme a EMENTA: tributário... acordam os desembargadores... JULGO PROCEDENTE.' }), null);
  assert.equal(classificarPublicacao({ nomeOrgao: '5º Juizado Especial da Fazenda Pública da Capital',
    texto: 'Fica designada audiência; pauta de audiências do dia 10/12/2026.' }), null);
  assert.equal(classificarPublicacao({ nomeOrgao: 'Gabinete da 2ª Vice Presidência Segundo Grau',
    texto: 'RECURSO EXTRAORDINÁRIO. DECISÃO. Recurso interposto contra acórdão da 2ª Câmara de Direito Público.' }), null);
});

test('acórdão da câmara e intimação do acórdão viram julgamento', () => {
  const camara = '1ª Câmara de Direito Público - 1º Gabinete';
  assert.equal(classificarPublicacao({ nomeOrgao: camara,
    texto: 'APELANTE: ESTADO. INTIMAÇÃO De ordem do Relator, ficam as partes intimadas do ACÓRDÃO/DECISÃO ID nº 68441982.' }), 'resultado_julgamento');
  assert.equal(classificarPublicacao({ nomeOrgao: 'Gabinete do Des. José Ivo de Paula Guimarães',
    texto: 'Apelação Cível nº 0017959. Apelantes: Fulano. EMENTA: DIREITO ADMINISTRATIVO. Apelação provida.' }), 'resultado_julgamento');
  // decisão monocrática que só cita "acórdão" no meio não é julgamento
  assert.equal(classificarPublicacao({ nomeOrgao: camara,
    texto: 'DESPACHO Admito o Reexame Necessário. Recebo o recurso estatal no duplo efeito. Colha-se o opinativo.' }), null);
});

test('a mesma publicação para vários intimados conta uma vez só', async () => {
  const pub = { data_disponibilizacao: '2026-10-30', nomeOrgao: '1ª Câmara de Direito Público',
                texto: 'Ficam as partes intimadas do ACÓRDÃO ID nº 1.' };
  const fetchFn = fetchFalso({
    datajud: resposta(200, { hits: { hits: [] } }),
    djen: resposta(200, { count: 3, items: [{ ...pub, id: 1 }, { ...pub, id: 2 }, { ...pub, id: 3 }] }),
  });
  const r = await verificarPauta(NUM, { fetchFn, agora: AGORA, pausaMs: 0 });
  assert.equal(r.eventos.length, 1);
  assert.equal(r.situacao, 'julgado');
});

test('movimento de pauta no 1º grau do DataJud é ignorado', async () => {
  const fetchFn = fetchFalso({
    datajud: resposta(200, { hits: { hits: [{ _source: { grau: 'G1', movimentos: [
      { nome: 'Inclusão em pauta', dataHora: '2026-11-01T10:00:00Z' }] } }] } }),
    djen: resposta(200, { count: 0, items: [] }),
  });
  const r = await verificarPauta(NUM, { fetchFn, agora: AGORA, pausaMs: 0 });
  assert.equal(r.situacao, 'sem_registro_de_pauta');
});
