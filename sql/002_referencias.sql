-- =====================================================================
-- DiliGLA · 002 · tabelas de referência
-- Tudo aqui vem do Plano de Abrangência, Tutela e Fluxo das Carteiras
-- (13/11/2026) e do quadro de classificação estratégica das carteiras.
-- =====================================================================

-- ------------------------------------------------------------ matérias
-- Os apelidos são as grafias já vistas na planilha e no Panorama. A
-- importação normaliza por eles, sem acento e sem caixa.
insert into materias (codigo, nome, apelidos, ordem) values
  ('funafin',      'Funafin',
   array['funafin','funafin doenca grave','funafin dg'], 1),
  ('sassepe_ind',  'Sassepe Indenizatória',
   array['ind','sassepe ind','sassepe indenizatoria','indenizatoria','sassepe'], 2),
  ('sassepe_dup',  'Sassepe Duplicidade',
   array['dup','sassepe dup','sassepe duplicidade','duplicidade'], 3),
  ('irpf',         'Imposto de Renda',
   array['ir','irpf','imposto de renda','isencao irpf','isencao irpf (prec)'], 4),
  ('irpf_dg',      'Imposto de Renda Doença Grave',
   array['irpf doenca grave','irpf doenca','ir doenca grave','doenca grave',
         'imposto de renda doenca grave'], 5),
  ('licenca_premio','Licença Prêmio',
   array['lp','licenca premio','licenca-premio','lp aposentado'], 6),
  ('progressao',   'Progressão',
   array['prog','progressao'], 7),
  ('biblioteca',   'Biblioteca',
   array['bib','biblioteca'], 8),
  ('acao_diversa', 'Ação Diversa',
   array['ad','acao diversa','diversa'], 9)
on conflict (codigo) do update
  set nome = excluded.nome, apelidos = excluded.apelidos, ordem = excluded.ordem;

-- ----------------------------------------------------------- carteiras
-- As quatro primeiras são o quadro de classificação estratégica; as demais
-- saem do fluxo do item 5 do plano.
insert into carteiras (codigo, nome, enquadramento, funcao, ordem) values
  ('conhecimento', 'Conhecimento',
   'Antes da sentença: despacho inicial, contraditório, saneamento e sentença.',
   'Formação do título.', 1),
  ('presenca', 'Presença',
   'Honorários de até R$ 10 mil, independentemente do rito.',
   'Formação de base, reserva de mercado, marca e oportunidades futuras.', 2),
  ('viva', 'Viva',
   'Acima de R$ 10 mil, com perspectiva concreta de retorno rápido.',
   'Sustentação financeira, produtividade, confiança e caixa.', 3),
  ('compromisso', 'Compromisso',
   'Justiça Comum, acima de R$ 10 mil e até R$ 30 mil, com marcha prolongada.',
   'Cumprimento institucional e permanência ao lado do cliente.', 4),
  ('expansao', 'Expansão',
   'Justiça Comum, acima de R$ 30 mil e com potencial de negociação.',
   'Formação de ativos, reinvestimento e crescimento.', 5),
  ('expansao_pos', 'Expansão Pós',
   'Expansão depois da resposta à impugnação, até a expedição da RPV.',
   'Conversão do ativo em requisição.', 6),
  ('vivissima', 'Vivíssima',
   'A partir da RPV expedida com saldo a receber, até o recebimento.',
   'Realização do caixa: alvará, bloqueio, depósito e baixa.', 7),
  ('contramora', 'Contramora',
   'Cedidos sem saldo a receber.',
   'Tratamento próprio, fora das carteiras dos estagiários.', 8)
on conflict (codigo) do update
  set nome = excluded.nome, enquadramento = excluded.enquadramento,
      funcao = excluded.funcao, ordem = excluded.ordem;

