'use strict';
// O tipo do objetivo decide o que entra no percentual do relatório: node --test test/objetivos.test.js
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// js/sincronia.js é um script de navegador: roda aqui com um window de mentira
const contexto = { window: {} };
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../js/sincronia.js'), 'utf8'), contexto);
const DGS = contexto.window.DGS;
DGS.ref.verbos = ['conferir', 'validar', 'monitorar', 'conciliar', 'verificar', 'acionar',
                  'encaminhar', 'identificar', 'aguardar']
  .map((verbo) => ({ verbo, tipo: 'acompanhamento' }))
  .concat({ verbo: 'obter', tipo: 'conclusao' });

test('"Conferir" que manda obter o ato conta como conclusão', () => {
  for (const o of ['Conferir intimação e obtê-la se ausente',
                   'Conferir intimação da homologação e obtê-la',
                   'Conferir prazo e obter intimação ou certificação',
                   'Conferir publicação/intimação e obter se ausente',
                   'Conferir decurso e obter o próximo ato']) {
    assert.equal(DGS.tipoDoObjetivo(o), 'conclusao', o);
  }
});

test('o resto continua de acompanhamento', () => {
  for (const o of ['Conferir arquivamento e validar ato residual',
                   'Conferir intimação da decisão monocrática',
                   'Conferir intimação da RPV e fixar vencimento',
                   'Monitorar pagamento da RPV e obter determinação de alvará',
                   'Monitorar prazo de impugnação',
                   'Validar trânsito/acórdão e encaminhar a Alexa após certificação']) {
    assert.equal(DGS.tipoDoObjetivo(o), 'acompanhamento', o);
  }
});

test('"Obter" segue sendo conclusão', () => {
  assert.equal(DGS.tipoDoObjetivo('Obter homologação dos cálculos'), 'conclusao');
});
