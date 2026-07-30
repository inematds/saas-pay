// Cálculo de vencimento/renovação de assinatura a partir do valor pago.
// Puro (sem IO) — fácil de testar isolado.

export type TipoPlano = 'mensal' | 'anual';
export type Vencimento = { tipo: TipoPlano; dataVencimento: string };

// Ajuste ao seu preço real: qualquer valor >= isso é tratado como plano anual.
const LIMIAR_ANUAL = 100;

/** 'YYYY-MM-DD' de hoje, no fuso de São Paulo — evita bug de "virou o dia" por UTC. */
export function hojeSP(agora: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(agora);
}

export function addDias(ymd: string, dias: number): string {
  const [y, m, d] = ymd.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + dias);
  return dt.toISOString().slice(0, 10);
}

export function tipoPorValor(valor: number): TipoPlano {
  return valor >= LIMIAR_ANUAL ? 'anual' : 'mensal';
}

/**
 * Renovação acumulativa: se o vencimento atual ainda é FUTURO, soma os dias a
 * partir dele (pagar antes do vencimento não perde dias); se já venceu ou nunca
 * assinou, conta a partir de hoje (não "cobra" os dias que ficou sem pagar).
 */
export function calcVencimento(
  valor: number,
  vencimentoAtual: string | null,
  hoje: string,
): Vencimento {
  const tipo = tipoPorValor(valor);
  const dias = tipo === 'anual' ? 365 : 30;
  const base = vencimentoAtual && vencimentoAtual > hoje ? vencimentoAtual : hoje;
  return { tipo, dataVencimento: addDias(base, dias) };
}

export function maxVencimento(atual: string | null, novo: string): string {
  return !atual || novo > atual ? novo : atual;
}

/* Exemplos:
 *   calcVencimento(42,  null,         '2026-07-30') → { tipo: 'mensal', dataVencimento: '2026-08-29' }
 *   calcVencimento(327, null,         '2026-07-30') → { tipo: 'anual',  dataVencimento: '2027-07-30' }
 *   calcVencimento(42,  '2026-08-10', '2026-07-30') → soma a partir de 08-10 (renovação antecipada)
 *   calcVencimento(42,  '2026-06-01', '2026-07-30') → já venceu → soma a partir de hoje
 */
