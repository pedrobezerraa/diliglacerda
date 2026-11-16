'use strict';
// Utilitários para o número único de processo (Resolução CNJ 65/2008)
// Formato: NNNNNNN-DD.AAAA.J.TR.OOOO

const UF_POR_TR = {
  1: 'ac', 2: 'al', 3: 'ap', 4: 'am', 5: 'ba', 6: 'ce', 7: 'dft', 8: 'es', 9: 'go',
  10: 'ma', 11: 'mt', 12: 'ms', 13: 'mg', 14: 'pa', 15: 'pb', 16: 'pr', 17: 'pe',
  18: 'pi', 19: 'rj', 20: 'rn', 21: 'rs', 22: 'ro', 23: 'rr', 24: 'sc', 25: 'se',
  26: 'sp', 27: 'to',
};

const ESPECIAIS = {
  '3.00': 'stj', '5.00': 'tst', '6.00': 'tse', '7.00': 'stm',
  '9.13': 'tjmmg', '9.21': 'tjmrs', '9.26': 'tjmsp',
};

class NumeroInvalidoError extends Error {}

function normalizar(numero) {
  const digitos = String(numero ?? '').replace(/\D/g, '');
  if (!/^\d{20}$/.test(digitos)) {
    throw new NumeroInvalidoError(
      'Número inválido. Use o formato NNNNNNN-DD.AAAA.J.TR.OOOO (20 dígitos).'
    );
  }
  return digitos;
}

function formatar(digitos) {
  return `${digitos.slice(0, 7)}-${digitos.slice(7, 9)}.${digitos.slice(9, 13)}.` +
    `${digitos.slice(13, 14)}.${digitos.slice(14, 16)}.${digitos.slice(16)}`;
}

function partes(digitos) {
  return {
    sequencial: digitos.slice(0, 7),
    dv: digitos.slice(7, 9),
    ano: digitos.slice(9, 13),
    justica: Number(digitos.slice(13, 14)),
    tribunal: Number(digitos.slice(14, 16)),
    origem: digitos.slice(16),
  };
}

// Dígito verificador: módulo 97 (ISO 7064), como define a Res. CNJ 65/2008
function dvValido(digitos) {
  const p = partes(digitos);
  const n = BigInt(p.sequencial + p.ano + p.justica + String(p.tribunal).padStart(2, '0') + p.origem + p.dv);
  return n % 97n === 1n;
}

// Alias do tribunal no DataJud (ex.: "tjpe" -> api_publica_tjpe)
function aliasDataJud(digitos) {
  const { justica, tribunal } = partes(digitos);
  const chave = `${justica}.${String(tribunal).padStart(2, '0')}`;
  if (ESPECIAIS[chave]) return ESPECIAIS[chave];
  if (justica === 4 && tribunal >= 1 && tribunal <= 6) return `trf${tribunal}`;
  if (justica === 5 && tribunal >= 1 && tribunal <= 24) return `trt${tribunal}`;
  const uf = UF_POR_TR[tribunal];
  if (uf && justica === 8) return `tj${uf}`;
  if (uf && justica === 6) return `tre-${uf}`;
  return null;
}

function siglaTribunal(digitos) {
  const alias = aliasDataJud(digitos);
  return alias ? alias.toUpperCase() : null;
}

function analisar(numero) {
  const digitos = normalizar(numero);
  if (!dvValido(digitos)) {
    throw new NumeroInvalidoError('Dígito verificador inválido: confira o número do processo.');
  }
  return {
    digitos,
    formatado: formatar(digitos),
    alias: aliasDataJud(digitos),
    sigla: siglaTribunal(digitos),
  };
}

module.exports = { NumeroInvalidoError, normalizar, formatar, partes, dvValido, aliasDataJud, siglaTribunal, analisar };
