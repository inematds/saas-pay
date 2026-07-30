// Rota de webhook do Asaas — Next.js App Router.
// Adapte `db.ts` (funções fictícias abaixo) pro seu schema/ORM.
import { NextResponse } from 'next/server';
import { timingSafeEqual } from 'node:crypto';
import { getCustomerEmail } from './asaas-client';
import { calcVencimento, hojeSP } from './vencimento';
// import { jaProcessado, inserirPagamento, upsertAssinante, enviarEmailDeAcesso } from './db';

// service role + fetch → precisa de Node runtime, não Edge; nunca cachear.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const EVENTOS_CONFIRMADOS = new Set(['PAYMENT_CONFIRMED', 'PAYMENT_RECEIVED']);

function tokenValido(token: string, secret: string): boolean {
  const a = Buffer.from(token);
  const b = Buffer.from(secret);
  // comparação em tempo constante — evita timing attack em vez de `token === secret`
  return a.length === b.length && timingSafeEqual(a, b);
}

type PagamentoAsaas = { id: string; valor: number; customerId: string | null; email: string | null };

function extrairPagamento(event: any): PagamentoAsaas | null {
  const p = event?.payment;
  if (!p || !p.id || p.value == null) return null;
  const cust = p.customer;
  return {
    id: String(p.id),
    valor: Number(p.value),
    customerId: typeof cust === 'string' ? cust : (cust?.id ?? null),
    email: typeof cust === 'object' && cust?.email ? String(cust.email) : null,
  };
}

export async function POST(request: Request) {
  // 1. Auth — o Asaas envia o header configurado por você no painel de webhooks.
  const token = request.headers.get('asaas-access-token') ?? '';
  const secret = process.env.ASAAS_WEBHOOK_SECRET;
  if (!secret || !tokenValido(token, secret)) {
    return new NextResponse('forbidden', { status: 403 });
  }

  let event: unknown;
  try {
    event = await request.json();
  } catch {
    return new NextResponse('bad json', { status: 400 });
  }

  const tipoEvento = (event as { event?: string })?.event;
  // Eventos que você não trata devem responder 200 (não 400/500) — senão o Asaas
  // fica re-tentando pra sempre achando que a entrega falhou.
  if (!EVENTOS_CONFIRMADOS.has(String(tipoEvento))) {
    return new NextResponse('ignored', { status: 200 });
  }

  const pag = extrairPagamento(event);
  if (!pag) return new NextResponse('missing payment', { status: 400 });

  const apiKey = process.env.ASAAS_API_KEY!;
  const hoje = hojeSP();

  try {
    // 2. Idempotência: o Asaas pode reenviar o mesmo evento. Sem isso, um retry
    //    ou um clique duplo no painel de teste soma vencimento em dobro.
    // const existente = await jaProcessado(pag.id);
    // if (existente) return new NextResponse('duplicate', { status: 200 });

    // 3. Email do comprador: vem no payload OU busca via API (customer só por id).
    let email = pag.email;
    if (!email && pag.customerId) email = await getCustomerEmail(apiKey, pag.customerId);
    if (!email) {
      console.error('[webhook] sem email do customer', { paymentId: pag.id, customerId: pag.customerId });
      // notifique você mesmo (email/Telegram) — sem email não dá pra liberar acesso automaticamente
      return new NextResponse('ok (sem email)', { status: 200 });
    }
    email = email.trim().toLowerCase();

    // 4. Vencimento: soma a partir do vencimento atual se ainda for futuro
    //    (renovação antecipada não perde dias), senão conta a partir de hoje.
    // const assinante = await buscarAssinante(email);
    const vencimentoAtual: string | null = null; // = assinante?.vencimento ?? null
    const { tipo, dataVencimento } = calcVencimento(pag.valor, vencimentoAtual, hoje);

    // 5. Grava o pagamento PRIMEIRO (é o seu marcador de idempotência),
    //    só depois atualiza o vencimento do assinante — nessa ordem, se cair no
    //    meio, o retry automático do Asaas refaz do jeito certo.
    // await inserirPagamento({ ...pag, email, tipo, dataVencimento, payload: event });
    // await upsertAssinante({ email, dataVencimento, tipo });

    // 6. Email de boas-vindas / link de acesso (pode incluir o magic link — ver magic-link.ts)
    // await enviarEmailDeAcesso(email, { tipo, dataVencimento });

    console.log('[webhook] pagamento confirmado', { email, tipo, dataVencimento });
    return new NextResponse('ok', { status: 200 });
  } catch (e) {
    // Erro inesperado → 500 de propósito: como as escritas acima são idempotentes,
    // o retry automático do Asaas é seguro e conserta sozinho.
    console.error('[webhook] erro', e);
    return new NextResponse('erro', { status: 500 });
  }
}
