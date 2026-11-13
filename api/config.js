// Entrega ao navegador o endereço e a chave pública do Supabase.
//
// A chave é a publishable/anon: ela é feita para ficar no navegador e não abre
// nada sozinha — quem decide o que cada pessoa vê e altera são as políticas do
// banco. Ela mora aqui, e não dentro do HTML, só para que trocar de projeto
// Supabase seja mexer numa variável da Vercel em vez de refazer um deploy.
module.exports = (req, res) => {
  const url = process.env.SUPABASE_URL;
  const chave = process.env.SUPABASE_ANON_KEY;
  if (!url || !chave) {
    res.statusCode = 404;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    return res.end(JSON.stringify({ erro: "sem variáveis de ambiente; valem as de js/config.js" }));
  }
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify({ url, chave }));
};
