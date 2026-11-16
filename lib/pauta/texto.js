'use strict';
// Funções de texto compartilhadas

function semAcento(s) {
  return String(s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
}

function semHtml(s) {
  return String(s ?? '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|li)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n')
    .trim();
}

// Converte datas do DataJud/DJEN para ISO (AAAA-MM-DD ou data-hora ISO)
function paraIso(valor) {
  if (!valor) return null;
  const s = String(valor).trim();
  let m = s.match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/); // 20240510142200
  if (m) return `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}`;
  m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})/); // 10/05/2024
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  m = s.match(/^\d{4}-\d{2}-\d{2}/);
  if (m) return s;
  return null;
}

function dataBr(iso) {
  if (!iso) return null;
  const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : null;
}

function trecho(texto, max = 400) {
  const t = String(texto ?? '').replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

module.exports = { semAcento, semHtml, paraIso, dataBr, trecho };
