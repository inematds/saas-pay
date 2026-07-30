# TODO — starter Next.js funcional de verdade

Estado atual (v1): `README.md` + `examples/*.ts` são documentação e trechos de
código pra copiar/adaptar — não rodam sozinhos (chamam funções como `db.ts`,
`buscarAssinante`, `enviarEmailDeAcesso` que são placeholders comentados).

Objetivo da próxima sessão: transformar `saas-pay` num **starter que roda de
verdade** — `git clone` → `npm i` → cola as chaves no `.env` → `npm run dev` →
funciona fim-a-fim (página de preços → pagamento sandbox Asaas → webhook →
banco → email/magic link).

## Escopo

1. **App Next.js real na raiz** (App Router), não só `examples/` soltos:
   - `app/page.tsx` — página de preços (reaproveita o design de `pay.inema.pro`,
     ver `inemapro-mono/apps/pay`).
   - `app/api/asaas/webhook/route.ts` — webhook completo, sem placeholders.
   - `app/auth/callback/route.ts` — callback do magic link.
   - `app/entrar/page.tsx` — tela simples de login/self-service de magic link.
2. **`package.json` + `tsconfig.json` reais** — precisa compilar/rodar (`next dev`),
   não só existir como texto.
3. **Persistência de verdade, mas trocável**: usar **SQLite local (`better-sqlite3`
   ou Prisma + SQLite)** como default pra rodar sem depender de conta Supabase —
   documentar como trocar pra Postgres/Supabase em produção. Isso baixa a barreira
   de "só quero testar" a zero.
4. **`.env.example`** com todas as variáveis (`ASAAS_API_KEY`, `ASAAS_WEBHOOK_SECRET`,
   `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` ou equivalente SQLite).
5. **Modo mock de pagamento** (`MOCK_PAYMENT=true`) — permite testar o fluxo
   completo (webhook → libera acesso → email) sem nem precisar de conta Asaas
   sandbox configurada. Inspirar no `dev.mock_payment` do `inemaonline/worker`.
6. **Testes** dos pontos que mais quebram: `vencimento.test.ts` (cálculo de
   renovação) e `webhook-core.test.ts` (parsing/idempotência do payload) — já
   existem versões disso em `inemapro-mono/apps/pay/lib/*.test.mjs`, portar.
7. **README**: trocar a seção "copie os arquivos" por "clone e rode" — comando
   por comando, com print/gif se der.
8. Manter compatível com o guia atual: quem já copiou os `examples/` antes não
   deve quebrar — mover o conteúdo atual de `examples/` pra `docs/referencia.md`
   ou manter como estava e adicionar o app novo do lado.

## Fontes pra portar (dentro deste ecossistema, já testado em produção)

- `~/projetos/inemapro-mono/apps/pay` — app Next.js real de pagamento (é o que
  esse starter deveria virar, mas genérico/sem dados INEMA).
- `~/projetos/inemapro-mono/apps/pro/lib/acessoAlternativo*.ts` — magic link
  completo com rate limit e auditoria (`acessoAlternativoDb.ts`).
- `~/projetos/inemaonline/worker` — referência de `mock_payment` e config de
  planos/métodos on-off.

## Critério de pronto

- [ ] `git clone` + `npm i` + `npm run dev` sobe sem erro.
- [ ] Com `MOCK_PAYMENT=true`, dá pra simular um pagamento confirmado e ver o
      acesso sendo liberado no banco local, sem nenhuma chave configurada.
- [ ] Com chave Asaas sandbox real, um pagamento PIX de teste completa o fluxo
      fim-a-fim (pagar → webhook → banco → email com magic link → login).
- [ ] `npm test` roda e passa (vencimento + webhook parsing).