-- -------------------------------------------------------------- blocos
-- Item 3.1. A etiqueta de origem fica com o processo mesmo quando ele troca
-- de mão, e é por ela que a devolução ao titular definitivo é feita.
insert into blocos (codigo, nome, origem, natureza, custodiante_apelido, previstos, ordem) values
  ('P1', 'P1 e P4 – Presença em execução',   'Brenda',      'tutelada',  'Pedro Miguel',  90, 1),
  ('PA', 'Aguardando acórdão (após remessa)','Brenda',      'tutelada',  'Pedro Miguel',  18, 2),
  ('P2', 'P2 – Remessa ao tribunal',         'Brenda',      'tutelada',  'Bruna',         33, 3),
  ('P3', 'P3 – ED em 1º grau',               'Brenda',      'tutelada',  'Ana Letícia',   38, 4),
  ('P4', 'P4 – Pós-sentença (validação)',    'Brenda',      'tutelada',  'Ana Letícia',   24, 5),
  ('N1', 'N1 – Sentenças proferidas',        'Ana Letícia', 'tutelada',  'Ana Letícia',   52, 6),
  ('R1', 'R1 – Aguardando remessa TJ/TR',    'Gerlane',     'tutelada',  'Bruna',         21, 7),
  ('R2', 'R2 – Demais atos recursais',       'Gerlane',     'tutelada',  'Pedro Miguel',  15, 8),
  ('R3', 'R3 – Acórdão/ED em 2º grau',       'Gerlane',     'realocada', 'Pedro Miguel', 177, 9),
  ('R4', 'R4 – Validação trânsito/acórdão',  'Gerlane',     'tutelada',  'Ana Letícia',   67, 10),
  ('X1', 'X1 – Reclassificação 1º grau',     'Gerlane',     'tutelada',  'Letícia',       11, 11)
on conflict (codigo) do update
  set nome = excluded.nome, origem = excluded.origem, natureza = excluded.natureza,
      custodiante_apelido = excluded.custodiante_apelido,
      previstos = excluded.previstos, ordem = excluded.ordem;

-- -------------------------------------------------------------- verbos
-- Item 6.2. "Obter" é o único verbo de conclusão; todos os outros são de
-- acompanhamento e nunca são marcados como atingidos.
insert into objetivo_verbos (verbo, tipo) values
  ('obter',       'conclusao'),
  ('conferir',    'acompanhamento'),
  ('validar',     'acompanhamento'),
  ('monitorar',   'acompanhamento'),
  ('conciliar',   'acompanhamento'),
  ('verificar',   'acompanhamento'),
  ('acionar',     'acompanhamento'),
  ('encaminhar',  'acompanhamento'),
  ('identificar', 'acompanhamento'),
  ('aguardar',    'acompanhamento'),
  -- já apareceram nas planilhas e seguem a mesma lógica
  ('acompanhar',  'acompanhamento'),
  ('controlar',   'acompanhamento'),
  ('observar',    'acompanhamento'),
  ('analisar',    'acompanhamento')
on conflict (verbo) do update set tipo = excluded.tipo;

