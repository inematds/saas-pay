// Rota /auth/callback — recebe DOIS fluxos possíveis do seu app:
//   - OAuth normal (Google etc.) → ?code=...            → exchangeCodeForSession (precisa PKCE code_verifier)
//   - Magic link gerado no servidor → ?token_hash=&type= → verifyOtp (sem PKCE)
import { NextResponse } from 'next/server';
import type { EmailOtpType } from '@supabase/supabase-js';
import { createServerClient } from '@/lib/supabase/server'; // seu helper de client server-side

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');
  const tokenHash = searchParams.get('token_hash');
  const type = searchParams.get('type') as EmailOtpType | null;
  const next = searchParams.get('next') ?? '/';

  // Destino correto atrás de proxy (Vercel etc.): prioriza x-forwarded-host.
  const fwdHost = request.headers.get('x-forwarded-host');
  const fwdProto = request.headers.get('x-forwarded-proto') ?? 'https';
  const isLocal = process.env.NODE_ENV === 'development';
  const base = !isLocal && fwdHost ? `${fwdProto}://${fwdHost}` : origin;

  const supabase = createServerClient();

  if (tokenHash && type) {
    // Magic link gerado por admin.generateLink (ver magic-link.ts):
    // verifyOtp NÃO exige code_verifier, então funciona mesmo o link
    // tendo nascido no servidor (sem navegador iniciando o fluxo).
    const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
    if (error) {
      console.error('[auth/callback] verifyOtp falhou:', error.message);
      return NextResponse.redirect(`${base}/entrar?erro=${encodeURIComponent(error.message)}`);
    }
    return NextResponse.redirect(`${base}${next}`);
  }

  if (!code) {
    console.error('[auth/callback] sem ?code nem ?token_hash na URL');
    return NextResponse.redirect(`${base}/entrar?erro=sem-code`);
  }

  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    console.error('[auth/callback] exchangeCodeForSession falhou:', error.message);
    return NextResponse.redirect(`${base}/entrar?erro=${encodeURIComponent(error.message)}`);
  }

  return NextResponse.redirect(`${base}${next}`);
}
