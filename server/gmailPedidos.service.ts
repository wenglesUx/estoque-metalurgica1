/**
 * gmailPedidos.service.ts
 * Fase 2 da área "Materiais a Chegar" — varre a caixa de entrada em busca
 * de e-mails de fornecedores selecionados com PDF de pedido de compra
 * anexado, e joga na fila de revisão (nunca salva direto — o usuário
 * sempre confirma, como já era no upload manual).
 *
 * Mesma autenticação já usada em backup.service.ts (OAuth2 como o próprio
 * usuário) — o refresh token precisa ter sido gerado com o escopo de Gmail
 * incluído (script reautorizar-google-gmail.mjs), senão essa função
 * simplesmente não roda (mesmo princípio do backup: só ativa se as
 * variáveis certas estiverem presentes).
 */

import { google } from "googleapis";
import { extrairPedidoCompraDoPdf } from "./pedidoCompra.service";

function autenticarGmail() {
  // Variáveis PRÓPRIAS, separadas das do backup (GOOGLE_OAUTH_*) — a conta
  // de e-mail que recebe os pedidos é diferente da conta usada pro Drive.
  const clientId = process.env.GMAIL_PEDIDOS_CLIENT_ID;
  const clientSecret = process.env.GMAIL_PEDIDOS_CLIENT_SECRET;
  const refreshToken = process.env.GMAIL_PEDIDOS_REFRESH_TOKEN;
  if (!clientId || !clientSecret || !refreshToken) return null;

  const auth = new google.auth.OAuth2(clientId, clientSecret);
  auth.setCredentials({ refresh_token: refreshToken });
  return google.gmail({ version: "v1", auth });
}

function valorHeader(headers: any[], nome: string): string {
  // Nome do header sem diferenciar maiúscula/minúscula — alguns clientes de
  // e-mail mandam "CC"/"TO" em vez de "Cc"/"To".
  const alvo = nome.toLowerCase();
  return (headers.find((h: any) => (h.name || "").toLowerCase() === alvo)?.value || "").toLowerCase();
}

/**
 * Achata a árvore de partes do e-mail. O PDF nem sempre está no primeiro
 * nível: em e-mail encaminhado ou com imagem na assinatura ele vem dentro de
 * um multipart aninhado, e olhando só payload.parts o anexo não era achado.
 */
function todasAsPartes(parte: any): any[] {
  if (!parte) return [];
  return [parte, ...(parte.parts || []).flatMap(todasAsPartes)];
}

/** true se o remetente/CC do e-mail bate com algum dos e-mails cadastrados. */
function emailCombinaComFornecedor(headers: any[], emailsFornecedores: string[]): boolean {
  const de = valorHeader(headers, "From");
  const para = valorHeader(headers, "To");
  const cc = valorHeader(headers, "Cc");
  const textoCompleto = `${de} ${para} ${cc}`;
  return emailsFornecedores.some(email => textoCompleto.includes(email.toLowerCase().trim()));
}

/**
 * Segunda forma de detectar candidato, além da lista de fornecedores
 * cadastrados manualmente: pedidos de compra enviados pela própria equipe
 * de suprimentos pro fornecedor seguem um padrão de assunto bem definido
 * ("Pedido 2549 - Fornecedor [Proj. ...]", "Pedido_2215_ Fornecedor") —
 * não dá pra depender só da lista fixa porque toda hora aparece fornecedor
 * novo que ainda não foi cadastrado na tela de "Fornecedores Selecionados".
 * Sem isso, pedido de fornecedor não cadastrado nunca cai na fila.
 *
 * Critério: o assunto OU o nome de algum PDF anexo menciona "pedido".
 *
 * Antes também exigia um destinatário de fora da empresa, pra não pegar
 * e-mail interno — mas isso descartava pedido de verdade que chega por
 * encaminhamento interno ("Fwd: [102] CASA TECNA - LISTA 062 - PEDIDO FINAL"
 * mandado só pro Almoxarifado, com os PDFs dos pedidos anexos). Quem decide
 * se entra na fila é o conteúdo do PDF (ver temMateriaPrima), então e-mail
 * interno sem pedido de matéria-prima continua ficando de fora.
 */
function pareceSerPedido(headers: any[], nomesPdf: string[]): boolean {
  return /pedido/i.test(valorHeader(headers, "Subject")) || nomesPdf.some(nome => /pedido/i.test(nome));
}

/**
 * O Gmail limita as chamadas por minuto. Numa varredura grande (voltando de
 * uns dias parada, com centenas de e-mails pra olhar) esse limite estoura no
 * meio — então, em vez de contar como erro, espera e tenta de novo.
 */
async function comEsperaSeLimite<T>(chamada: () => Promise<T>): Promise<T> {
  for (let tentativa = 0; ; tentativa++) {
    try {
      return await chamada();
    } catch (err: any) {
      const estourouLimite = err?.code === 429 || /quota exceeded|rate limit/i.test(err?.message || "");
      if (!estourouLimite || tentativa >= 4) throw err;
      await new Promise(r => setTimeout(r, 20_000));
    }
  }
}

export interface ItemFilaRevisao {
  gmailMessageId: string;
  remetente: string;
  nomeArquivoOriginal: string;
  dadosExtraidos: any;
}

export interface ItemIgnorado {
  gmailMessageId: string;
  remetente: string;
  motivo: string;
}