-- ------------------------------------------------------------ gatilhos
-- Item 5. O gatilho é o ato obtido, e não a diligência realizada.
-- `padrao` é aplicado ao texto do andamento já em minúsculas e sem acento,
-- do lado do navegador; nulo significa que só a declaração manual vale.
insert into gatilhos (codigo, ato, sai_de, vai_para, padrao, tipo_movimento,
                      carteira_destino, bloco_destino, regra_responsavel,
                      valor_min, valor_max, exige_valor, ordem) values
  ('despacho_inicial',
   'Despacho inicial, contraditório ou saneamento',
   'Ana – pré-sentença', 'Permanece com Ana (próximo objetivo)',
   null, null, null, null, 'manter', null, null, false, 1),

  ('sentenca',
   'Sentença proferida',
   'Ana – pré-sentença', 'N1 – pós-sentença (custódia Ana)',
   'senten[çc]a|julgo procedente|julgo improcedente|resolucao de merito',
   'sentenca', null, 'N1', 'custodiante_do_bloco', null, null, false, 2),

  ('ed_1g_julgado',
   'ED em 1º grau julgados, com recurso',
   'Ana – P3', 'Bruna – P2 (remessa ao tribunal)',
   'embargos de declaracao.{0,40}(julgad|acolhid|rejeitad|providos)',
   null, null, 'P2', 'custodiante_do_bloco', null, null, false, 3),

  ('remessa_tribunal',
   'Remessa ao tribunal',
   'Bruna – P2/R1', 'Pedro – aguardando acórdão (R3)',
   'remessa (dos |de )?autos|remetidos os autos|remessa ao (tribunal|trf|tj)|subida dos autos',
   null, null, 'R3', 'custodiante_do_bloco', null, null, false, 4),

  ('acordao',
   'Acórdão ou ED em 2º grau julgados',
   'Pedro – R3', 'Ana – R4 (validar trânsito/acórdão)',
   'acordao|julgado o recurso|negado provimento|dado provimento|apelacao julgada',
   'acordao', null, 'R4', 'custodiante_do_bloco', null, null, false, 5),

  ('transito',
   'Trânsito certificado',
   'Ana – R4 / N1', 'Alexa – cálculo e início do cumprimento',
   'transito em julgado|certidao de transito|certificado o transito',
   null, null, null, 'Alexa', null, null, false, 6),

  ('exec_ate_10',
   'Execução protocolada até R$ 10 mil',
   'Alexa', 'Presença (custódia Pedro)',
   null, null, 'presenca', 'P1', 'custodiante_do_bloco', null, 10000, true, 7),

  ('exec_juizado_acima_10',
   'Execução protocolada acima de R$ 10 mil – Juizado',
   'Alexa', 'Bruna – Viva',
   null, null, 'viva', null, 'Bruna', 10000, null, true, 8),

  ('exec_comum_10_30',
   'Execução protocolada – Justiça Comum, R$ 10 a 30 mil',
   'Alexa', 'Bruna – Compromisso',
   null, null, 'compromisso', null, 'Bruna', 10000, 30000, true, 9),

  ('exec_comum_acima_30',
   'Execução protocolada – Justiça Comum, acima de R$ 30 mil',
   'Alexa', 'Bruna – Expansão',
   null, null, 'expansao', null, 'Bruna', 30000, null, true, 10),

  ('resposta_impugnacao',
   'Resposta à impugnação na Expansão',
   'Bruna – Expansão', 'Pedro – Expansão Pós',
   'impugnacao.{0,40}(respondid|apresentad)|resposta a impugnacao',
   null, 'expansao_pos', null, 'Pedro Miguel', null, null, false, 11),

  ('rpv_expedida',
   'RPV expedida com saldo a receber',
   'Presença, Viva, Compromisso ou Expansão Pós', 'Letícia – Vivíssima',
   'expedicao de rpv|rpv expedida|requisicao de pequeno valor|expedido.{0,20}rpv|precatorio expedido',
   null, 'vivissima', null, 'Letícia', null, null, false, 12),

  ('cessao_sem_saldo',
   'Cessão sem saldo a receber',
   'Qualquer carteira de execução', 'Contramora',
   null, null, 'contramora', null, 'Letícia', null, null, false, 13),

  ('alvara_recebido',
   'Alvará expedido e recebimento confirmado',
   'Letícia – Vivíssima', 'Conciliação e baixa',
   null, null, null, null, 'manter', null, null, false, 14),

  ('recomposicao',
   'Recomposição da equipe',
   'Custodiante', 'Titular definitivo do bloco',
   null, null, null, null, 'manter', null, null, false, 15)
on conflict (codigo) do update
  set ato = excluded.ato, sai_de = excluded.sai_de, vai_para = excluded.vai_para,
      padrao = excluded.padrao, tipo_movimento = excluded.tipo_movimento,
      carteira_destino = excluded.carteira_destino, bloco_destino = excluded.bloco_destino,
      regra_responsavel = excluded.regra_responsavel,
      valor_min = excluded.valor_min, valor_max = excluded.valor_max,
      exige_valor = excluded.exige_valor, ordem = excluded.ordem;
