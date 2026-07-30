// Geração de magic link (login sem senha) via Supabase Admin API.
// Roda SÓ no servidor — usa a service role key, nunca exponha no client.
import { createClient } from '@supabase/supabase-js';

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!, // service role — só backend
);

export type GerarLinkInput = {
  email: string;
  origin: string; // ex.: 'https://seudominio.com'
  metodo: 'self-service' | 'admin';
};

export type GerarLinkResultado =
  | { ok: true; link: string }
  | { ok: false; motivo: 'nao-assinante' | 'expirado' | 'erro' };

export async function gerarLinkAcesso(input: GerarLinkInput): Promise<GerarLinkResultado> {
  const email = input.email.trim().toLowerCase();

  // 1. NUNCA pule esta validação — sem ela, qualquer email digitado ganha login.
  // const vencimento = await getVencimento(email);
  // if (!isAssinaturaValida(vencimento)) {
  //   return { ok: false, motivo: vencimento ? 'expirado' : 'nao-assinante' };
  // }

  // 2. Gera o link via Admin API.
  const { data, error } = await supabaseAdmin.auth.admin.generateLink({
    type: 'magiclink',
    email,
    options: { redirectTo: `${input.origin}/auth/callback` },
  });
  if (error || !data?.properties?.hashed_token) {
    return { ok: false, motivo: 'erro' };
  }

  // 3. IMPORTANTE: não use `data.properties.action_link` (o link hospedado do
  // Supabase). Ele cai no fluxo PKCE (exchangeCodeForSession), que exige um
  // `code_verifier` salvo no NAVEGADOR que iniciou o login — que não existe
  // quando o link nasce no servidor via Admin API. Monte o link pro SEU
  // callback usando o token_hash cru; o callback faz verifyOtp (sem PKCE).
  const link = `${input.origin}/auth/callback?token_hash=${encodeURIComponent(
    data.properties.hashed_token,
  )}&type=magiclink`;

  // 4. Log de auditoria — resolve "não recebi o link" e detecta abuso.
  // await registrarTentativa({ email, metodo: input.metodo, sucesso: true });

  return { ok: true, link };
}

/* Rota self-service típica (o usuário pede o próprio link):
 *
 * export async function POST(request: Request) {
 *   const { email } = await request.json();
 *   const ip = request.headers.get('x-forwarded-for') ?? 'desconhecido';
 *
 *   // Rate limit AQUI — essa rota é a única porta desse fluxo sem login prévio.
 *   // Sem isso vira oráculo de "esse email é assinante?" pra qualquer um.
 *   if (await excedeuLimite(ip)) return new Response('too many requests', { status: 429 });
 *
 *   const origin = new URL(request.url).origin;
 *   const resultado = await gerarLinkAcesso({ email, origin, metodo: 'self-service' });
 *   if (!resultado.ok) return Response.json({ erro: resultado.motivo }, { status: 400 });
 *
 *   await enviarEmailComLink(email, resultado.link); // NUNCA devolva o link na resposta HTTP
 *   return Response.json({ ok: true });
 * }
 */