export interface ResultadoVarreduraGmail {
  emailsAnalisados: number;
  novosNaFila: number;
  ignorados: number;
  erros: number;
  filaParaSalvar: ItemFilaRevisao[];
  // Mensagens examinadas e descartadas — precisam ser marcadas como
  // processadas mesmo assim (ver executarVarreduraEmailPedidos em db.ts),
  // senão o robô fica reanalisando o mesmo e-mail pra sempre a cada 20min.
  ignoradosParaMarcar: ItemIgnorado[];
}

/** Categorias que representam matéria-prima de verdade (ver parse_pedido_compra.py). */
const CATEGORIAS_MATERIA_PRIMA = ["PERFIL", "CHAPA"];

/**
 * Varre a caixa de entrada em busca de novos e-mails de fornecedores
 * selecionados (ou de pedido enviado a um fornecedor externo) com PDF
 * anexado. Retorna null se o Gmail não estiver configurado (sem quebrar
 * nada — mesmo padrão do backup).
 */
export async function varrerEmailsPedidos(
  fornecedoresEmails: string[],
  jaProcessados: Set<string>
): Promise<ResultadoVarreduraGmail | null> {
  const gmail = autenticarGmail();
  if (!gmail) return null;

  const resultado: ResultadoVarreduraGmail = {
    emailsAnalisados: 0, novosNaFila: 0, ignorados: 0, erros: 0,
    filaParaSalvar: [], ignoradosParaMarcar: [],
  };

  // Só e-mails com anexo PDF, das últimas 2 semanas — evita varrer a caixa
  // inteira toda vez.
  // Pagina até o fim: a caixa recebe bem mais de 100 e-mails com PDF em 14
  // dias, e sem paginar só os 100 mais recentes eram vistos — se a varredura
  // ficasse uns dias parada (token expirado, servidor fora), o que tinha
  // chegado nesse intervalo nunca mais era analisado.
  const mensagens: { id?: string | null }[] = [];
  let pageToken: string | undefined;
  do {
    const lista = await gmail.users.messages.list({
      userId: "me",
      q: "has:attachment filename:pdf newer_than:14d",
      maxResults: 500,
      pageToken,
    });
    mensagens.push(...(lista.data.messages || []));
    pageToken = lista.data.nextPageToken || undefined;
  } while (pageToken && mensagens.length < 2000);

  for (const msgRef of mensagens) {
    if (!msgRef.id || jaProcessados.has(msgRef.id)) continue;
    resultado.emailsAnalisados++;

    try {
      const idMensagem = msgRef.id;
      const msg = await comEsperaSeLimite(() => gmail.users.messages.get({ userId: "me", id: idMensagem, format: "full" }));
      const headers = msg.data.payload?.headers || [];
      const remetente = headers.find((h: any) => h.name === "From")?.value || "";

      const partesAnexo = todasAsPartes(msg.data.payload).filter(
        (p: any) => p.filename?.toLowerCase().endsWith(".pdf") && p.body?.attachmentId
      );

      const combinaFornecedorCadastrado = fornecedoresEmails.length > 0 && emailCombinaComFornecedor(headers, fornecedoresEmails);

      if (!combinaFornecedorCadastrado && !pareceSerPedido(headers, partesAnexo.map((p: any) => p.filename))) {
        resultado.ignorados++;
        resultado.ignoradosParaMarcar.push({ gmailMessageId: msgRef.id, remetente, motivo: "remetente_nao_e_fornecedor_e_assunto_nao_parece_pedido" });
        continue;
      }

      if (partesAnexo.length === 0) {
        resultado.ignorados++;
        resultado.ignoradosParaMarcar.push({ gmailMessageId: msgRef.id, remetente, motivo: "sem_anexo_pdf_no_nivel_esperado" });
        continue;
      }

      let algumPdfProcessado = false;
      for (const parte of partesAnexo) {
        const anexo = await comEsperaSeLimite(() => gmail.users.messages.attachments.get({
          userId: "me",
          messageId: idMensagem,
          id: parte.body.attachmentId,
        }));
        const base64 = (anexo.data.data || "").replace(/-/g, "+").replace(/_/g, "/");

        const extraido = await extrairPedidoCompraDoPdf(base64);

        // Só entra na fila se pelo menos um item for matéria-prima de
        // verdade (perfil ou chapa) — o resto (EPI, tinta, ferramenta,
        // consumível etc.) fica de fora, esperando o módulo de almoxarifado.
        const temMateriaPrima = extraido.itens.some(
          (it) => CATEGORIAS_MATERIA_PRIMA.includes((it.categoria || "OUTRO").toUpperCase())
        );
        if (!temMateriaPrima || extraido.itens.length === 0) continue;

        resultado.filaParaSalvar.push({
          gmailMessageId: msgRef.id,
          remetente,
          nomeArquivoOriginal: parte.filename,
          dadosExtraidos: extraido,
        });
        algumPdfProcessado = true;
      }

      resultado.novosNaFila += algumPdfProcessado ? 1 : 0;
      if (!algumPdfProcessado) {
        resultado.ignorados++;
        resultado.ignoradosParaMarcar.push({ gmailMessageId: msgRef.id, remetente, motivo: "pdf_sem_item_de_materia_prima" });
      }
    } catch (err) {
      resultado.erros++;
      console.error(`[GmailPedidos] Erro processando mensagem ${msgRef.id}:`, (err as any)?.message || err);
    }
  }

  return resultado;
}
