// Endereço e chave pública do Supabase.
//
// A chave abaixo é a publishable/anon: ela é feita para ficar no navegador e
// não dá acesso a nada por si — quem decide o que cada pessoa enxerga e
// altera é o RLS no banco, com base em quem está logado. Trocar esta chave
// não protege nada; o que protege são as políticas.
//
// A Vercel pode sobrescrever os dois valores em tempo de execução: se existir
// a função /api/config, ela tem preferência, e aí as variáveis ficam no painel
// da Vercel em vez de ficarem no repositório.
window.DG_CONFIG = {
  url: "https://szmfjdecqkdsjkihmcgi.supabase.co",
  chave: "sb_publishable_h_F-OFZD2jb5-CdgCrp4PA_nJMZwhyH",
};
