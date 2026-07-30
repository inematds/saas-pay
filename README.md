# saas-pay

Kit de referência **copiar-e-colar** para montar o pagamento de um SaaS/comunidade
em Next.js (App Router) com **Asaas** (PIX, cartão de crédito à vista ou parcelado,
boleto) + liberação de acesso automática, e **login sem senha via magic link**
(Supabase Auth). É a extração documentada de como isso foi implementado em produção
nos projetos INEMA (`pay.inema.pro`, `inema.pro`, `inemaonline`) — sem nenhum dado
real de conta, chave ou domínio.

## 📖 Guia de uso

Guia completo (landing + passo a passo): **https://inematds.github.io/saas-pay/guia/**

Não é uma lib instalável (`npm install`) — é um **guia + código de exemplo** pra você
adaptar e colar no seu projeto. Tudo em `examples/` é TypeScript funcional, só trocando
nomes de tabela/domínio pelos seus.

## Sumário

1. [Visão geral da arquitetura](#1-visão-geral-da-arquitetura)
2. [Asaas — conceitos](#2-asaas--conceitos)
3. [Cobrar: PIX, cartão e parcelamento](#3-cobrar-pix-cartão-e-parcelamento)
4. [Duas formas de vender: Link de Pagamento vs API](#4-duas-formas-de-vender-link-de-pagamento-vs-api)
5. [Webhook: liberar o acesso automaticamente](#5-webhook-liberar-o-acesso-automaticamente)
6. [Cálculo de vencimento / renovação](#6-cálculo-de-vencimento--renovação)
7. [Login sem senha: Magic Link (Supabase)](#7-login-sem-senha-magic-link-supabase)
8. [Setup do zero (checklist)](#8-setup-do-zero-checklist)
9. [Variáveis de ambiente](#9-variáveis-de-ambiente)
10. [Segurança](#10-segurança)
11. [Arquivos deste repo](#11-arquivos-deste-repo)

---

## 1. Visão geral da arquitetura

```
                      ┌────────────────────┐
  usuário paga  ───▶  │  Asaas (gateway BR) │  hospeda o checkout,
  (PIX/cartão/boleto) │                     │  nunca vemos dado de cartão
                      └─────────┬───────────┘
                                │ webhook (POST) quando o status muda
                                ▼
                      ┌────────────────────┐
                      │  /api/asaas/webhook │  valida token, calcula
                      │  (sua rota Next.js) │  vencimento, libera acesso
                      └─────────┬───────────┘
                                ▼
                      ┌────────────────────┐
                      │  seu banco (Supabase │  pessoa + vencimento +
                      │  /Postgres/D1/...)   │  histórico de pagamentos
                      └─────────┬───────────┘
                                ▼
                      ┌────────────────────┐
                      │  email de acesso /   │  liberação automática:
                      │  magic link de login  │  sem senha, sem suporte manual
                      └────────────────────┘
```

Peças que se repetem em qualquer SaaS que cobra com Asaas:

- **Customer** — quem paga (nome, email, CPF/CNPJ).
- **Payment (cobrança)** — valor + vencimento + método, ligado a um customer. Gera
  `invoiceUrl` (a página de pagamento hospedada).
- **Webhook** — o Asaas chama uma URL sua a cada mudança de status de pagamento.
- **Assinante** (seu banco) — email → data de vencimento do acesso. É o que decide
  se alguém tem acesso ou não, hoje.

O dado de cartão **nunca passa pelo seu servidor** — o Asaas hospeda a tela de
pagamento (Link de Pagamento) ou você usa a API só pra criar a cobrança e redireciona
o cliente pro `invoiceUrl`.

---

## 2. Asaas — conceitos

Ambiente é decidido pelo **prefixo da API key**, não por uma flag separada:

```ts
// examples/asaas-client.ts
function baseUrl(key: string): string {
  return key.startsWith('$aact_prod') || key.startsWith('$aact_M')
    ? 'https://api.asaas.com/v3'      // produção, dinheiro real
    : 'https://sandbox.asaas.com/api/v3'; // sandbox, dinheiro fake
}
```

Toda chamada à API leva a chave no header `access_token` (não é Bearer):

```ts
fetch(`${base}/customers/${id}`, {
  headers: { access_token: ASAAS_API_KEY, 'content-type': 'application/json' },
});
```

## 3. Cobrar: PIX, cartão e parcelamento

Via API (`POST /v3/payments`), o campo que muda tudo é `billingType`:

```ts
// PIX — instantâneo, sem taxa de cartão
{
  customer: customerId,
  billingType: 'PIX',
  value: 97.00,          // em REAIS (float), não centavos
  dueDate: '2026-08-05',
  description: 'Assinatura anual',
  externalReference: `user:${userId}`,
}

// Boleto
{ ...igual, billingType: 'BOLETO' }

// Cartão à vista (1x)
{ ...igual, billingType: 'CREDIT_CARD' }

// Cartão PARCELADO — os dois campos extras são o que faz o "nx"
{
  ...igual,
  billingType: 'CREDIT_CARD',
  installmentCount: 3,        // em quantas vezes
  totalValue: 291.00,         // valor TOTAL da compra (não da parcela)
  // installmentValue: 97.00  // alternativa: valor de CADA parcela, em vez de totalValue
}
```

Regras que mordem:

- `value`/`totalValue` são em **reais**, `97.00`, não `9700` (centavos). Se seu banco
  guarda em centavos, converta na borda.
- Em parcelamento, mande **ou** `totalValue` **ou** `installmentValue` — nunca os dois.
- Parcelamento "sem juros" fica por conta de quem configura a taxa no painel Asaas
  (Configurações → Parcelamento) — a API não tem um campo `interestFree` separado.
- Depois de criado, o pagamento tem `invoiceUrl` (redirecione o cliente pra lá) e,
  se PIX, dá pra buscar o QR Code isolado:

```ts
export async function getPixQrCode(paymentId: string) {
  const res = await fetch(`${base}/payments/${paymentId}/pixQrCode`, {
    headers: { access_token: ASAAS_API_KEY },
  });
  return res.json(); // { encodedImage, payload, expirationDate }
}
```

Ver `examples/asaas-client.ts` para um cliente mínimo completo (customer + payment
+ PIX QR code).

## 4. Duas formas de vender: Link de Pagamento vs API

| | **A) Link de Pagamento** | **B) Via API** |
|---|---|---|
| Código necessário | nenhum | o cliente de `asaas-client.ts` |
| Onde cola | qualquer página, até fora do seu app | fluxo logado do seu produto |
| Cria o Payment | Asaas cria na hora que o cliente paga | você cria com `createPayment()` antes |
| Cupom / conta vinculada no seu banco | não, direto | sim (`externalReference`) |
| Libera acesso automaticamente | sim, via webhook (casando por valor/e-mail) | sim, via webhook (casando por `externalReference`) |

**A) é o caminho mais rápido pra validar uma oferta**: Painel Asaas → *Cobranças →
Link de Pagamento* → cria um link fixo por plano (ex.: mensal R$42, anual R$327) →
`https://www.asaas.com/c/XXXXXXXX` → cola num botão `<a href>`. Zero backend pra
cobrar — só precisa do webhook pra liberar o acesso (seção 5).

**B) é o caminho pra checkout dentro do seu produto**, com valor dinâmico, cupom,
CPF, e vínculo direto com o `userId` logado via `externalReference`.

Este repo documenta e dá exemplo dos dois, mas o **Link de Pagamento (A)** é o que
recomendamos pra começar — é o que foi usado no `pay.inema.pro` (ver
`examples/pricing-page.tsx`).

## 5. Webhook: liberar o acesso automaticamente

Rota `POST /api/asaas/webhook` (App Router, `runtime = 'nodejs'` — a service role
key do banco e criptografia de token não rodam no Edge):

```ts
// examples/webhook-route.ts (resumo — arquivo completo tem tudo)
export async function POST(request: Request) {
  // 1. Autenticação: o Asaas manda um header configurado por você no painel.
  const token = request.headers.get('asaas-access-token') ?? '';
  if (!tokenValido(token, process.env.ASAAS_WEBHOOK_SECRET!)) {
    return new Response('forbidden', { status: 403 });
  }

  const event = await request.json();
  // 2. Só agimos em confirmação — ignora os outros ~20 tipos de evento do Asaas.
  if (!['PAYMENT_CONFIRMED', 'PAYMENT_RECEIVED'].includes(event.event)) {
    return new Response('ignored', { status: 200 });
  }

  const pagamento = extrairPagamento(event); // { id, valor, customerId, email }

  // 3. Idempotência: o Asaas PODE reenviar o mesmo evento. Dedup pelo id do pagamento
  //    ANTES de processar de novo — senão você libera acesso em dobro / soma vencimento 2x.
  if (await jaProcessado(pagamento.id)) return new Response('duplicate', { status: 200 });

  // 4. Email do comprador: vem no payload OU busca via API (customer só por id).
  const email = pagamento.email ?? (await getCustomerEmail(pagamento.customerId));
  if (!email) { /* notifica você mesmo por email/Telegram — não dá pra liberar sem email */ }

  // 5. Grava o pagamento (marcador de idempotência) e SÓ DEPOIS atualiza o vencimento
  //    do assinante — nessa ordem, se cair no meio, o retry do Asaas refaz do jeito certo.
  await inserirPagamento({ ...pagamento, email });
  await upsertAssinante({ email, vencimento: calcularNovoVencimento(...) });

  // 6. Email de boas-vindas / acesso liberado (pode incluir o magic link, seção 7).
  await enviarEmailDeAcesso(email);

  return new Response('ok', { status: 200 }); // 200 = Asaas não re-tenta
}
```

Pontos que **sempre** dão problema se pulados:

- **Auth do webhook**: comparar o token com `timingSafeEqual`, não `===` (evita
  timing attack — trivial de fazer certo, então faça).
- **Idempotência**: o Asaas re-tenta em erro 5xx e também pode duplicar eventos por
  conta própria. Sem dedup por `paymentId`, um clique duplo em "confirmar" no painel
  de teste já quebra sua contagem de vencimento.
- **200 mesmo quando "ignoramos"**: eventos que você não trata (ex.: `PAYMENT_OVERDUE`
  se você não usa) devem responder 200, não 400/500 — senão o Asaas fica re-tentando
  pra sempre achando que falhou.
- **5xx só em erro genuíno**: se algo inesperado quebrar no meio do processamento,
  devolva 500 de propósito — como as escritas são idempotentes, o retry automático
  do Asaas conserta sozinho.

## 6. Cálculo de vencimento / renovação

Regra simples e que cobre re-assinatura/renovação/upgrade sem duplicar tempo:

```ts
// examples/vencimento.ts
export function calcVencimento(valor: number, vencimentoAtual: string|null, hoje: string) {
  const tipo = valor >= LIMIAR_ANUAL ? 'anual' : 'mensal'; // decide pelo valor pago
  const dias = tipo === 'anual' ? 365 : 30;
  // se já tem vencimento FUTURO, soma a partir dele (renovação antecipada não perde dias);
  // se venceu ou nunca assinou, conta a partir de hoje.
  const base = vencimentoAtual && vencimentoAtual > hoje ? vencimentoAtual : hoje;
  return { tipo, dataVencimento: addDias(base, dias) };
}
```

Isso é o que permite: pagar de novo 5 dias antes de vencer → não perde esses 5 dias;
deixar vencer e pagar depois → conta a partir de hoje, não acumula "dívida" de dias
perdidos.

## 7. Login sem senha: Magic Link (Supabase)

Objetivo: quem pagou recebe um **link que loga direto**, sem criar senha. Dois casos
de uso do mesmo mecanismo:

- **Self-service**: a pessoa esqueceu como entrar / trocou de dispositivo → pede o
  link de novo, ela mesma, informando o email que pagou.
- **Admin**: suporte gera o link manualmente pra alguém que não recebeu o email.

### Gerar o link (servidor, `supabaseAdmin`)

```ts
// examples/magic-link.ts
const { data, error } = await supabaseAdmin.auth.admin.generateLink({
  type: 'magiclink',
  email,
  options: { redirectTo: `${origin}/auth/callback` },
});

// IMPORTANTE: não use data.properties.action_link direto (o link hospedado do
// Supabase). Ele cai no fluxo PKCE (exchangeCodeForSession), que exige um
// `code_verifier` guardado no NAVEGADOR que iniciou o login — que não existe
// quando o link nasce no servidor (Admin API). Use o token_hash cru:
const link = `${origin}/auth/callback?token_hash=${data.properties.hashed_token}&type=magiclink`;
```

### Consumir o link (rota de callback, cliente comum)

Uma única rota `/auth/callback` recebe os dois fluxos possíveis do seu app —
OAuth normal (Google, `?code=`) e magic link gerado no servidor (`?token_hash=`):

```ts
// examples/auth-callback.ts
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const tokenHash = searchParams.get('token_hash');
  const type = searchParams.get('type');

  if (tokenHash && type) {
    // magic link gerado no servidor → verifyOtp NÃO precisa de code_verifier
    const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
    return NextResponse.redirect(error ? `${origin}/entrar?erro=...` : origin);
  }

  const code = searchParams.get('code');
  // login OAuth normal (Google etc.) → esse sim precisa do code_verifier do navegador
  const { error } = await supabase.auth.exchangeCodeForSession(code!);
  return NextResponse.redirect(error ? `${origin}/entrar?erro=...` : origin);
}
```

### Antes de gerar o link: **valide a assinatura**

Nunca gere magic link só porque alguém digitou um email — confirme que aquele
email tem acesso pago e válido, senão você criou um login gratuito pra qualquer um:

```ts
const vencimento = await getVencimento(email);
if (!isAssinaturaValida(vencimento)) return { ok: false, motivo: vencimento ? 'expirado' : 'nao-assinante' };
```

E aplique **rate limit** na rota self-service (não na admin) — é a única porta desse
fluxo exposta sem autenticação prévia; sem rate limit vira oráculo de "esse email é
assinante?" pra qualquer um testando emails em massa. Registre toda tentativa
(sucesso/falha/motivo/IP/user-agent) — é o log que resolve "não recebi o link"
depois.

## 8. Setup do zero (checklist)

**Asaas**
1. Criar conta em [asaas.com](https://www.asaas.com) (ou sandbox em
   `sandbox.asaas.com` pra testar sem dinheiro real).
2. Painel → Integrações → Chave de API → copiar, guardar como `ASAAS_API_KEY`.
3. Painel → Integrações → Webhooks → nova URL apontando pra
   `https://seudominio.com/api/asaas/webhook`, eventos: no mínimo `PAYMENT_CONFIRMED`
   e `PAYMENT_RECEIVED`. Definir um token/segredo no campo de autenticação → guardar
   como `ASAAS_WEBHOOK_SECRET`.
4. Se for usar Link de Pagamento (caminho A da seção 4): Painel → Cobranças → Link
   de Pagamento → criar um por plano/valor.

**Supabase (magic link)**
1. Projeto Supabase já com Auth habilitado (email como provider).
2. Pegar a `SUPABASE_SERVICE_ROLE_KEY` (só usada no servidor, nunca no client) —
   é o que permite `auth.admin.generateLink`.
3. Configurar Site URL / Redirect URLs no painel Supabase incluindo
   `https://seudominio.com/auth/callback`.

**No seu projeto Next.js**
1. Copiar `examples/asaas-client.ts`, `examples/webhook-route.ts`,
   `examples/vencimento.ts` → adaptar nomes de tabela pro seu schema.
2. Copiar `examples/magic-link.ts`, `examples/auth-callback.ts` se for usar login
   sem senha.
3. Rodar em sandbox primeiro (chave Asaas sem prefixo `$aact_prod`/`$aact_M`),
   confirmar 1 pagamento fake de ponta a ponta (pagar → webhook → banco → email)
   antes de trocar pra chave de produção.

## 9. Variáveis de ambiente

```bash
ASAAS_API_KEY=              # painel Asaas → Integrações → Chave de API
ASAAS_WEBHOOK_SECRET=       # o mesmo valor configurado no webhook do painel
ASAAS_BASE_URL=             # opcional — só pra forçar sandbox/prod manualmente

SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=  # só no servidor — nunca expor no client/browser
```

## 10. Segurança

- Dado de cartão **nunca** passa pelo seu servidor — sempre pelo checkout hospedado
  do Asaas (Link de Pagamento) ou pelo SDK deles, nunca um form seu coletando número
  de cartão.
- `ASAAS_WEBHOOK_SECRET` comparado com `timingSafeEqual`, não `===`.
- `SUPABASE_SERVICE_ROLE_KEY` só em código de servidor (rota API / server action),
  nunca em componente client nem em `NEXT_PUBLIC_*`.
- Magic link: sempre validar assinatura ativa antes de gerar; rate limit na rota
  self-service; registrar tentativas para auditoria.
- Webhook idempotente (dedup por `paymentId`) — assume que o Asaas pode reenviar.

## 11. Arquivos deste repo

```
examples/
  asaas-client.ts       cliente mínimo: customer, payment (PIX/cartão/parcelado/boleto), PIX QR code
  webhook-route.ts       rota de webhook completa (auth, idempotência, liberação de acesso)
  vencimento.ts           cálculo de vencimento/renovação por valor pago
  magic-link.ts           geração de magic link (Supabase Admin API) com validação de assinatura
  auth-callback.ts        rota de callback que aceita OAuth normal e magic link
  pricing-page.tsx        página de preços simples (Link de Pagamento), estilo cards
```

---

Extraído e adaptado dos projetos INEMA (`pay.inema.pro`, `inema.pro`, `inemaonline`).
Sem chaves, domínios ou dados reais — troque tudo antes de usar em produção.
