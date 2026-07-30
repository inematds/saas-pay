// Página de preços simples usando "Link de Pagamento" do Asaas (caminho A da
// seção 4 do README) — zero backend pra cobrar, só um <a href> pro link fixo
// que você cria no painel Asaas por plano.
export type Plano = {
  id: string;
  nome: string;
  preco: string;
  precoDe?: string; // valor cheio riscado, se estiver em promoção
  periodo: string;
  url: string; // link de pagamento do painel Asaas: https://www.asaas.com/c/XXXX
  badge?: string;
  destaque?: string;
  beneficios: string[];
};

const PLANOS: Plano[] = [
  {
    id: 'mensal',
    nome: 'Mensal',
    preco: 'R$ 42',
    periodo: '/mês',
    url: 'https://www.asaas.com/c/SEU_LINK_MENSAL',
    beneficios: ['Acesso completo', 'Suporte da comunidade', 'Cancele quando quiser'],
  },
  {
    id: 'anual',
    nome: 'Anual',
    preco: 'R$ 327',
    periodo: '/ano',
    url: 'https://www.asaas.com/c/SEU_LINK_ANUAL',
    badge: 'Melhor oferta',
    destaque: 'Economize R$ 160 no ano',
    beneficios: ['Acesso completo', 'Suporte da comunidade', 'Valor travado pelo ano todo'],
  },
];

export default function PricingPage() {
  return (
    <main>
      <h1>Assine e destrave tudo — acesso na hora.</h1>
      <p>Pague pelo Asaas (PIX, cartão ou boleto) e seu acesso é liberado automaticamente.</p>

      <section style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 18 }}>
        {PLANOS.map((p) => (
          <div key={p.id}>
            {p.badge ? <span>{p.badge}</span> : null}
            <h2>{p.nome}</h2>
            <p>
              {p.precoDe ? <s>{p.precoDe}</s> : null}
              {p.preco}
              <span>{p.periodo}</span>
            </p>
            {p.destaque ? <p>{p.destaque}</p> : null}
            <ul>
              {p.beneficios.map((b) => (
                <li key={b}>{b}</li>
              ))}
            </ul>
            {/* dado de cartão nunca passa pelo seu servidor — o Asaas hospeda o checkout */}
            <a href={p.url}>Assinar {p.nome.toLowerCase()}</a>
          </div>
        ))}
      </section>
    </main>
  );
}
