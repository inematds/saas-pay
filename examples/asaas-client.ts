// Cliente mínimo da API Asaas v3 — customer, payment (PIX/cartão à vista ou
// parcelado/boleto) e QR Code do PIX. Sem dependências externas (fetch nativo).

const PROD = 'https://api.asaas.com/v3';
const SANDBOX = 'https://sandbox.asaas.com/api/v3';

function baseUrl(key: string): string {
  // Ambiente decidido pelo prefixo da própria chave — não precisa de flag separada.
  return key.startsWith('$aact_prod') || key.startsWith('$aact_M') ? PROD : SANDBOX;
}

function headers(key: string) {
  return {
    access_token: key, // Asaas usa header próprio, não "Authorization: Bearer"
    'content-type': 'application/json',
  };
}

export type Customer = {
  id: string;
  name: string;
  email: string;
  cpfCnpj?: string;
};

export async function createOrGetCustomer(
  apiKey: string,
  input: { name: string; email: string; cpfCnpj?: string },
): Promise<Customer> {
  const base = baseUrl(apiKey);

  // Asaas não tem "upsert" nativo — busca por email primeiro pra não duplicar customer.
  const search = await fetch(`${base}/customers?email=${encodeURIComponent(input.email)}`, {
    headers: headers(apiKey),
  });
  const found = await search.json();
  if (found?.data?.length) return found.data[0];

  const res = await fetch(`${base}/customers`, {
    method: 'POST',
    headers: headers(apiKey),
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(`[asaas] POST /customers → ${res.status}`);
  return res.json();
}

export type BillingType = 'PIX' | 'CREDIT_CARD' | 'BOLETO';

export type CreatePaymentInput = {
  customer: string; // customer id
  billingType: BillingType;
  value: number; // em REAIS (float), não centavos. Se for parcelado, é o valor da 1ª leitura — use totalValue abaixo.
  dueDate: string; // 'YYYY-MM-DD'
  description?: string;
  externalReference?: string; // seu id interno (userId, planoId...) — volta no webhook
  /** Parcelamento no cartão. Use SÓ com billingType: 'CREDIT_CARD'. */
  installmentCount?: number; // em quantas vezes (ex.: 3, 6, 12)
  /** valor TOTAL da compra — o Asaas divide pelas installmentCount parcelas. */
  totalValue?: number;
  /** alternativa a totalValue: valor de CADA parcela (não mande os dois). */
  installmentValue?: number;
};

export async function createPayment(apiKey: string, input: CreatePaymentInput) {
  const base = baseUrl(apiKey);
  const res = await fetch(`${base}/payments`, {
    method: 'POST',
    headers: headers(apiKey),
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`[asaas] POST /payments → ${res.status}: ${body}`);
  }
  return res.json() as Promise<{ id: string; invoiceUrl: string; status: string }>;
}

export async function getPixQrCode(apiKey: string, paymentId: string) {
  const base = baseUrl(apiKey);
  const res = await fetch(`${base}/payments/${paymentId}/pixQrCode`, {
    headers: headers(apiKey),
  });
  if (!res.ok) throw new Error(`[asaas] GET /payments/${paymentId}/pixQrCode → ${res.status}`);
  return res.json() as Promise<{ encodedImage: string; payload: string; expirationDate: string }>;
}

/** Email do customer Asaas. null = customer sem email / inexistente (genuíno).
 *  Falha transitória ou de config (rede, 5xx, 401) LANÇA — deixe a rota chamadora
 *  decidir se re-tenta (ex.: devolvendo 500 pro webhook do Asaas re-enviar). */
export async function getCustomerEmail(apiKey: string, customerId: string): Promise<string | null> {
  if (!customerId) return null;
  const base = baseUrl(apiKey);
  const res = await fetch(`${base}/customers/${customerId}`, { headers: headers(apiKey) });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`[asaas] GET /customers/${customerId} → ${res.status}`);
  const json = (await res.json()) as { email?: string };
  return json?.email ?? null;
}

/* ------------------------------------------------------------------------
 * Exemplos de uso:
 *
 * // PIX à vista
 * const customer = await createOrGetCustomer(key, { name, email, cpfCnpj });
 * const payment = await createPayment(key, {
 *   customer: customer.id, billingType: 'PIX',
 *   value: 97.00, dueDate: '2026-08-05', description: 'Assinatura anual',
 *   externalReference: `user:${userId}`,
 * });
 * const qr = await getPixQrCode(key, payment.id); // mostra QR + copia-e-cola
 *
 * // Cartão parcelado em 3x
 * const payment = await createPayment(key, {
 *   customer: customer.id, billingType: 'CREDIT_CARD',
 *   value: 97.00, dueDate: '2026-08-05',
 *   installmentCount: 3, totalValue: 291.00,
 * });
 * redirect(payment.invoiceUrl); // Asaas hospeda a tela de cartão, você nunca vê o número
 * ---------------------------------------------------------------------- */
