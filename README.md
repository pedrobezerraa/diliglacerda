# DiliGLA

Acompanhamento de diligências do Setor de Diligências — Guimarães & Lacerda
Advogados. Lê as movimentações do PJe do TJPE em 1º e 2º graus, registra os
objetivos, controla a passagem de processos entre carteiras e gera os relatórios
semanais.

Implementa o *Plano de Abrangência, Tutela e Fluxo das Carteiras* (13/11/2026).

## Como está montado

```
index.html        a aplicação inteira: grade, importação, relatórios
js/config.js      endereço e chave pública do Supabase
js/supa.js        conversa com o Supabase (REST puro, sem SDK) e fila de escrita
js/sincronia.js   ponte entre a tela e o banco; reconhecimento dos gatilhos
vendor/           SheetJS, que vai junto em vez de vir de CDN
api/processo.js   função que consulta o MNI do PJe (o navegador não pode, por CORS)
api/config.js     devolve URL e chave quando elas vêm de variável de ambiente
api/pauta.js      o processo entrou em pauta? Cruza DataJud e DJEN (lógica em lib/pauta/)
lib/pauta/        validação do número CNJ, clientes do DataJud e do DJEN, classificação
test/             testes da pauta com respostas simuladas: node --test test/pauta.test.js
sql/              as migrações, na ordem
```

Não há build nem dependência de npm: o que o navegador baixa é o que roda.

## Pauta

A tela **Pauta** (ícone de calendário no trilho) responde se o processo entrou em
pauta de julgamento. A função `api/pauta.js` cruza duas fontes públicas do CNJ:

- **DataJud**: movimentos como "Inclusão em pauta", "Retirada de pauta" e
  "Adiamento". Os tribunais mandam esses dados ao CNJ de tempos em tempos, então
  a inclusão pode levar alguns dias para aparecer. A API também limita o ritmo
  (HTTP 429); a função tenta de novo uma vez e, se não der, segue só com o DJEN.
- **DJEN**: publicações de pauta, com a data da sessão, e de resultado de
  julgamento. Costuma ser mais rápido que o DataJud.

O resultado de cada processo fica na tabela `pautas` (`sql/006_pauta.sql`): a
equipe inteira enxerga, e a carteira mostra "pauta 25/11" na linha do processo.

As funções rodam em **São Paulo** (`"regions": ["gru1"]` no `vercel.json`): o DJEN
costuma recusar (HTTP 403) quem vem de fora do Brasil.

A chave do DataJud é pública e já vem no código. Se o CNJ trocá-la e a API
passar a responder 401 ou 403, pegue a atual em
<https://datajud-wiki.cnj.jus.br/api-publica/acesso> e defina a variável
`DATAJUD_API_KEY` na Vercel.

O resultado é informativo: a classificação lê palavras como "pauta", "sessão",
"retirado" e "adiado", e processos sigilosos não aparecem nas bases públicas.
Confirme sempre no sistema do tribunal.

## Publicar na Vercel

Conecte este repositório em **Add New → Project**. A Vercel reconhece sozinha:
não há framework, a raiz é a raiz do repositório e `api/` vira função
serverless. Não é preciso configurar nada.

As duas variáveis abaixo são **opcionais**. Sem elas valem os valores de
`js/config.js`; com elas, `api/config.js` tem preferência e os valores saem do
repositório:

| Variável | Para que serve |
| --- | --- |
| `SUPABASE_URL` | endereço do projeto Supabase |
| `SUPABASE_ANON_KEY` | chave publicável do mesmo projeto |

A chave publicável é feita para ficar no navegador e não abre nada sozinha: quem
decide o que cada pessoa vê e altera são as políticas de RLS no banco. A chave
`service_role` **não** entra aqui nem em lugar nenhum do código.

## Banco

Supabase, PostgreSQL. As migrações em `sql/` são aplicadas em ordem, uma vez.
Depois disso o banco se sustenta sozinho.

Papéis, que são próprios do DiliGLA e não se confundem com os do Panorama:

- **gestora** — enxerga e altera tudo, define papéis, importa a planilha inteira
  e pode decidir uma passagem travada no lugar de quem recebe;
- **diligente** — enxerga a operação inteira, altera só a própria carteira;
- **leitura** — só enxerga.

Quem cria conta entra como leitura. **A primeira conta criada no sistema vira
gestora** — crie a sua antes de passar o endereço adiante.

## As duas regras que o sistema existe para sustentar

**O verbo do objetivo decide o que ele é.** "Obter" depende de um ato do juízo ou
do tribunal e conta no percentual de atingimento. "Conferir", "Validar",
"Monitorar", "Conciliar", "Verificar", "Acionar", "Encaminhar", "Identificar" e
"Aguardar" são de acompanhamento: ali o registro significa providência tomada, e
eles ficam fora da conta. A lista mora na tabela `objetivo_verbos`, e não no
código, para que a gestora possa acrescentar um verbo sem esperar deploy.

Uma exceção: "Conferir" que também manda obter o ato ("Conferir intimação e
obtê-la se ausente", "Conferir prazo e obter intimação") conta como conclusão.
"Monitorar ... e obter" e "Conferir arquivamento e validar ato residual" seguem
como acompanhamento.

**O gatilho é o ato obtido, não a diligência realizada.** Os quinze gatilhos do
item 5 do plano estão em `gatilhos`. O sistema lê o texto do andamento,
reconhece o ato e sugere; quem decide é a pessoa; e nada se move sem o aceite de
quem recebe.

## Várias pessoas ao mesmo tempo

Pode. O setor inteiro pode estar dentro ao mesmo tempo, e o que cada um altera
é gravado.

Cada alteração sobe como um `PATCH` de **uma linha só e só dos campos que
mudaram**, comparados com o espelho do que o banco tinha quando a página
abriu. Daí:

- duas pessoas em processos diferentes nunca se encontram;
- duas pessoas em campos diferentes do mesmo processo também não — uma mexe na
  observação, a outra na fase, e as duas coisas ficam;
- no mesmo campo do mesmo processo, quem gravar por último vence. Não há
  travamento de linha, e não deveria haver: a carteira é de alguém.

Quem pode alterar o quê é decidido pelo RLS no banco, e não pela tela.

**A tela não se atualiza sozinha.** Ela é uma fotografia do momento em que a
página abriu. De minuto em minuto, e toda vez que você volta para a aba, a
DiliGLA pergunta ao banco se alguém mexeu depois e, se mexeu, oferece
recarregar numa faixa azul no alto. Ela não recarrega por conta própria: isso
jogaria fora o que está na tela no meio de uma digitação. Enquanto houver
alteração sua na fila de envio, o aviso não aparece e a atualização fica
bloqueada — primeiro sobe o que é seu.

## O que a planilha semanal manda, e o que ela não encosta

A importação atualiza responsável, grupo, matéria, carteira, bloco, fase, valor,
prioridade e objetivo. Não toca em observação, objetivo atingido, condição,
providências nem no histórico de andamentos — esses são produzidos aqui dentro e
sobrevivem a toda importação seguinte. Cada sobrescrita vira linha em
`historico`.
