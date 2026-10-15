/**
 * Converte uma data "YYYY-MM-DD" vinda de um <input type="date"> (o usuário
 * só escolhe o dia, sem horário) num Date seguro pra guardar como TIMESTAMP.
 * `new Date("YYYY-MM-DD")` interpreta a string como meia-noite UTC — em
 * qualquer fuso atrás de UTC (Brasil é UTC-3) isso mostra um dia ANTERIOR ao
 * escolhido assim que formatado na hora local do navegador (ex: dia 02 vira
 * dia 01 às 21h). Ancorando ao meio-dia UTC em vez de meia-noite, o dia
 * calendário escolhido se mantém correto em qualquer fuso horário real
 * (de UTC-11 a UTC+13).
 */
export function dataSomenteDiaParaTimestamp(valor: string): Date {
  const [ano, mes, dia] = valor.split("-").map(Number);
  return new Date(Date.UTC(ano, mes - 1, dia, 12, 0, 0));
}
