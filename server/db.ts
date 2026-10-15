import { drizzle } from "drizzle-orm/mysql2";
import { eq, and, or, desc, isNull, sql, inArray, gte, lte, getTableColumns, type SQL } from "drizzle-orm";
import mysql from "mysql2/promise";
import { InsertUser, users, materiais, obras, estoque, movimentacoes, lotes, planosCote, itensPLano, especificacoesMateriais, registrosSaida, registrosEntrada, relatoriosRecebimento, relatorioRecebimentoImagens, relatorioRecebimentoMateriais, grdsGeradas, grdCertificados, grdMateriais, pedidosCompra, itensPedidoCompra, entregasItemPedidoCompra, fornecedoresPedidosEmail, emailsPedidoProcessados, pedidosCompraFilaRevisao, historicoAtividades, solicitacoesSeparacao, solicitacaoImagens, itensSolicitacao, inventarios, itensInventario, ajustesInventario, materiaisPendentesInventario, locaisEstoque, requisicoesProducao, itensRequisicaoProducao } from "../drizzle/schema";
import { ENV } from './_core/env';
import { dataSomenteDiaParaTimestamp } from './_core/dates';
import { createHash, randomBytes } from 'crypto';
import { nanoid } from 'nanoid';

/** Hash de senha usando SHA-256 + salt. Sem dependência extra. */
function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex');
  const hash = createHash('sha256').update(salt + password).digest('hex');
  return `${salt}:${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(':');
  const check = createHash('sha256').update(salt + password).digest('hex');
  return check === hash;
}

let _db: ReturnType<typeof drizzle> | null = null;

export async function getDb() {
  const dbUrl = process.env.DATABASE_URL || ENV.databaseUrl;
  if (!_db && dbUrl) {
    try {
      // timezone: 'Z' força o mysql2 a tratar toda TIMESTAMP/DATETIME como UTC
      // na leitura e na escrita — o servidor MySQL roda com time_zone=SYSTEM=UTC
      // (confirmado via NOW()/UTC_TIMESTAMP()), mas o driver por padrão assume
      // o timezone LOCAL do processo Node em vez de UTC. Sem isso, o mesmo
      // valor lido/gravado por processos Node em timezones diferentes (ex:
      // produção rodando num timezone e alguém testando localmente em outro)
      // produz datas/horas deslocadas de forma inconsistente — é a causa da
      // Linha do Tempo e das notificações de baixa mostrando horário errado.
      const poolConnection = mysql.createPool({ uri: dbUrl, timezone: "Z" });
      _db = drizzle(poolConnection);
    } catch (error: any) {
      console.error("[Database] Erro ao criar instância Drizzle:", error);
      _db = null;
    }
  }
  if (!_db) throw new Error("Database not available");
  return _db;
}

/**
 * Helper para capturar e logar erros detalhados do MySQL
 */
function handleDbError(error: any, context: string): never {
  console.error(`[Database Error] ${context}:`, error);
  const message = error?.sqlMessage || error?.message || "Erro desconhecido no banco de dados";
  throw new Error(`Failed query: ${message}`);
}

// ============================================================================
// MATERIAIS
// ============================================================================

/**
 * Linha do Tempo do Material — junta tudo que já existe espalhado (registro
 * de entrada, GRDs, Relatórios de Recebimento, registros de saída) num só
 * lugar, buscando por materialId. Funciona mesmo depois do material ter
 * saído do estoque (ativo=false) — os registros/ligações continuam existindo
 * independente do material atual ainda estar "ativo" ou não.
 */
export async function getLinhaDoTempoMaterial(materialId: number) {
  try {
    const db = await getDb();

    const [material] = await db.select().from(materiais).where(eq(materiais.id, materialId)).limit(1);

    const entradas = await db.select().from(registrosEntrada)
      .where(eq(registrosEntrada.materialId, materialId))
      .orderBy(desc(registrosEntrada.dataEntrada));

    const saidas = await db.select().from(registrosSaida)
      .where(eq(registrosSaida.materialId, materialId))
      .orderBy(desc(registrosSaida.dataSaida));

    const grdsLigadas = await db.select({
      grdId: grdMateriais.grdId,
      numero: grdsGeradas.numero,
      obra: grdsGeradas.obra,
      cliente: grdsGeradas.cliente,
      createdAt: grdsGeradas.createdAt,
    })
      .from(grdMateriais)
      .innerJoin(grdsGeradas, eq(grdMateriais.grdId, grdsGeradas.id))
      .where(eq(grdMateriais.materialId, materialId))
      .orderBy(desc(grdsGeradas.createdAt));

    const relatoriosLigados = await db.select({
      relatorioId: relatorioRecebimentoMateriais.relatorioId,
      createdAt: relatoriosRecebimento.createdAt,
      usuarioNome: relatoriosRecebimento.usuarioNome,
    })
      .from(relatorioRecebimentoMateriais)
      .innerJoin(relatoriosRecebimento, eq(relatorioRecebimentoMateriais.relatorioId, relatoriosRecebimento.id))
      .where(eq(relatorioRecebimentoMateriais.materialId, materialId))
      .orderBy(desc(relatoriosRecebimento.createdAt));

    // Edições granulares (obra, local, quantidade, etc.) — já rastreadas por
    // updateMaterial/updateMaterialComRecalculo, agora também linkadas por
    // materialId.
    const edicoes = await db.select({
      id: historicoAtividades.id,
      acao: historicoAtividades.acao,
      detalhes: historicoAtividades.detalhes,
      dataHora: historicoAtividades.dataHora,
      usuarioNome: historicoAtividades.usuarioNome,
    })
      .from(historicoAtividades)
      .where(eq(historicoAtividades.materialId, materialId))
      .orderBy(desc(historicoAtividades.dataHora));

    // Separações por requisição de produção (QR code) — não derruba a linha
    // do tempo se as tabelas ainda não existirem no banco
    const requisicoes = await listRequisicoesDoMaterial(materialId).catch(() => []);

    return {
      material: material || null,
      entradas,
      saidas,
      grds: grdsLigadas,
      relatorios: relatoriosLigados,
      edicoes,
      requisicoes: requisicoes ?? [],
    };
  } catch (error) {
    handleDbError(error, "getLinhaDoTempoMaterial");
  }
}


export async function listMateriais() {
  try {
    const db = await getDb();
    return await db.select().from(materiais).where(eq(materiais.ativo, true)).orderBy(desc(materiais.createdAt));
  } catch (error) {
    handleDbError(error, "listMateriais");
  }
}

/**
 * Busca material pra alimentar a Linha do Tempo — diferente de
 * listMateriais(), essa NÃO filtra por ativo. É o único jeito de achar um
 * material que já saiu do estoque, já que ele não aparece mais na tela de
 * Materiais nesse caso. Não substitui listMateriais() em lugar nenhum do
 * resto do sistema — é uma função nova, só pra esse propósito.
 */
// "W 200X26,6" — tipo e bitola juntos, como o usuário digita
const perfilCompletoSql = sql<string>`CONCAT_WS(' ', ${materiais.tipo}, ${materiais.bitola})`;

export async function buscarMaterialParaLinhaDoTempo(termo: string) {
  try {
    const db = await getDb();

    // Cada palavra precisa aparecer em algum campo — "W 200 A572" acha o
    // W 200X26,6 de aço A572 mesmo com tipo/bitola/aço em colunas separadas
    const palavras = termo.trim().split(/\s+/).filter(Boolean).slice(0, 6);
    const condicoes = palavras.map((palavra) => {
      const busca = `%${palavra}%`;
      return sql`(
        ${perfilCompletoSql} LIKE ${busca} OR
        ${materiais.aco} LIKE ${busca} OR
        ${materiais.nf} LIKE ${busca} OR
        ${materiais.corrida} LIKE ${busca}
      )`;
    });

    return await db.select({
      id: materiais.id,
      tipo: materiais.tipo,
      bitola: materiais.bitola,
      aco: materiais.aco,
      ativo: materiais.ativo,
      obraNome: materiais.obraNome,
      local: materiais.local,
      nf: materiais.nf,
      corrida: materiais.corrida,
      quantidade: materiais.quantidade,
      comprimento: materiais.comprimento,
      largura: materiais.largura,
      categoria: materiais.categoria,
    })
      .from(materiais)
      .where(condicoes.length ? and(...condicoes) : sql`1 = 0`)
      .orderBy(desc(materiais.ativo), desc(materiais.id))
      .limit(50);
  } catch (error) {
    handleDbError(error, "buscarMaterialParaLinhaDoTempo");
  }
}

/**
 * Sugestões enquanto digita na busca da Linha do Tempo — valores que existem
 * no cadastro (perfil completo, bitola, corrida, NF, aço) que contêm o texto,
 * com os que começam pelo texto primeiro.
 */
export async function sugestoesLinhaDoTempo(termo: string) {
  try {
    const db = await getDb();
    const texto = termo.trim();
    const contem = `%${texto}%`;
    const comeca = `${texto}%`;

    const sugerir = async (tipo: "perfil" | "bitola" | "corrida" | "nf" | "aco", campo: SQL) => {
      const rows = await db.select({
        valor: sql<string>`${campo}`,
        total: sql<number>`COUNT(*)`,
      })
        .from(materiais)
        .where(sql`${campo} IS NOT NULL AND ${campo} <> '' AND ${campo} LIKE ${contem}`)
        .groupBy(campo)
        .orderBy(sql`(${campo} LIKE ${comeca}) DESC`, sql`COUNT(*) DESC`)
        .limit(tipo === "perfil" ? 6 : 4);

      return rows.map((r) => ({ tipo, valor: String(r.valor), total: Number(r.total) }));
    };

    const grupos = await Promise.all([
      sugerir("perfil", perfilCompletoSql),
      sugerir("bitola", sql`${materiais.bitola}`),
      sugerir("corrida", sql`${materiais.corrida}`),
      sugerir("nf", sql`${materiais.nf}`),
      sugerir("aco", sql`${materiais.aco}`),
    ]);

    return grupos.flat();
  } catch (error) {
    handleDbError(error, "sugestoesLinhaDoTempo");
  }
}

/**
 * Checa se uma NF já foi cadastrada antes — usa registros_entrada (imutável),
 * já que materiais pode ter itens editados/baixados desde a importação original.
 */
export async function checkNfDuplicada(nf: string) {
  try {
    if (!nf || !nf.trim()) return { existe: false, totalItens: 0, dataImportacao: null };
    const db = await getDb();
    const rows = await db.select().from(registrosEntrada).where(eq(registrosEntrada.nf, nf.trim()));
    if (rows.length === 0) return { existe: false, totalItens: 0, dataImportacao: null };
    const datas = rows.map(r => new Date(r.dataEntrada).getTime());
    return {
      existe: true,
      totalItens: rows.length,
      dataImportacao: new Date(Math.min(...datas)).toISOString(),
    };
  } catch (error) {
    handleDbError(error, "checkNfDuplicada");
  }
}

/**
 * Checa se já existe um material ATIVO com tipo+bitola+aço+corrida idênticos —
 * sinal forte de cadastro em duplicidade (mesma corrida raramente se repete
 * entre entregas diferentes).
 */
export async function checkMaterialDuplicado(tipo: string, bitola: string, aco: string, corrida?: string, quantidade?: number, local?: string, comprimento?: number) {
  try {
    const db = await getDb();
    const condicoes = [
      eq(materiais.ativo, true),
      eq(materiais.tipo, tipo),
      eq(materiais.bitola, bitola),
      eq(materiais.aco, aco),
    ];
    if (quantidade !== undefined && quantidade !== null) condicoes.push(eq(materiais.quantidade, quantidade));
    if (comprimento !== undefined && comprimento !== null) condicoes.push(eq(materiais.comprimento, comprimento));
    if (local && local.trim()) condicoes.push(eq(materiais.local, local.trim()));
    // Corrida entra na comparação só quando informada nos dois lados — se o
    // item novo não tem corrida, compara só pelos demais campos (é
    // exatamente o caso mais comum de duplicidade real: cadastro repetido
    // sem preencher rastreabilidade).
    if (corrida && corrida.trim()) condicoes.push(eq(materiais.corrida, corrida.trim()));
    const rows = await db.select().from(materiais).where(and(...condicoes)).limit(1);
    if (rows.length === 0) return { existe: false };
    return { existe: true, id: rows[0].id, quantidade: rows[0].quantidade };
  } catch (error) {
    handleDbError(error, "checkMaterialDuplicado");
  }
}

/**
 * Varre todo o estoque ativo em busca de grupos de materiais com tipo+bitola+
 * aço+quantidade+comprimento+local (+corrida, quando preenchida) idênticos —
 * sinal forte de cadastro duplicado que já aconteceu no sistema. Não exige
 * corrida: dois materiais idênticos SEM corrida também contam como
 * duplicados entre si (é o caso mais comum na prática).
 */
export async function listMateriaisDuplicados() {
  try {
    const db = await getDb();
    const todos = await db.select().from(materiais).where(eq(materiais.ativo, true));
    const grupos: Record<string, typeof todos> = {};
    for (const item of todos) {
      const chave = [item.tipo, item.bitola, item.aco, item.quantidade, item.comprimento, item.local || "", (item.corrida || "").trim()].join("|");
      if (!grupos[chave]) grupos[chave] = [];
      grupos[chave].push(item);
    }
    return Object.values(grupos)
      .filter(grupo => grupo.length > 1)
      .map(grupo => ({
        tipo: grupo[0].tipo,
        bitola: grupo[0].bitola,
        aco: grupo[0].aco,
        corrida: grupo[0].corrida,
        quantidade: grupo[0].quantidade,
        comprimento: grupo[0].comprimento,
        local: grupo[0].local,
        ids: grupo.map(m => m.id),
        total: grupo.length,
      }));
  } catch (error) {
    handleDbError(error, "listMateriaisDuplicados");
  }
}

/**
 * Muda a obra ATUAL (alocação) de vários materiais de uma vez — deixando
 * livre (obraId/obraNome null) ou atribuindo a uma obra específica. Não
 * mexe em obraCompraId/obraCompraNome (aquilo é histórico, nunca muda).
 */
export async function mudarObraLote(
  materialIds: number[],
  novaObra: { obraId: number | null; obraNome: string | null },
  usuarioNome: string = "Sistema"
) {
  try {
    const db = await getDb();
    if (materialIds.length === 0) return { atualizados: 0 };

    // Descrições reais (tipo + bitola) pra deixar o log de atividade legível,
    // em vez de listar só os IDs internos.
    const materiaisAfetados = await db.select({
      id: materiais.id,
      tipo: materiais.tipo,
      bitola: materiais.bitola,
    }).from(materiais).where(inArray(materiais.id, materialIds));

    await db.update(materiais)
      .set({
        obraId: novaObra.obraId,
        obraNome: novaObra.obraNome,
        updatedAt: new Date(),
      })
      .where(inArray(materiais.id, materialIds));

    const LIMITE_EXIBIDO = 6;
    const descricoes = materiaisAfetados.map(m => `${m.tipo} ${m.bitola}`);
    const listaDescricoes = descricoes.length > LIMITE_EXIBIDO
      ? `${descricoes.slice(0, LIMITE_EXIBIDO).join(", ")} e mais ${descricoes.length - LIMITE_EXIBIDO}`
      : descricoes.join(", ");

    await registrarAtividade(
      usuarioNome,
      "EDICAO",
      "MATERIAL",
      `Obra alterada em lote para ${novaObra.obraNome || "LIVRE"} — ${materialIds.length} material(is): ${listaDescricoes}.`
    );

    // Entrada individual por material, além da combinada acima — pra cada
    // material ter essa mudança na própria linha do tempo dele, sem alterar
    // o que já aparece no Histórico geral (a combinada continua igual).
    for (const m of materiaisAfetados) {
      await registrarAtividade(
        usuarioNome,
        "EDICAO",
        "MATERIAL",
        `Material ${m.tipo} ${m.bitola}: Obra alterada para "${novaObra.obraNome || "LIVRE"}" (mudança em lote)`,
        undefined,
        m.id
      );
    }

    return { atualizados: materialIds.length };
  } catch (error) {
    handleDbError(error, "mudarObraLote");
  }
}

// ============================================================================
// PEDIDOS DE COMPRA — "Materiais a Chegar" (Fase 1: upload manual do PDF)
// ============================================================================

/**
 * Verifica se já existe um pedido de compra ativo (não cancelado) com esse
 * número — tanto já confirmado (pedidosCompra) quanto ainda aguardando
 * revisão (pedidosCompraFilaRevisao). Um mesmo número de pedido nunca deveria
 * se repetir; quando aparece de novo (normalmente por um e-mail reencaminhado
 * ou reenviado pelo fornecedor), isso costumava criar um pedido duplicado
 * sem que ninguém percebesse.
 */
export async function buscarPedidoDuplicado(numeroPedido: string | null | undefined, ignorarFilaId?: number) {
  if (!numeroPedido || !numeroPedido.trim()) return null;
  const db = await getDb();
  const numero = numeroPedido.trim();

  const [jaConfirmado] = await db.select().from(pedidosCompra)
    .where(and(eq(pedidosCompra.numeroPedido, numero), sql`${pedidosCompra.status} != 'cancelado'`))
    .limit(1);
  if (jaConfirmado) {
    return { origem: "confirmado" as const, id: jaConfirmado.id, fornecedorNome: jaConfirmado.fornecedorNome, createdAt: jaConfirmado.createdAt };
  }

  const pendentes = await db.select().from(pedidosCompraFilaRevisao)
    .where(eq(pedidosCompraFilaRevisao.status, "pendente_revisao"));
  const naFila = pendentes.find(f => {
    if (ignorarFilaId && f.id === ignorarFilaId) return false;
    const numeroExtraido = (f.dadosExtraidos as any)?.cabecalho?.numeroPedido;
    return numeroExtraido && String(numeroExtraido).trim() === numero;
  });
  if (naFila) {
    return { origem: "fila_revisao" as const, id: naFila.id, fornecedorNome: (naFila.dadosExtraidos as any)?.cabecalho?.fornecedorNome, createdAt: naFila.createdAt };
  }

  return null;
}

export async function criarPedidoCompra(dados: any, usuarioNome: string = "Sistema", forcar: boolean = false, ignorarFilaId?: number) {
  try {
    const db = await getDb();

    if (!forcar) {
      const duplicado = await buscarPedidoDuplicado(dados.numeroPedido, ignorarFilaId);
      if (duplicado) {
        const err: any = new Error(
          duplicado.origem === "confirmado"
            ? `Já existe um pedido de compra com o número ${dados.numeroPedido} (fornecedor: ${duplicado.fornecedorNome || "não identificado"}). Confirme se não é duplicidade antes de salvar de novo.`
            : `Já existe um pedido com o número ${dados.numeroPedido} aguardando revisão na fila. Confirme se não é duplicidade.`
        );
        err.codigo = "PEDIDO_DUPLICADO";
        throw err;
      }
    }

    const [result] = await db.insert(pedidosCompra).values({
      numeroPedido: dados.numeroPedido,
      processoNumero: dados.processoNumero || null,
      obraNome: dados.obraNome || null,
      fornecedorNome: dados.fornecedorNome || null,
      fornecedorCnpj: dados.fornecedorCnpj || null,
      dataEmissao: dados.dataEmissao || null,
      dataEntregaPrevista: dados.dataEntregaPrevista || null,
      condPagamento: dados.condPagamento || null,
      cotacao: dados.cotacao || null,
      valorTotalPedido: dados.valorTotalPedido != null ? String(dados.valorTotalPedido) : null,
      usuarioNome,
    });
    const pedidoId = (result as any)?.insertId;

    for (const item of dados.itens || []) {
      await db.insert(itensPedidoCompra).values({
        pedidoCompraId: pedidoId,
        codigo: item.codigo || null,
        descricaoOriginal: item.descricaoOriginal || null,
        categoria: item.categoria || "PERFIL",
        tipo: item.tipo || null,
        bitola: item.bitola || null,
        aco: item.aco || null,
        comprimento: item.comprimento || null,
        quantidadePecas: item.quantidadePecas || null,
        unidade: item.unidade || null,
        pesoTotal: item.pesoTotal != null ? String(item.pesoTotal) : null,
        valorUnitario: item.valorUnitario != null ? String(item.valorUnitario) : null,
        valorTotalItem: item.valorTotalItem != null ? String(item.valorTotalItem) : null,
      });
    }

    await registrarAtividade(
      usuarioNome,
      "CADASTRO",
      "PEDIDO_COMPRA",
      `Pedido de Compra ${dados.numeroPedido} cadastrado — ${dados.fornecedorNome || "fornecedor não identificado"}, ${(dados.itens || []).length} item(ns).`
    );

    return { id: pedidoId };
  } catch (error: any) {
    if (error?.codigo === "PEDIDO_DUPLICADO") throw error;
    handleDbError(error, "criarPedidoCompra");
  }
}

export async function listPedidosCompra() {
  try {
    const db = await getDb();
    const pedidos = await db.select().from(pedidosCompra).orderBy(desc(pedidosCompra.createdAt));
    const resultado = [];
    for (const p of pedidos) {
      const itens = await db.select().from(itensPedidoCompra).where(eq(itensPedidoCompra.pedidoCompraId, p.id));
      const itensComEntregas = [];
      for (const item of itens) {
        const entregas = await db.select().from(entregasItemPedidoCompra).where(eq(entregasItemPedidoCompra.itemPedidoCompraId, item.id));
        itensComEntregas.push({ ...item, entregas });
      }
      resultado.push({ ...p, itens: itensComEntregas });
    }
    return resultado;
  } catch (error) {
    handleDbError(error, "listPedidosCompra");
  }
}

export async function cancelarPedidoCompra(id: number, usuarioNome: string = "Sistema") {
  try {
    const db = await getDb();
    await db.update(pedidosCompra).set({ status: "cancelado", updatedAt: new Date() }).where(eq(pedidosCompra.id, id));
    await registrarAtividade(usuarioNome, "EDICAO", "PEDIDO_COMPRA", `Pedido de Compra #${id} cancelado.`);
    return { ok: true };
  } catch (error) {
    handleDbError(error, "cancelarPedidoCompra");
  }
}

// ============================================================================
// LEITURA AUTOMÁTICA DE PEDIDOS POR E-MAIL (Fase 2)
// ============================================================================

export async function listFornecedoresPedidosEmail() {
  try {
    const db = await getDb();
    return await db.select().from(fornecedoresPedidosEmail).orderBy(desc(fornecedoresPedidosEmail.createdAt));
  } catch (error) {
    handleDbError(error, "listFornecedoresPedidosEmail");
  }
}

export async function criarFornecedorPedidoEmail(nome: string, emails: string, usuarioNome: string = "Sistema") {
  try {
    const db = await getDb();
    await db.insert(fornecedoresPedidosEmail).values({ nome, emails });
    await registrarAtividade(usuarioNome, "CADASTRO", "FORNECEDOR_PEDIDO_EMAIL", `Fornecedor "${nome}" adicionado à leitura automática de pedidos.`);
    return { ok: true };
  } catch (error) {
    handleDbError(error, "criarFornecedorPedidoEmail");
  }
}

export async function atualizarFornecedorPedidoEmail(id: number, dados: { nome?: string; emails?: string; ativo?: boolean }) {
  try {
    const db = await getDb();
    await db.update(fornecedoresPedidosEmail).set(dados).where(eq(fornecedoresPedidosEmail.id, id));
    return { ok: true };
  } catch (error) {
    handleDbError(error, "atualizarFornecedorPedidoEmail");
  }
}

export async function excluirFornecedorPedidoEmail(id: number) {
  try {
    const db = await getDb();
    await db.delete(fornecedoresPedidosEmail).where(eq(fornecedoresPedidosEmail.id, id));
    return { ok: true };
  } catch (error) {
    handleDbError(error, "excluirFornecedorPedidoEmail");
  }
}

export async function listFilaRevisaoPedidos() {
  try {
    const db = await getDb();
    return await db.select().from(pedidosCompraFilaRevisao)
      .where(eq(pedidosCompraFilaRevisao.status, "pendente_revisao"))
      .orderBy(desc(pedidosCompraFilaRevisao.createdAt));
  } catch (error) {
    handleDbError(error, "listFilaRevisaoPedidos");
  }
}

export async function rejeitarFilaRevisaoPedido(id: number, usuarioNome: string = "Sistema") {
  try {
    const db = await getDb();
    await db.update(pedidosCompraFilaRevisao).set({ status: "rejeitado" }).where(eq(pedidosCompraFilaRevisao.id, id));
    await registrarAtividade(usuarioNome, "EDICAO", "PEDIDO_COMPRA", `Item da fila de revisão #${id} rejeitado (não é um pedido de matéria-prima válido).`);
    return { ok: true };
  } catch (error) {
    handleDbError(error, "rejeitarFilaRevisaoPedido");
  }
}

/**
 * Marca um item da fila como confirmado — chamado logo depois do usuário
 * salvar o pedido de verdade (via criarPedidoCompra) a partir da revisão.
 * Não cria o pedido em si; isso já é feito pelo fluxo normal de upload.
 */
export async function confirmarFilaRevisaoPedido(id: number) {
  try {
    const db = await getDb();
    await db.update(pedidosCompraFilaRevisao).set({ status: "confirmado" }).where(eq(pedidosCompraFilaRevisao.id, id));
    return { ok: true };
  } catch (error) {
    handleDbError(error, "confirmarFilaRevisaoPedido");
  }
}

/**
 * Roda a varredura de e-mail e grava tudo que for encontrado — chamada
 * pelo cron job. Nunca lança erro pra fora (efeito colateral, igual ao
 * backup automático): se o Gmail não estiver configurado ainda, ou algo
 * falhar no meio do caminho, só loga e segue a vida.
 */
export async function executarVarreduraEmailPedidos(): Promise<{
  ok: boolean;
  configurado: boolean;
  mensagem: string;
  emailsAnalisados?: number;
  novosNaFila?: number;
  ignorados?: number;
  erros?: number;
}> {
  try {
    const db = await getDb();
    // A lista de fornecedores cadastrados continua valendo como sinal forte
    // de match, mas não é mais obrigatória — varrerEmailsPedidos também
    // reconhece pedido enviado a fornecedor externo pelo padrão do assunto
    // (ver pareceSerPedidoParaFornecedorExterno), então a varredura roda
    // mesmo sem nenhum fornecedor cadastrado ainda.
    const fornecedores = await db.select().from(fornecedoresPedidosEmail).where(eq(fornecedoresPedidosEmail.ativo, true));
    const todosEmails = fornecedores.flatMap(f => f.emails.split(",").map(e => e.trim()).filter(Boolean));

    const jaProcessadosRows = await db.select({ id: emailsPedidoProcessados.gmailMessageId }).from(emailsPedidoProcessados);
    const jaProcessados = new Set(jaProcessadosRows.map(r => r.id));

    const { varrerEmailsPedidos } = await import("./gmailPedidos.service");
    const resultado = await varrerEmailsPedidos(todosEmails, jaProcessados);
    if (!resultado) {
      return { ok: true, configurado: false, mensagem: "Credenciais do Gmail (GMAIL_PEDIDOS_*) não configuradas ainda." };
    }

    for (const item of resultado.filaParaSalvar) {
      const numeroPedido = (item.dadosExtraidos as any)?.cabecalho?.numeroPedido;
      const duplicado = await buscarPedidoDuplicado(numeroPedido).catch(() => null);

      await db.insert(pedidosCompraFilaRevisao).values({
        gmailMessageId: item.gmailMessageId,
        remetente: item.remetente,
        nomeArquivoOriginal: item.nomeArquivoOriginal,
        dadosExtraidos: item.dadosExtraidos,
        possivelDuplicado: !!duplicado,
        duplicadoDetalhe: duplicado
          ? (duplicado.origem === "confirmado"
              ? `Já existe o pedido ${numeroPedido} cadastrado (fornecedor: ${duplicado.fornecedorNome || "não identificado"}).`
              : `Já existe o pedido ${numeroPedido} aguardando revisão na fila.`)
          : null,
      });
      await db.insert(emailsPedidoProcessados).values({
        gmailMessageId: item.gmailMessageId,
        remetente: item.remetente,
        resultado: "fila_revisao",
      }).catch(() => {}); // pode já existir se o e-mail tinha mais de 1 PDF — ok ignorar duplicata
    }

    // Marca também as mensagens descartadas (sem match, sem PDF relevante,
    // sem item de matéria-prima) — senão o robô fica reanalisando o mesmo
    // e-mail pra sempre a cada 20min, já que elas nunca entravam aqui antes.
    for (const item of resultado.ignoradosParaMarcar) {
      await db.insert(emailsPedidoProcessados).values({
        gmailMessageId: item.gmailMessageId,
        remetente: item.remetente,
        resultado: "ignorado",
        detalhes: item.motivo,
      }).catch(() => {});
    }

    const mensagem = `${resultado.emailsAnalisados} e-mail(is) analisado(s) — ${resultado.novosNaFila} novo(s) na fila, ${resultado.ignorados} ignorado(s), ${resultado.erros} erro(s).`;
    console.log(`[GmailPedidos] Varredura concluída: ${mensagem}`);

    return {
      ok: true,
      configurado: true,
      mensagem,
      emailsAnalisados: resultado.emailsAnalisados,
      novosNaFila: resultado.novosNaFila,
      ignorados: resultado.ignorados,
      erros: resultado.erros,
    };
  } catch (error) {
    console.error("[GmailPedidos] Falha na varredura automática:", error);
    const msgErro = (error as any)?.message || "Erro inesperado na varredura.";
    // "invalid_grant" sozinho não diz nada pra quem está na tela — é o Google
    // avisando que o refresh token expirou ou foi revogado.
    if (/invalid_grant/i.test(msgErro)) {
      return {
        ok: false,
        configurado: true,
        mensagem: "A autorização do Gmail expirou ou foi revogada — a leitura automática está parada. É preciso gerar um novo token (autorizar-gmail-pedidos.mjs) e atualizar GMAIL_PEDIDOS_REFRESH_TOKEN na Railway.",
      };
    }
    return { ok: false, configurado: true, mensagem: msgErro };
  }
}


// fecha o item sozinho, sem pedir nada pro usuário. Só quando a diferença
// passa disso é que vira uma decisão manual (encerrar com justificativa).
const TOLERANCIA_PADRAO_PEDIDO_COMPRA = 0.05;

async function recalcularStatusPedidoCompra(pedidoCompraId: number) {
  const db = await getDb();
  const itens = await db.select().from(itensPedidoCompra).where(eq(itensPedidoCompra.pedidoCompraId, pedidoCompraId));
  if (itens.length === 0) return;

  const todosCompletos = itens.every(i => i.statusItem === "completo");
  const algumProgresso = itens.some(i => i.statusItem !== "pendente");
  const novoStatus = todosCompletos ? "recebido" : algumProgresso ? "parcial" : "pendente";

  const [pedido] = await db.select().from(pedidosCompra).where(eq(pedidosCompra.id, pedidoCompraId)).limit(1);
  if (pedido && novoStatus !== pedido.status) {
    await db.update(pedidosCompra).set({ status: novoStatus, updatedAt: new Date() }).where(eq(pedidosCompra.id, pedidoCompraId));
  }
}

/**
 * Núcleo compartilhado: registra uma entrega (automática ou manual) contra
 * um item de pedido de compra já identificado — soma na quantidadeRecebida,
 * decide o novo statusItem (mesma margem de tolerância de sempre) e
 * recalcula o status do pedido como um todo. Usado tanto pelo cruzamento
 * automático (cruzarPedidoCompraComEntrada) quanto pela confirmação manual
 * (confirmarRecebimentoManual).
 */
async function registrarEntregaItemPedido(
  itemCompativel: typeof itensPedidoCompra.$inferSelect,
  quantidade: number,
  materialId: number | null
) {
  const db = await getDb();
  const novaQuantidadeRecebida = itemCompativel.quantidadeRecebida + (quantidade || 0);

  await db.insert(entregasItemPedidoCompra).values({
    itemPedidoCompraId: itemCompativel.id,
    materialId,
    quantidade: quantidade || 0,
  });

  const pedida = itemCompativel.quantidadePecas || 0;
  let novoStatusItem: "pendente" | "parcial" | "completo" = "parcial";
  if (pedida > 0) {
    const faltando = pedida - novaQuantidadeRecebida;
    const dentroDaTolerancia = faltando <= pedida * TOLERANCIA_PADRAO_PEDIDO_COMPRA;
    if (novaQuantidadeRecebida >= pedida || dentroDaTolerancia) {
      novoStatusItem = "completo";
    }
  }

  await db.update(itensPedidoCompra)
    .set({ quantidadeRecebida: novaQuantidadeRecebida, statusItem: novoStatusItem })
    .where(eq(itensPedidoCompra.id, itemCompativel.id));

  await recalcularStatusPedidoCompra(itemCompativel.pedidoCompraId);

  return { quantidadeRecebida: novaQuantidadeRecebida, statusItem: novoStatusItem };
}

/**
 * Cruza um numeroPedido recém-cadastrado num material (via NF-e ou cadastro
 * manual) com os Pedidos de Compra em aberto — acumula a quantidade no item
 * compatível (mesmo tipo+bitola+aço), já que um pedido pode chegar em
 * várias entregas/NF-e diferentes ao longo do tempo. Fecha o item sozinho
 * se a quantidade acumulada bater dentro da margem de tolerância; senão
 * deixa como "parcial", aguardando mais entregas ou fechamento manual.
 * É uma função de efeito colateral: se falhar, NUNCA deve interromper o
 * cadastro do material em si — por isso é sempre chamada dentro de um
 * try/catch que só loga o erro, nunca propaga. Retorna um resultado
 * (em vez de void) só pra dar feedback não-bloqueante pro usuário no
 * cadastro — nunca é motivo de erro na tela.
 */
export async function cruzarPedidoCompraComEntrada(
  numeroPedido: string,
  tipo: string,
  bitola: string,
  aco: string,
  quantidadePecas: number,
  materialId?: number
): Promise<{ vinculado: boolean; motivo?: string }> {
  try {
    if (!numeroPedido) return { vinculado: false };
    const db = await getDb();
    const [pedido] = await db.select().from(pedidosCompra)
      .where(and(eq(pedidosCompra.numeroPedido, numeroPedido), sql`${pedidosCompra.status} != 'cancelado'`))
      .limit(1);
    if (!pedido) return { vinculado: false, motivo: `Nenhum pedido em aberto encontrado com o número "${numeroPedido}".` };

    const itens = await db.select().from(itensPedidoCompra).where(eq(itensPedidoCompra.pedidoCompraId, pedido.id));
    const itemCompativel = itens.find(i =>
      i.statusItem !== "completo" &&
      (i.tipo || "").toUpperCase() === (tipo || "").toUpperCase() &&
      (i.bitola || "").toUpperCase() === (bitola || "").toUpperCase() &&
      (i.aco || "").toUpperCase() === (aco || "").toUpperCase()
    );
    if (!itemCompativel) {
      return { vinculado: false, motivo: `Pedido "${numeroPedido}" encontrado, mas nenhum item em aberto bate com ${tipo} ${bitola} (${aco}) — confira se o tipo/bitola/aço estão exatamente iguais ao pedido, ou confirme manualmente em Materiais a Chegar.` };
    }

    await registrarEntregaItemPedido(itemCompativel, quantidadePecas, materialId ?? null);
    return { vinculado: true };
  } catch (error) {
    console.error("[PedidoCompra] Falha ao cruzar com entrada (não bloqueia o cadastro):", error);
    return { vinculado: false };
  }
}

/**
 * Confirmação manual de recebimento — usada quando o cruzamento automático
 * (por número de pedido + tipo/bitola/aço) não achou o item, ou quando o
 * material nem chegou a ser recadastrado individualmente (ex: chegou junto
 * de outro item na mesma entrega física). Soma a quantidade informada
 * diretamente no item escolhido pelo usuário, sem depender de match nenhum.
 */
export async function confirmarRecebimentoManual(itemId: number, quantidade: number, usuarioNome: string = "Sistema") {
  try {
    if (!quantidade || quantidade <= 0) throw new Error("Informe uma quantidade recebida maior que zero.");
    const db = await getDb();
    const [item] = await db.select().from(itensPedidoCompra).where(eq(itensPedidoCompra.id, itemId)).limit(1);
    if (!item) throw new Error("Item não encontrado.");
    if (item.statusItem === "completo") throw new Error("Esse item já está marcado como completo.");

    const resultado = await registrarEntregaItemPedido(item, quantidade, null);

    await registrarAtividade(
      usuarioNome,
      "EDICAO",
      "PEDIDO_COMPRA",
      `Recebimento confirmado manualmente pra ${item.tipo} ${item.bitola}: +${quantidade} (total ${resultado.quantidadeRecebida}/${item.quantidadePecas || "?"}).`
    );

    return resultado;
  } catch (error) {
    handleDbError(error, "confirmarRecebimentoManual");
  }
}

function statusItemPelaQuantidade(pedida: number, recebida: number): "pendente" | "parcial" | "completo" {
  if (recebida <= 0) return "pendente";
  if (pedida > 0 && (recebida >= pedida || pedida - recebida <= pedida * TOLERANCIA_PADRAO_PEDIDO_COMPRA)) return "completo";
  return "parcial";
}

/**
 * Correção de um pedido de compra já cadastrado (só administrador — ver
 * routers.ts): dados do cabeçalho, dados dos itens e, principalmente, a
 * quantidade recebida — é o que permite desfazer um recebimento marcado
 * por engano. Mudar a quantidade recebida refaz o status do item do zero
 * (inclusive reabrindo item que tinha sido encerrado manualmente) e troca o
 * histórico de entregas dele por um lançamento único com o valor corrigido.
 */
export async function editarPedidoCompra(
  id: number,
  dados: {
    numeroPedido?: string;
    fornecedorNome?: string;
    obraNome?: string;
    dataEntregaPrevista?: string;
    itens?: Array<{
      id: number;
      tipo?: string; bitola?: string; aco?: string;
      comprimento?: number | null; quantidadePecas?: number | null;
      pesoTotal?: number | null; valorUnitario?: number | null;
      quantidadeRecebida?: number;
      reabrir?: boolean;
    }>;
  },
  usuarioNome: string = "Sistema"
) {
  try {
    const db = await getDb();
    const [pedido] = await db.select().from(pedidosCompra).where(eq(pedidosCompra.id, id)).limit(1);
    if (!pedido) throw new Error("Pedido não encontrado.");

    const cabecalho: Record<string, any> = {};
    if (dados.numeroPedido !== undefined) {
      if (!dados.numeroPedido.trim()) throw new Error("O número do pedido não pode ficar vazio.");
      cabecalho.numeroPedido = dados.numeroPedido.trim();
    }
    if (dados.fornecedorNome !== undefined) cabecalho.fornecedorNome = dados.fornecedorNome.trim() || null;
    if (dados.obraNome !== undefined) cabecalho.obraNome = dados.obraNome.trim() || null;
    if (dados.dataEntregaPrevista !== undefined) cabecalho.dataEntregaPrevista = dados.dataEntregaPrevista.trim() || null;
    if (Object.keys(cabecalho).length > 0) {
      await db.update(pedidosCompra).set({ ...cabecalho, updatedAt: new Date() }).where(eq(pedidosCompra.id, id));
    }

    const itensAtuais = await db.select().from(itensPedidoCompra).where(eq(itensPedidoCompra.pedidoCompraId, id));
    const correcoes: string[] = [];
    for (const edicao of dados.itens || []) {
      const atual = itensAtuais.find(i => i.id === edicao.id);
      if (!atual) throw new Error("Um dos itens não pertence a esse pedido.");

      const mudanca: Record<string, any> = {};
      if (edicao.tipo !== undefined) mudanca.tipo = edicao.tipo.trim() || null;
      if (edicao.bitola !== undefined) mudanca.bitola = edicao.bitola.trim() || null;
      if (edicao.aco !== undefined) mudanca.aco = edicao.aco.trim() || null;
      if (edicao.comprimento !== undefined) mudanca.comprimento = edicao.comprimento || null;
      if (edicao.quantidadePecas !== undefined) mudanca.quantidadePecas = edicao.quantidadePecas || null;
      if (edicao.pesoTotal !== undefined) mudanca.pesoTotal = edicao.pesoTotal != null ? String(edicao.pesoTotal) : null;
      if (edicao.valorUnitario !== undefined) mudanca.valorUnitario = edicao.valorUnitario != null ? String(edicao.valorUnitario) : null;

      const pedida = edicao.quantidadePecas !== undefined ? (edicao.quantidadePecas || 0) : (atual.quantidadePecas || 0);
      const recebida = edicao.quantidadeRecebida !== undefined ? Math.max(0, Math.floor(edicao.quantidadeRecebida)) : atual.quantidadeRecebida;
      // "reabrir" cobre o item encerrado manualmente sem ter recebido nada: a
      // quantidade não muda (0 → 0), mas ele precisa voltar a ficar em aberto.
      const mudouRecebido = recebida !== atual.quantidadeRecebida || (!!edicao.reabrir && atual.statusItem === "completo");
      const mudouPedido = pedida !== (atual.quantidadePecas || 0);

      if (mudouRecebido) {
        await db.delete(entregasItemPedidoCompra).where(eq(entregasItemPedidoCompra.itemPedidoCompraId, atual.id));
        if (recebida > 0) {
          await db.insert(entregasItemPedidoCompra).values({ itemPedidoCompraId: atual.id, materialId: null, quantidade: recebida });
        }
        mudanca.quantidadeRecebida = recebida;
        mudanca.statusItem = statusItemPelaQuantidade(pedida, recebida);
        mudanca.encerradoManualmente = false;
        mudanca.justificativaDivergencia = null;
        correcoes.push(`${atual.tipo || ""} ${atual.bitola || ""}: recebido ${atual.quantidadeRecebida} → ${recebida}`.trim());
      } else if (mudouPedido && !atual.encerradoManualmente) {
        mudanca.statusItem = statusItemPelaQuantidade(pedida, recebida);
      }

      if (Object.keys(mudanca).length > 0) {
        await db.update(itensPedidoCompra).set(mudanca).where(eq(itensPedidoCompra.id, atual.id));
      }
    }

    // Pedido cancelado continua cancelado — pra voltar com ele existe reabrirPedidoCompra.
    if (pedido.status !== "cancelado") await recalcularStatusPedidoCompra(id);

    await registrarAtividade(
      usuarioNome,
      "EDICAO",
      "PEDIDO_COMPRA",
      `Pedido de Compra ${cabecalho.numeroPedido || pedido.numeroPedido} editado` + (correcoes.length ? ` — ${correcoes.join("; ")}` : "") + "."
    );
    return { ok: true };
  } catch (error) {
    handleDbError(error, "editarPedidoCompra");
  }
}

/** Desfaz o cancelamento de um pedido (só administrador) — o status volta a refletir o que já foi recebido. */
export async function reabrirPedidoCompra(id: number, usuarioNome: string = "Sistema") {
  try {
    const db = await getDb();
    const [pedido] = await db.select().from(pedidosCompra).where(eq(pedidosCompra.id, id)).limit(1);
    if (!pedido) throw new Error("Pedido não encontrado.");
    if (pedido.status !== "cancelado") throw new Error("Esse pedido não está cancelado.");

    await db.update(pedidosCompra).set({ status: "pendente", updatedAt: new Date() }).where(eq(pedidosCompra.id, id));
    await recalcularStatusPedidoCompra(id);
    await registrarAtividade(usuarioNome, "EDICAO", "PEDIDO_COMPRA", `Pedido de Compra ${pedido.numeroPedido} reaberto (cancelamento desfeito).`);
    return { ok: true };
  } catch (error) {
    handleDbError(error, "reabrirPedidoCompra");
  }
}

/**
 * Encerra um item manualmente — "não vai chegar mais nada disso". Se a
 * diferença entre pedido e recebido passar da margem de tolerância, exige
 * uma justificativa (não deixa fechar sem explicação nesse caso).
 */
export async function encerrarItemPedidoCompra(itemId: number, justificativa: string | undefined, usuarioNome: string = "Sistema") {
  try {
    const db = await getDb();
    const [item] = await db.select().from(itensPedidoCompra).where(eq(itensPedidoCompra.id, itemId)).limit(1);
    if (!item) throw new Error("Item não encontrado.");

    const pedida = item.quantidadePecas || 0;
    const faltando = pedida - item.quantidadeRecebida;
    const dentroDaTolerancia = pedida === 0 || faltando <= pedida * TOLERANCIA_PADRAO_PEDIDO_COMPRA;

    if (!dentroDaTolerancia && !justificativa?.trim()) {
      throw new Error(
        `A diferença entre o pedido (${pedida}) e o recebido (${item.quantidadeRecebida}) passa da margem de 5% — ` +
        `escreva uma justificativa explicando se isso é aceitável ou se tem algo errado antes de encerrar.`
      );
    }

    await db.update(itensPedidoCompra)
      .set({
        statusItem: "completo",
        encerradoManualmente: true,
        justificativaDivergencia: justificativa?.trim() || null,
      })
      .where(eq(itensPedidoCompra.id, itemId));

    await recalcularStatusPedidoCompra(item.pedidoCompraId);

    await registrarAtividade(
      usuarioNome,
      "EDICAO",
      "PEDIDO_COMPRA",
      `Item ${item.tipo} ${item.bitola} encerrado manualmente (pedido: ${pedida}, recebido: ${item.quantidadeRecebida})` +
      (justificativa ? ` — ${justificativa}` : "")
    );

    return { ok: true };
  } catch (error) {
    handleDbError(error, "encerrarItemPedidoCompra");
  }
}


export async function createMaterial(data: any, usuarioNome: string = "Sistema") {
  const db = await getDb();
  
  // Buscar peso automático se for 0.000 ou se não for enviado
  let pesoFinal = data.pesoTotal || "0.000";
  const categoria = data.categoria || "PERFIL";
  
  if (pesoFinal === "0.000") {
    const specs = await db.select()
      .from(especificacoesMateriais)
      .where(and(
        eq(especificacoesMateriais.tipo, data.tipo.trim().toUpperCase()),
        eq(especificacoesMateriais.bitola, data.bitola.trim().toUpperCase()),
        eq(especificacoesMateriais.aco, data.aco.trim().toUpperCase()),
        eq(especificacoesMateriais.categoria, categoria),
        eq(especificacoesMateriais.ativo, true)
      ))
      .limit(1);

    if (specs.length > 0) {
      const pesoBase = parseFloat(String(specs[0].pesoPorMetro).replace(',', '.'));
      const comprimentoM = (parseFloat(String(data.comprimento)) || 0) / 1000;
      const qtd = parseInt(String(data.quantidade)) || 1;
      
      if (categoria === "CHAPA") {
        const larguraM = (parseFloat(String(data.largura)) || 0) / 1000;
        pesoFinal = (pesoBase * larguraM * comprimentoM * qtd).toFixed(3);
      } else {
        pesoFinal = (pesoBase * comprimentoM * qtd).toFixed(3);
      }
    } else {
      pesoFinal = "0.000"; 
    }
  }

  const insertData: any = {
    tipo: data.tipo,
    bitola: data.bitola,
    quantidade: data.quantidade,
    comprimento: data.comprimento,
    largura: data.largura || 0,
    categoria: categoria,
    pesoTotal: pesoFinal || "0.000",
    aco: data.aco,
    obraId: data.obraId || null,
    obraNome: data.obraNome || null,
    obraCompraId: data.obraCompraId || null,
    obraCompraNome: data.obraCompraNome || null,
    local: data.local || null,
    fornecedor: data.fornecedor || null,
    nf: data.nf || null,
    numero_certificado: data.numeroCertificado || data.numero_certificado || null,
    corrida: data.corrida || null,
    estoqueMinimo: data.estoqueMinimo ? String(data.estoqueMinimo) : "50.00",
    etiquetaImpressa: false,
    observacoes: data.observacoes || null,
    numeroPedido: data.numeroPedido || null,
  };

  const [result] = await db.insert(materiais).values(insertData);

  // Registro de entrada — retrato imutável do momento do cadastro, separado
  // da tabela materiais (que pode mudar depois com edições/baixas).
  await db.insert(registrosEntrada).values({
    tipo: insertData.tipo,
    bitola: insertData.bitola,
    quantidade: insertData.quantidade,
    comprimento: insertData.comprimento,
    largura: insertData.largura,
    categoria: insertData.categoria,
    pesoTotal: insertData.pesoTotal,
    aco: insertData.aco,
    obraNome: insertData.obraNome,
    obraCompraNome: insertData.obraCompraNome,
    local: insertData.local,
    fornecedor: insertData.fornecedor,
    nf: insertData.nf,
    numero_certificado: insertData.numero_certificado,
    corrida: insertData.corrida,
    numeroPedido: insertData.numeroPedido,
    usuarioNome: usuarioNome,
    materialId: (result as any)?.insertId ?? null,
  });

  // Registrar atividade
  await registrarAtividade(
    usuarioNome,
    "CADASTRO",
    "MATERIAL",
    `Novo material cadastrado: ${data.tipo} ${data.bitola} (${data.quantidade} un., Obra: ${data.obraNome || "LIVRE"})`
  );

  // Cruza com Pedidos de Compra em aberto, se tiver número de pedido — nunca
  // bloqueia o cadastro em si (a função já engole os próprios erros). O
  // resultado vai junto na resposta só pra dar feedback não-bloqueante
  // (toast) pro usuário — nunca impede nem desfaz o cadastro do material.
  const pedidoMatch = insertData.numeroPedido
    ? await cruzarPedidoCompraComEntrada(
        insertData.numeroPedido, data.tipo, data.bitola, data.aco,
        data.quantidade, (result as any)?.insertId
      )
    : null;

  return { ...result, pedidoMatch };
}

export async function updateMaterial(id: number, data: any, usuarioNome: string = "Sistema") {
  const db = await getDb();
  
  // Buscar o material atual para comparação granular
  const current = await db.select().from(materiais).where(eq(materiais.id, id)).limit(1);
  if (!current.length) throw new Error("Material não encontrado");
  const materialAtual = current[0];
  
  // Mapear campos camelCase para snake_case e remover campos que não existem no banco
  const updateData: any = {
    tipo: data.tipo,
    bitola: data.bitola,
    quantidade: data.quantidade,
    comprimento: data.comprimento,
    pesoTotal: data.pesoTotal,
    aco: data.aco,
    obraId: data.obraId,
    obraNome: data.obraNome,
    obraCompraId: data.obraCompraId,
    obraCompraNome: data.obraCompraNome,
    local: data.local,
    fornecedor: data.fornecedor,
    nf: data.nf,
    numero_certificado: data.numeroCertificado || data.numero_certificado || undefined,
    corrida: data.corrida,
    estoqueMinimo: data.estoqueMinimo !== undefined ? String(data.estoqueMinimo) : undefined,
    largura: data.largura,
    categoria: data.categoria,
    etiqueta_impressa: data.etiquetaImpressa,
    data_impressao_etiqueta: data.dataImpressaoEtiqueta,
    observacoes: data.observacoes,
    numeroPedido: data.numeroPedido,
    updatedAt: new Date()
  };

  // Remover campos undefined para não sobrescrever com null se não enviado
  Object.keys(updateData).forEach(key => updateData[key] === undefined && delete updateData[key]);

  const result = await db.update(materiais).set(updateData).where(eq(materiais.id, id));

  // Registrar atividades granulares para cada campo alterado
  const mudancas: string[] = [];
  
  if (data.tipo !== undefined && data.tipo !== materialAtual.tipo) {
    mudancas.push(`Tipo alterado de "${materialAtual.tipo}" para "${data.tipo}"`);
  }
  if (data.bitola !== undefined && data.bitola !== materialAtual.bitola) {
    mudancas.push(`Bitola alterada de "${materialAtual.bitola}" para "${data.bitola}"`);
  }
  if (data.quantidade !== undefined && data.quantidade !== materialAtual.quantidade) {
    mudancas.push(`Quantidade alterada de ${materialAtual.quantidade} para ${data.quantidade}`);
  }
  if (data.comprimento !== undefined && data.comprimento !== materialAtual.comprimento) {
    mudancas.push(`Comprimento alterado de ${materialAtual.comprimento}mm para ${data.comprimento}mm`);
  }
  if (data.pesoTotal !== undefined && data.pesoTotal !== materialAtual.pesoTotal) {
    mudancas.push(`Peso total alterado de ${materialAtual.pesoTotal}kg para ${data.pesoTotal}kg`);
  }
  if (data.aco !== undefined && data.aco !== materialAtual.aco) {
    mudancas.push(`Aço alterado de "${materialAtual.aco}" para "${data.aco}"`);
  }
  if (data.obraNome !== undefined && data.obraNome !== materialAtual.obraNome) {
    mudancas.push(`Obra alterada de "${materialAtual.obraNome || "LIVRE"}" para "${data.obraNome || "LIVRE"}"`);
  }
  if (data.local !== undefined && data.local !== materialAtual.local) {
    mudancas.push(`Local alterado de "${materialAtual.local || "ESTOQUE"}" para "${data.local}"`);
  }
  if (data.fornecedor !== undefined && data.fornecedor !== materialAtual.fornecedor) {
    mudancas.push(`Fornecedor alterado de "${materialAtual.fornecedor || "-"}" para "${data.fornecedor}"`);
  }
  if (data.nf !== undefined && data.nf !== materialAtual.nf) {
    mudancas.push(`NF alterada de "${materialAtual.nf || "-"}" para "${data.nf}"`);
  }
  if (data.numeroCertificado !== undefined && data.numeroCertificado !== materialAtual.numero_certificado) {
    mudancas.push(`Número de certificado alterado de "${materialAtual.numero_certificado || "-"}" para "${data.numeroCertificado}"`);
  }
  if (data.corrida !== undefined && data.corrida !== materialAtual.corrida) {
    mudancas.push(`Corrida alterada de "${materialAtual.corrida || "-"}" para "${data.corrida}"`);
  }

  // Registrar cada mudança individualmente
  if (mudancas.length > 0) {
    // Usar tipo+bitola como identificador legível; fallback para ID se campos ausentes
    const tipoBitola = materialAtual.tipo && materialAtual.bitola
      ? `${materialAtual.tipo} ${materialAtual.bitola}`
      : `ID ${id}`;
    for (const mudanca of mudancas) {
      await registrarAtividade(
        usuarioNome,
        "EDICAO",
        "MATERIAL",
        `Material ${tipoBitola}: ${mudanca}`,
        undefined,
        id
      );
    }
  }

  return result;
}

export async function deleteMaterial(id: number, usuarioNome: string = "Sistema") {
  const db = await getDb();
  const atual = await db.select().from(materiais).where(eq(materiais.id, id)).limit(1);
  const result = await db.update(materiais).set({ ativo: false }).where(eq(materiais.id, id));
  
  // Registrar atividade
  const desc = atual.length > 0 ? `Material (${atual[0].tipo} ${atual[0].bitola}) foi marcado como inativo (excluído)` : `Material foi marcado como inativo (excluído)`;
  await registrarAtividade(
    usuarioNome,
    "EXCLUSAO",
    "MATERIAL",
    desc
  );
  
  return result;
}

/**
 * Hard delete de materiais em lote — exclusivo para owner.
 * Remove permanentemente os registros da tabela materiais.
 * Retorna quantos foram deletados.
 */
export async function hardDeleteMateriais(
  ids: number[],
  ownerNome: string
): Promise<{ deletados: number }> {
  if (ids.length === 0) return { deletados: 0 };
  const db = await getDb();

  // Apaga primeiro os registros em outras tabelas que referenciam esses materiais
  // (chave estrangeira) — senão o DELETE em `materiais` falha com erro de FK.
  // Lista checada direto no banco (information_schema.KEY_COLUMN_USAGE) — eram
  // 8 tabelas com FK pra materiais.id, e só 5 estavam sendo limpas aqui, por
  // isso o hard delete em lote quebrava com "grd_materiais", "historico_atividades"
  // ou "relatorio_recebimento_materiais" com registros pendentes.
  await db.delete(ajustesInventario).where(inArray(ajustesInventario.materialId, ids));
  await db.delete(itensInventario).where(inArray(itensInventario.materialId, ids));
  await db.delete(itensSolicitacao).where(inArray(itensSolicitacao.materialId, ids));
  await db.delete(lotes).where(inArray(lotes.materialId, ids));
  await db.delete(estoque).where(inArray(estoque.materialId, ids));
  await db.delete(grdMateriais).where(inArray(grdMateriais.materialId, ids));
  await db.delete(relatorioRecebimentoMateriais).where(inArray(relatorioRecebimentoMateriais.materialId, ids));
  // historico_atividades.material_id é opcional (auditoria geral, não só de
  // material) — em vez de apagar o log, só desvincula o material removido,
  // preservando o histórico (que já tem a descrição em texto).
  await db.update(historicoAtividades).set({ materialId: null }).where(inArray(historicoAtividades.materialId, ids));

  const res = await db.delete(materiais).where(inArray(materiais.id, ids));
  const deletados = (res as any)?.[0]?.affectedRows ?? ids.length;
  await registrarAtividade(
    ownerNome,
    "HARD_DELETE",
    "MATERIAL",
    `${deletados} material(is) removido(s) permanentemente.`
  );
  return { deletados };
}

export async function marcarEtiquetaImpressa(id: number) {
  const db = await getDb();
  return await db.update(materiais).set({
    etiquetaImpressa: true,
    dataImpressaoEtiqueta: new Date()
  }).where(eq(materiais.id, id));
}

/**
 * Baixa em lote com suporte a quantidade parcial.
 * Para cada item:
 *   - Se quantidadeBaixa >= estoque atual → remove o registro (ativo = false)
 *   - Se quantidadeBaixa < estoque atual  → desconta a quantidade e recalcula o pesoTotal
 */
export async function baixaMateriais(
  itens: { id: number; quantidadeBaixa: number }[],
  motivo?: string,
  usuarioNome: string = "Sistema",
  obraDestino?: string,
  dataBaixa?: Date,
  numeroRequisicao?: string
) {
  const db = await getDb();

  let totalRemovidos = 0;
  let totalAtualizados = 0;

  for (const item of itens) {
    // Buscar o material atual
    const current = await db
      .select()
      .from(materiais)
      .where(and(eq(materiais.id, item.id), eq(materiais.ativo, true)))
      .limit(1);

    if (!current.length) continue;
    const mat = current[0];
    const estoqueAtual = mat.quantidade || 0;

    // Criar registro de saída ANTES de alterar o material
    const pesoBaixa = mat.pesoTotal && mat.quantidade 
      ? (parseFloat(String(mat.pesoTotal)) / mat.quantidade * item.quantidadeBaixa).toFixed(3)
      : "0.000";

    await db.insert(registrosSaida).values({
      tipo: mat.tipo,
      bitola: mat.bitola,
      quantidade: item.quantidadeBaixa,
      comprimento: mat.comprimento,
      pesoTotal: pesoBaixa,
      aco: mat.aco,
      obraNome: obraDestino || mat.obraNome,
      local: mat.local,
      fornecedor: mat.fornecedor,
      nf: mat.nf,
      numero_certificado: mat.numero_certificado,
      corrida: mat.corrida,
      motivo: motivo || null,
      numeroPedido: (mat as any).numeroPedido || null,
      numeroRequisicao: numeroRequisicao || null,
      materialId: mat.id,
      dataSaida: dataBaixa || new Date(),
    });

    if (item.quantidadeBaixa >= estoqueAtual) {
      // Baixa total — desativa o registro
      await db
        .update(materiais)
        .set({ ativo: false, updatedAt: new Date() })
        .where(eq(materiais.id, item.id));
      totalRemovidos++;
      
      // Registrar atividade
      await registrarAtividade(
        usuarioNome,
        "BAIXA",
        "MATERIAL",
        `Material (${mat.tipo} ${mat.bitola}) - Baixa total de ${item.quantidadeBaixa} un. Motivo: ${motivo || "Não informado"}`
      );
    } else {
      // Baixa parcial — desconta e recalcula peso proporcional
      const novaQtd = estoqueAtual - item.quantidadeBaixa;

      // Recalcula peso: se tiver pesoTotal, faz proporção simples
      let novoPeso: string | undefined;
      const pesoAtual = parseFloat(String(mat.pesoTotal || "0"));
      if (pesoAtual > 0 && estoqueAtual > 0) {
        const pesoPorPeca = pesoAtual / estoqueAtual;
        novoPeso = (pesoPorPeca * novaQtd).toFixed(3);
      }

      const update: any = { quantidade: novaQtd, updatedAt: new Date() };
      if (novoPeso !== undefined) update.pesoTotal = novoPeso;

      await db.update(materiais).set(update).where(eq(materiais.id, item.id));
      totalAtualizados++;
      
      // Registrar atividade
      await registrarAtividade(
        usuarioNome,
        "BAIXA",
        "MATERIAL",
        `Material (${mat.tipo} ${mat.bitola}) - Baixa parcial de ${item.quantidadeBaixa} un. (${novaQtd} un. restantes). Motivo: ${motivo || "Não informado"}`
      );
    }
  }

  // Registrar atividade de baixa geral
  await registrarAtividade(
    usuarioNome,
    "BAIXA",
    "MATERIAL",
    `Baixa em lote realizada: ${totalRemovidos} removidos, ${totalAtualizados} atualizados. Motivo: ${motivo || "Não informado"}`
  );

  return {
    sucesso: true,
    totalRemovidos,
    totalAtualizados,
    motivo: motivo || null,
  };
}

// ============================================================================
// LOCAIS DE ESTOQUE (predefinidos, selecionáveis via dropdown)
// ============================================================================

export async function listLocaisEstoque(apenasAtivos = false) {
  try {
    const db = await getDb();
    const query = db.select().from(locaisEstoque).orderBy(locaisEstoque.nome);
    if (apenasAtivos) {
      return await db.select().from(locaisEstoque).where(eq(locaisEstoque.ativo, true)).orderBy(locaisEstoque.nome);
    }
    return await query;
  } catch (error) {
    handleDbError(error, "listLocaisEstoque");
  }
}

export async function createLocalEstoque(nome: string) {
  try {
    const db = await getDb();
    const [result] = await db.insert(locaisEstoque).values({ nome: nome.trim() });
    return result;
  } catch (error) {
    handleDbError(error, "createLocalEstoque");
  }
}

export async function updateLocalEstoque(id: number, data: { nome?: string; ativo?: boolean }) {
  try {
    const db = await getDb();
    await db.update(locaisEstoque).set(data).where(eq(locaisEstoque.id, id));
    return { success: true };
  } catch (error) {
    handleDbError(error, "updateLocalEstoque");
  }
}

export async function deleteLocalEstoque(id: number) {
  try {
    const db = await getDb();
    // Soft-delete: desativa em vez de apagar, pra não quebrar materiais que já usam esse local no histórico.
    await db.update(locaisEstoque).set({ ativo: false }).where(eq(locaisEstoque.id, id));
    return { success: true };
  } catch (error) {
    handleDbError(error, "deleteLocalEstoque");
  }
}

// ============================================================================
// OBRAS
// ============================================================================

export async function listObras() {
  const db = await getDb();
  return await db.select().from(obras).orderBy(desc(obras.createdAt));
}

// Campos de texto vazios viram null — senão duas obras sem código colidem
// no índice único de `codigo` (duas strings vazias contam como iguais).
function normalizarCamposObra(data: any) {
  const out: any = { ...data };
  for (const campo of ["cliente", "codigo", "localizacao", "logoUrl"]) {
    if (typeof out[campo] === "string") {
      out[campo] = out[campo].trim() || null;
    }
  }
  if (typeof out.nome === "string") out.nome = out.nome.trim();
  return out;
}

function ehCodigoObraDuplicado(err: any) {
  const e = err?.cause ?? err;
  return e?.code === "ER_DUP_ENTRY" || e?.errno === 1062;
}

async function garantirCodigoObraLivre(db: any, codigo: string | null | undefined, ignorarId?: number) {
  if (!codigo) return;
  const existentes = await db.select({ id: obras.id, nome: obras.nome }).from(obras).where(eq(obras.codigo, codigo)).limit(1);
  const outra = existentes.find((o: any) => o.id !== ignorarId);
  if (outra) {
    throw new Error(`O código "${codigo}" já está em uso pela obra "${outra.nome}". Use outro código.`);
  }
}

export async function createObra(data: any, usuarioNome: string = "Sistema") {
  const db = await getDb();
  data = normalizarCamposObra(data);
  await garantirCodigoObraLivre(db, data.codigo);
  let result;
  try {
    [result] = await db.insert(obras).values(data);
  } catch (err) {
    if (ehCodigoObraDuplicado(err)) {
      throw new Error(`O código "${data.codigo}" já está em uso por outra obra. Use outro código.`);
    }
    throw err;
  }
  
  // Registrar atividade
  await registrarAtividade(
    usuarioNome,
    "CADASTRO",
    "OBRA",
    `Nova obra cadastrada: ${data.nome}`
  );
  
  return result;
}

export async function updateObra(id: number, data: any, usuarioNome: string = "Sistema") {
  const db = await getDb();
  data = normalizarCamposObra(data);
  await garantirCodigoObraLivre(db, data.codigo, id);
  
  // Buscar obra atual para comparação
  const current = await db.select().from(obras).where(eq(obras.id, id)).limit(1);
  if (current.length > 0) {
    const obraAtual = current[0];
    const mudancas: string[] = [];
    
    if (data.nome && data.nome !== obraAtual.nome) {
      mudancas.push(`Nome alterado de "${obraAtual.nome}" para "${data.nome}"`);
    }
    if (data.endereco && data.endereco !== obraAtual.endereco) {
      mudancas.push(`Endereço alterado de "${obraAtual.endereco || "-"}" para "${data.endereco}"`);
    }
    
    if (mudancas.length > 0) {
      for (const mudanca of mudancas) {
        await registrarAtividade(
          usuarioNome,
          "EDICAO",
          "OBRA",
          `Obra "${obraAtual.nome}": ${mudanca}`
        );
      }
    }
  }
  
  try {
    return await db.update(obras).set({ ...data, updatedAt: new Date() }).where(eq(obras.id, id));
  } catch (err) {
    if (ehCodigoObraDuplicado(err)) {
      throw new Error(`O código "${data.codigo}" já está em uso por outra obra. Use outro código.`);
    }
    throw err;
  }
}

export async function deleteObra(id: number, usuarioNome: string = "Sistema") {
  const db = await getDb();
  const atual = await db.select().from(obras).where(eq(obras.id, id)).limit(1);
  
  // Registrar atividade
  await registrarAtividade(
    usuarioNome,
    "EXCLUSAO",
    "OBRA",
    atual.length > 0 ? `Obra "${atual[0].nome}" foi excluída` : `Obra foi excluída`
  );
  
  return await db.delete(obras).where(eq(obras.id, id));
}

// ============================================================================
// ESPECIFICAÇÕES
// ============================================================================

export async function listEspecificacoes() {
  const db = await getDb();
  return await db.select().from(especificacoesMateriais).where(eq(especificacoesMateriais.ativo, true));
}

export async function updateEspecificacao(id: number, data: any) {
  const db = await getDb();

  const updateData: any = { updatedAt: new Date() };
  if (data.tipo !== undefined)         updateData.tipo = data.tipo;
  if (data.bitola !== undefined)       updateData.bitola = data.bitola;
  if (data.aco !== undefined)          updateData.aco = data.aco;
  if (data.pesoPorMetro !== undefined) updateData.pesoPorMetro = data.pesoPorMetro;
  if (data.unidade !== undefined)      updateData.unidade = data.unidade;
  if (data.estoqueMinimo !== undefined) updateData.estoqueMinimo = data.estoqueMinimo;
  if (data.valorUnitario !== undefined) updateData.valorUnitario = data.valorUnitario;

  // DIAGNÓSTICO TEMPORÁRIO — remover depois de identificar a causa do bug
  // de edição de tipo não persistir.
  console.log("[DIAG updateEspecificacao] id recebido:", id, "typeof:", typeof id);
  console.log("[DIAG updateEspecificacao] updateData:", JSON.stringify(updateData));

  const [antes] = await db.select().from(especificacoesMateriais).where(eq(especificacoesMateriais.id, id)).limit(1);
  console.log("[DIAG updateEspecificacao] registro ANTES do update:", JSON.stringify(antes));

  const resultado = await db
    .update(especificacoesMateriais)
    .set(updateData)
    .where(eq(especificacoesMateriais.id, id));

  console.log("[DIAG updateEspecificacao] resultado do update (affectedRows etc):", JSON.stringify(resultado));

  const [depois] = await db.select().from(especificacoesMateriais).where(eq(especificacoesMateriais.id, id)).limit(1);
  console.log("[DIAG updateEspecificacao] registro DEPOIS do update:", JSON.stringify(depois));

  return resultado;
}

export async function deleteEspecificacao(id: number) {
  const db = await getDb();

  return await db
    .update(especificacoesMateriais)
    .set({ ativo: false, updatedAt: new Date() })
    .where(eq(especificacoesMateriais.id, id));
}

export async function getEspecificacoesPaginated(
  page: number,
  pageSize: number,
  search?: string,
  filtros?: { categoria?: string; tipo?: string; aco?: string }
) {
  const db = await getDb();
  const offset = (page - 1) * pageSize;

  let conditions = [eq(especificacoesMateriais.ativo, true)];

  if (search) {
    conditions.push(sql`(${especificacoesMateriais.tipo} LIKE ${`%${search}%`} OR ${especificacoesMateriais.bitola} LIKE ${`%${search}%`} OR ${especificacoesMateriais.aco} LIKE ${`%${search}%`})`);
  }
  if (filtros?.categoria) {
    conditions.push(eq(especificacoesMateriais.categoria, filtros.categoria));
  }
  if (filtros?.tipo) {
    conditions.push(eq(especificacoesMateriais.tipo, filtros.tipo));
  }
  if (filtros?.aco) {
    conditions.push(sql`${especificacoesMateriais.aco} LIKE ${`%${filtros.aco}%`}`);
  }

  const data = await db.select()
    .from(especificacoesMateriais)
    .where(and(...conditions))
    .orderBy(desc(especificacoesMateriais.createdAt))
    .limit(pageSize)
    .offset(offset);
  
  const totalResult = await db.select({ count: sql<number>`count(*)` })
    .from(especificacoesMateriais)
    .where(and(...conditions));
  
  const total = totalResult[0]?.count || 0;

  return {
    data,
    total,
    totalPages: Math.ceil(total / pageSize)
  };
}

/**
 * Atualiza o valor unitário (R$/kg) de várias especificações de uma vez —
 * pensado especificamente pra edição em lote, já que cadastrar/corrigir
 * item por item não é viável com o volume real de especificações.
 */
export async function atualizarValoresEmLote(itens: { id: number; valorUnitario: string }[], usuarioNome: string = "Sistema") {
  try {
    const db = await getDb();
    let atualizados = 0;
    for (const item of itens) {
      await db.update(especificacoesMateriais)
        .set({ valorUnitario: item.valorUnitario, updatedAt: new Date() })
        .where(eq(especificacoesMateriais.id, item.id));
      atualizados++;
    }
    await registrarAtividade(
      usuarioNome,
      "EDICAO",
      "ESPECIFICACAO",
      `Valores unitários atualizados em lote — ${atualizados} especificação(ões).`
    );
    return { atualizados };
  } catch (error) {
    handleDbError(error, "atualizarValoresEmLote");
  }
}

/**
 * Atribui um valor unitário (R$/kg) a TODAS as especificações ativas de um
 * tipo+categoria de uma vez (ex: todo tipo "W" da categoria "PERFIL") — em
 * vez de precisar preencher item por item, que é inviável com tipos que têm
 * milhares de bitolas/aços cadastrados (ex: "TB" tem ~14 mil linhas).
 * Não mexe em especificações inativas nem afeta outros tipos.
 */
export async function atualizarValorPorTipo(
  grupos: { tipo: string; categoria: string; valorUnitario: string }[],
  usuarioNome: string = "Sistema"
) {
  try {
    const db = await getDb();
    let totalAtualizados = 0;
    const resumo: { tipo: string; categoria: string; atualizados: number }[] = [];

    for (const grupo of grupos) {
      const resultado = await db
        .update(especificacoesMateriais)
        .set({ valorUnitario: grupo.valorUnitario, updatedAt: new Date() })
        .where(and(
          eq(especificacoesMateriais.tipo, grupo.tipo),
          eq(especificacoesMateriais.categoria, grupo.categoria),
          eq(especificacoesMateriais.ativo, true)
        ));
      const atualizados = (resultado as any)?.[0]?.affectedRows ?? 0;
      totalAtualizados += atualizados;
      resumo.push({ tipo: grupo.tipo, categoria: grupo.categoria, atualizados });
    }

    await registrarAtividade(
      usuarioNome,
      "EDICAO",
      "ESPECIFICACAO",
      `Valor unitário atribuído por tipo — ${resumo.map(r => `${r.tipo}/${r.categoria}: ${r.atualizados}`).join(", ")} (${totalAtualizados} especificação(ões) no total).`
    );
    return { atualizados: totalAtualizados, resumo };
  } catch (error) {
    handleDbError(error, "atualizarValorPorTipo");
  }
}

/**
 * Gasto de material por período — cruza os Registros de Saída (baixas) com
 * o valor unitário (R$/kg) cadastrado nas Especificações, agrupando por dia
 * ou mês. Itens sem valor unitário cadastrado entram na contagem de peso
 * normalmente, mas não contribuem pro valor em R$ (ficam separados em
 * `pesoSemValor`, pra deixar claro que o gasto real pode ser maior).
 */
export async function getGastoMaterialPorPeriodo(
  dataInicio: Date,
  dataFim: Date,
  agrupamento: "dia" | "mes" = "dia",
  obraId: number | null = null
) {
  try {
    const db = await getDb();

    let obraNomeFiltro: string | null = null;
    if (obraId && obraId !== 0) {
      const obra = await db.select().from(obras).where(eq(obras.id, obraId)).limit(1);
      obraNomeFiltro = obra[0]?.nome ?? null;
    }

    const condicoes = [
      sql`${registrosSaida.dataSaida} >= ${dataInicio}`,
      sql`${registrosSaida.dataSaida} <= ${dataFim}`,
      eq(registrosSaida.excluirRelatorios, false),
    ];
    if (obraId === 0) condicoes.push(isNull(registrosSaida.obraNome) as any);
    else if (obraNomeFiltro) condicoes.push(eq(registrosSaida.obraNome, obraNomeFiltro) as any);

    // Left join com materiais pra saber a CATEGORIA real de cada saída
    // (registros_saida não guarda categoria). Sem isso, uma saída de CHAPA
    // que colidisse por tipo/bitola/aço com uma especificação de PERFIL
    // acabava sempre precificada pelo valor do PERFIL.
    const saidas = await db.select({
      tipo: registrosSaida.tipo,
      bitola: registrosSaida.bitola,
      aco: registrosSaida.aco,
      pesoTotal: registrosSaida.pesoTotal,
      dataSaida: registrosSaida.dataSaida,
      materialCategoria: materiais.categoria,
    })
      .from(registrosSaida)
      .leftJoin(materiais, eq(registrosSaida.materialId, materiais.id))
      .where(and(...condicoes));

    const especs = await db.select({
      tipo: especificacoesMateriais.tipo,
      bitola: especificacoesMateriais.bitola,
      aco: especificacoesMateriais.aco,
      categoria: especificacoesMateriais.categoria,
      valorUnitario: especificacoesMateriais.valorUnitario,
    }).from(especificacoesMateriais).where(eq(especificacoesMateriais.ativo, true));

    // Mapa exato tipo|bitola|aco|categoria → valorUnitario, usado quando a
    // categoria da saída é conhecida (via join acima). Mapa genérico (sem
    // categoria) só serve de fallback pra saídas antigas sem materialId —
    // pega o primeiro valor cadastrado pra aquela combinação, sem forçar
    // preferência por nenhuma categoria específica.
    const mapaValoresPorCategoria = new Map<string, number>();
    const mapaValoresGenerico = new Map<string, number>();
    for (const e of especs) {
      if (e.valorUnitario === null || e.valorUnitario === undefined) continue;
      const base = `${(e.tipo || "").toUpperCase()}|${(e.bitola || "").toUpperCase()}|${(e.aco || "").toUpperCase()}`;
      const valor = parseFloat(String(e.valorUnitario));
      mapaValoresPorCategoria.set(`${base}|${(e.categoria || "").toUpperCase()}`, valor);
      if (!mapaValoresGenerico.has(base)) mapaValoresGenerico.set(base, valor);
    }

    const buckets = new Map<string, { pesoComValor: number; pesoSemValor: number; valorGasto: number }>();

    for (const s of saidas) {
      const base = `${(s.tipo || "").toUpperCase()}|${(s.bitola || "").toUpperCase()}|${(s.aco || "").toUpperCase()}`;
      const categoria = (s.materialCategoria || "").toUpperCase();
      const valorUnitario = (categoria ? mapaValoresPorCategoria.get(`${base}|${categoria}`) : undefined) ?? mapaValoresGenerico.get(base);
      const peso = parseFloat(String(s.pesoTotal || "0"));
      const data = new Date(s.dataSaida);
      const periodo = agrupamento === "mes"
        ? `${data.getFullYear()}-${String(data.getMonth() + 1).padStart(2, "0")}`
        : `${data.getFullYear()}-${String(data.getMonth() + 1).padStart(2, "0")}-${String(data.getDate()).padStart(2, "0")}`;

      if (!buckets.has(periodo)) buckets.set(periodo, { pesoComValor: 0, pesoSemValor: 0, valorGasto: 0 });
      const bucket = buckets.get(periodo)!;

      if (valorUnitario !== undefined) {
        bucket.pesoComValor += peso;
        bucket.valorGasto += peso * valorUnitario;
      } else {
        bucket.pesoSemValor += peso;
      }
    }

    return Array.from(buckets.entries())
      .map(([periodo, dados]) => ({
        periodo,
        pesoComValor: +dados.pesoComValor.toFixed(2),
        pesoSemValor: +dados.pesoSemValor.toFixed(2),
        valorGasto: +dados.valorGasto.toFixed(2),
      }))
      .sort((a, b) => a.periodo.localeCompare(b.periodo));
  } catch (error) {
    handleDbError(error, "getGastoMaterialPorPeriodo");
  }
}


export async function getEspecificacaoByTipoBitolaAco(tipo: string, bitola: string, aco: string, categoria: string = "PERFIL") {
  const db = await getDb();
  const result = await db.select()
    .from(especificacoesMateriais)
    .where(and(
      eq(especificacoesMateriais.tipo, tipo),
      eq(especificacoesMateriais.bitola, bitola),
      eq(especificacoesMateriais.aco, aco),
      eq(especificacoesMateriais.categoria, categoria),
      eq(especificacoesMateriais.ativo, true)
    ))
    .limit(1);
  return result.length > 0 ? result[0] : null;
}

export async function updateMaterialComRecalculo(id: number, data: any, recalcularPeso: boolean, usuarioNome: string = "Sistema") {
  const db = await getDb();

  // Buscar material atual para comparação e dados faltantes
  const current = await db.select().from(materiais).where(eq(materiais.id, id)).limit(1);
  if (!current.length) throw new Error("Material não encontrado");
  const materialAtual = current[0];

  const categoria = data.categoria || materialAtual.categoria || "PERFIL";
  let pesoFinal = data.pesoTotal;

  if (recalcularPeso && (data.tipo || materialAtual.tipo) && (data.bitola || materialAtual.bitola) && (data.aco || materialAtual.aco)) {
    const spec = await getEspecificacaoByTipoBitolaAco(
      String(data.tipo || materialAtual.tipo).trim().toUpperCase(),
      String(data.bitola || materialAtual.bitola).trim().toUpperCase(),
      String(data.aco || materialAtual.aco).trim().toUpperCase(),
      categoria
    );
    if (spec) {
      const qtd = data.quantidade ?? materialAtual.quantidade ?? 1;
      const comp = data.comprimento ?? materialAtual.comprimento ?? 0;
      const pesoBase = parseFloat(String(spec.pesoPorMetro));
      
      if (categoria === "CHAPA") {
        const larg = data.largura ?? materialAtual.largura ?? 0;
        pesoFinal = (pesoBase * (larg / 1000) * (comp / 1000) * qtd).toFixed(3);
      } else {
        pesoFinal = (pesoBase * (comp / 1000) * qtd).toFixed(3);
      }
    }
  } else if (!pesoFinal && (data.quantidade !== undefined || data.comprimento !== undefined || data.largura !== undefined)) {
    const tipo = String(data.tipo || materialAtual.tipo).trim().toUpperCase();
    const bitola = String(data.bitola || materialAtual.bitola).trim().toUpperCase();
    const aco = String(data.aco || materialAtual.aco).trim().toUpperCase();
    const spec = await getEspecificacaoByTipoBitolaAco(tipo, bitola, aco, categoria);
    if (spec) {
      const qtd = data.quantidade ?? materialAtual.quantidade ?? 1;
      const comp = data.comprimento ?? materialAtual.comprimento ?? 0;
      const pesoBase = parseFloat(String(spec.pesoPorMetro));
      
      if (categoria === "CHAPA") {
        const larg = data.largura ?? materialAtual.largura ?? 0;
        pesoFinal = (pesoBase * (larg / 1000) * (comp / 1000) * qtd).toFixed(3);
      } else {
        pesoFinal = (pesoBase * (comp / 1000) * qtd).toFixed(3);
      }
    }
  }

  // O material atual já foi buscado no início da função

  const updateData: any = {};
  if (data.tipo !== undefined)      updateData.tipo = data.tipo;
  if (data.bitola !== undefined)    updateData.bitola = data.bitola;
  if (data.aco !== undefined)       updateData.aco = data.aco;
  if (data.quantidade !== undefined) updateData.quantidade = data.quantidade;
  if (data.comprimento !== undefined) updateData.comprimento = data.comprimento;
  if (data.largura !== undefined)     updateData.largura = data.largura;
  if (data.categoria !== undefined)   updateData.categoria = data.categoria;
  if (pesoFinal !== undefined)      updateData.pesoTotal = pesoFinal;
  if (data.local !== undefined)     updateData.local = data.local;
  if (data.obraId !== undefined)    updateData.obraId = data.obraId;
  if (data.obraNome !== undefined)  updateData.obraNome = data.obraNome;
  if (data.fornecedor !== undefined) updateData.fornecedor = data.fornecedor;
  if (data.nf !== undefined)        updateData.nf = data.nf;
  if (data.numeroCertificado !== undefined) updateData.numero_certificado = data.numeroCertificado;
  if (data.corrida !== undefined)   updateData.corrida = data.corrida;
  updateData.updatedAt = new Date();

  const result = await db.update(materiais).set(updateData).where(eq(materiais.id, id));

  // Registrar atividades granulares para cada campo alterado
  const mudancas: string[] = [];
  
  if (data.tipo !== undefined && data.tipo !== materialAtual.tipo) {
    mudancas.push(`Tipo alterado de "${materialAtual.tipo}" para "${data.tipo}"`);
  }
  if (data.bitola !== undefined && data.bitola !== materialAtual.bitola) {
    mudancas.push(`Bitola alterada de "${materialAtual.bitola}" para "${data.bitola}"`);
  }
  if (data.aco !== undefined && data.aco !== materialAtual.aco) {
    mudancas.push(`Aço alterado de "${materialAtual.aco}" para "${data.aco}"`);
  }
  if (data.quantidade !== undefined && data.quantidade !== materialAtual.quantidade) {
    mudancas.push(`Quantidade alterada de ${materialAtual.quantidade} para ${data.quantidade}`);
  }
  if (data.comprimento !== undefined && data.comprimento !== materialAtual.comprimento) {
    mudancas.push(`Comprimento alterado de ${materialAtual.comprimento}mm para ${data.comprimento}mm`);
  }
  if (data.largura !== undefined && data.largura !== materialAtual.largura) {
    mudancas.push(`Largura alterada de ${materialAtual.largura}mm para ${data.largura}mm`);
  }
  if (data.categoria !== undefined && data.categoria !== materialAtual.categoria) {
    mudancas.push(`Categoria alterada de "${materialAtual.categoria}" para "${data.categoria}"`);
  }
  if (pesoFinal !== undefined && pesoFinal !== materialAtual.pesoTotal) {
    mudancas.push(`Peso total alterado de ${materialAtual.pesoTotal}kg para ${pesoFinal}kg`);
  }
  if (data.local !== undefined && data.local !== materialAtual.local) {
    mudancas.push(`Local alterado de "${materialAtual.local || "ESTOQUE"}" para "${data.local}"`);
  }
  if (data.obraNome !== undefined && data.obraNome !== materialAtual.obraNome) {
    mudancas.push(`Obra alterada de "${materialAtual.obraNome || "LIVRE"}" para "${data.obraNome || "LIVRE"}"`);
  }
  if (data.fornecedor !== undefined && data.fornecedor !== materialAtual.fornecedor) {
    mudancas.push(`Fornecedor alterado de "${materialAtual.fornecedor || "-"}" para "${data.fornecedor}"`);
  }
  if (data.nf !== undefined && data.nf !== materialAtual.nf) {
    mudancas.push(`NF alterada de "${materialAtual.nf || "-"}" para "${data.nf}"`);
  }
  if (data.numeroCertificado !== undefined && data.numeroCertificado !== materialAtual.numero_certificado) {
    mudancas.push(`Número de certificado alterado de "${materialAtual.numero_certificado || "-"}" para "${data.numeroCertificado}"`);
  }
  if (data.corrida !== undefined && data.corrida !== materialAtual.corrida) {
    mudancas.push(`Corrida alterada de "${materialAtual.corrida || "-"}" para "${data.corrida}"`);
  }

  // Registrar cada mudança individualmente
  if (mudancas.length > 0) {
    const tipoBitola = materialAtual.tipo && materialAtual.bitola
      ? `${materialAtual.tipo} ${materialAtual.bitola}`
      : `ID ${id}`;
    for (const mudanca of mudancas) {
      await registrarAtividade(
        usuarioNome,
        "EDICAO",
        "MATERIAL",
        `Material ${tipoBitola}: ${mudanca}`,
        undefined,
        id
      );
    }
  }

  return result;
}

export async function createEspecificacao(data: any) {
  const db = await getDb();
  const [result] = await db.insert(especificacoesMateriais).values(data);
  return result;
}

// ============================================================================
// DASHBOARD & MOVIMENTAÇÕES
// ============================================================================

export async function getEstoqueOverview(obraId: number | null = null) {
  const db = await getDb();
  // obraId === 0  → materiais sem obra (LIVRE)
  // obraId > 0    → materiais da obra específica
  // obraId null   → todos os materiais
  const whereClause =
    obraId === null
      ? eq(materiais.ativo, true)
      : obraId === 0
        ? and(eq(materiais.ativo, true), isNull(materiais.obraId))
        : and(eq(materiais.ativo, true), eq(materiais.obraId, obraId));

  const items = await db.select().from(materiais).where(whereClause);
  
  const totalKg = items.reduce((sum, item) => sum + parseFloat(String(item.pesoTotal || "0")), 0);
  const totalBarras = items.reduce((sum, item) => sum + (item.quantidade || 0), 0);
  
  const alertas = items
    .filter((item: any) => {
      const saldo = parseFloat(String(item.pesoTotal || "0"));
      const minimo = parseFloat(String(item.estoqueMinimo || "50"));
      return saldo < minimo;
    })
    .map((item: any) => ({
      id: item.id,
      materialId: item.id,
      tipo: item.tipo,
      bitola: item.bitola,
      aco: item.aco,
      obraNome: item.obraNome || "LIVRE",
      saldoAtual: item.pesoTotal,
      comprimentoBarra: item.comprimento,
      quantidade: item.quantidade,
      estoqueMinimo: item.estoqueMinimo,
    }));

  // ── Comparação mês anterior ──────────────────────────────────────────────
  // Calcula o totalKg estimado no fim do mês anterior somando:
  //   • materiais que existiam antes do início deste mês (pesoTotal atual)
  //   • subtraindo entradas deste mês
  //   • somando saídas deste mês (pois no mês anterior elas ainda não tinham saído)
  const agora = new Date();
  const inicioMesAtual = new Date(agora.getFullYear(), agora.getMonth(), 1);

  // Entradas deste mês: materiais criados neste mês
  const entradasMesAtual = items
    .filter((m) => m.createdAt && new Date(m.createdAt) >= inicioMesAtual)
    .reduce((sum, m) => sum + parseFloat(String(m.pesoTotal || "0")), 0);

  // Saídas deste mês: registros de saída criados neste mês
  const saidasWhereClause = obraId === null
    ? sql`data_saida >= ${inicioMesAtual.toISOString().slice(0, 10)}`
    : obraId === 0
      ? sql`data_saida >= ${inicioMesAtual.toISOString().slice(0, 10)} AND obra_nome IS NULL`
      : sql`data_saida >= ${inicioMesAtual.toISOString().slice(0, 10)} AND obra_nome = ${items[0]?.obraNome ?? ""}`;

  const saidasRows = await db.execute(
    obraId === null
      ? sql`SELECT COALESCE(SUM(peso_total), 0) AS total FROM registros_saida WHERE data_saida >= ${inicioMesAtual.toISOString().slice(0, 10)}`
      : obraId === 0
        ? sql`SELECT COALESCE(SUM(peso_total), 0) AS total FROM registros_saida WHERE data_saida >= ${inicioMesAtual.toISOString().slice(0, 10)} AND obra_nome IS NULL`
        : sql`SELECT COALESCE(SUM(peso_total), 0) AS total FROM registros_saida WHERE data_saida >= ${inicioMesAtual.toISOString().slice(0, 10)} AND obra_nome = (SELECT nome FROM obras WHERE id = ${obraId} LIMIT 1)`
  ) as any;

  const saidasMesAtual = parseFloat(String((saidasRows[0] as any[])[0]?.total || "0"));

  // totalKg no fim do mês anterior = atual - entradas deste mês + saídas deste mês
  const totalKgMesAnterior = Math.max(0, totalKg - entradasMesAtual + saidasMesAtual);

  // Variação percentual (null se mês anterior era zero — evita divisão por zero)
  const variacaoPercentual = totalKgMesAnterior > 0
    ? parseFloat(((totalKg - totalKgMesAnterior) / totalKgMesAnterior * 100).toFixed(1))
    : null;
  // ────────────────────────────────────────────────────────────────────────
  
  return {
    totalKg: parseFloat(totalKg.toFixed(2)),
    totalBarras,
    alertas,
    totalKgMesAnterior: parseFloat(totalKgMesAnterior.toFixed(2)),
    variacaoPercentual,
  };
}

export async function registrarAjusteEstoque(data: {
  materialId: number;
  quantidadeAjuste: string;
  saldoAnterior: string;
  saldoPosterior: string;
  observacao: string;
  usuarioId: number;
  usuarioNome?: string;
}) {
  const db = await getDb();
  
  try {
    // Usar transação para garantir que ambos ocorram ou nenhum
    return await db.transaction(async (tx) => {
      // 1. Atualizar o pesoTotal na tabela materiais
      await tx.update(materiais)
        .set({ 
          pesoTotal: data.saldoPosterior,
          updatedAt: new Date()
        })
        .where(eq(materiais.id, data.materialId));

      // 2. Criar o registro de movimentação
      const [movResult] = await tx.insert(movimentacoes).values({
        tipo: "ajuste",
        estoqueId: data.materialId, // estoqueId no schema refere-se ao ID do material
        quantidade: data.quantidadeAjuste,
        saldoAnterior: data.saldoAnterior,
        saldoPosterior: data.saldoPosterior,
        observacao: data.observacao,
        usuarioId: data.usuarioId,
        referenciaType: "ajuste",
        referenciaId: data.materialId,
        dataHora: new Date(),
      });

      // 3. Registrar no histórico de atividades
      const mat = await tx.select().from(materiais).where(eq(materiais.id, data.materialId)).limit(1);
      const descMaterial = mat.length > 0 ? `${mat[0].tipo} ${mat[0].bitola}` : `ID ${data.materialId}`;
      
      await registrarAtividade(
        data.usuarioNome || "Sistema",
        "EDICAO",
        "MATERIAL",
        `Ajuste de estoque no material ${descMaterial}: Saldo alterado de ${data.saldoAnterior}kg para ${data.saldoPosterior}kg. Motivo: ${data.observacao}`,
        data.usuarioId
      );

      return movResult;
    });
  } catch (error) {
    handleDbError(error, "registrarAjusteEstoque");
  }
}

export async function listMovimentacoes(filters?: any) {
  const db = await getDb();

  const movs = await db
    .select({
      id: movimentacoes.id,
      tipo: movimentacoes.tipo,
      quantidade: movimentacoes.quantidade,
      comprimento: movimentacoes.comprimento,
      saldoAnterior: movimentacoes.saldoAnterior,
      saldoPosterior: movimentacoes.saldoPosterior,
      observacao: movimentacoes.observacao,
      dataHora: movimentacoes.dataHora,
      estoqueId: movimentacoes.estoqueId,
      referenciaType: movimentacoes.referenciaType,
      referenciaId: movimentacoes.referenciaId,
      usuarioId: movimentacoes.usuarioId,
    })
    .from(movimentacoes)
    .orderBy(desc(movimentacoes.dataHora))
    .limit(2000);

  const enriched = await Promise.all(
    movs.map(async (mov) => {
      const mat = await db
        .select({
          tipo: materiais.tipo,
          bitola: materiais.bitola,
          aco: materiais.aco,
          comprimento: materiais.comprimento,
          obraNome: materiais.obraNome,
        })
        .from(materiais)
        .where(eq(materiais.id, mov.estoqueId))
        .limit(1);

      const m = mat[0];
      return {
        ...mov,
        materialTipo: m?.tipo ?? null,
        materialBitola: m?.bitola ?? null,
        materialAco: m?.aco ?? null,
        materialComprimento: m?.comprimento ?? null,
        materialDescricao: m
          ? `${m.tipo} ${m.bitola}${m.aco ? ` (${m.aco})` : ""}`
          : `Ref. ${mov.estoqueId}`,
        obraNome: m?.obraNome ?? null,
      };
    })
  );

  return enriched;
}

export async function createMovimentacao(data: any) {
  const db = await getDb();
  const [result] = await db.insert(movimentacoes).values(data);
  return result;
}

export async function listEstoque(obraId?: number) {
  const db = await getDb();
  // Simulação para compatibilidade
  return await listMateriais();
}

// ============================================================================
// REGISTROS DE SAÍDA
// ============================================================================

export async function listRegistrosSaida() {
  try {
    const db = await getDb();
    return await db.select().from(registrosSaida).orderBy(desc(registrosSaida.dataSaida));
  } catch (error) {
    handleDbError(error, "listRegistrosSaida");
  }
}

// Método "master" de exclusão: marca (ou desmarca) um material ou registro
// de saída como "não contar nos relatórios/dashboard" — usado pra tirar
// itens de teste/cadastro errado das somas e gráficos sem apagar o dado
// (mantém rastreabilidade). Afeta getDashboardAnalytics, getGastoMaterialPorPeriodo
// e exportarMovimentacoesFiltradas.
export async function setExclusaoRelatorio(
  tipo: "material" | "saida",
  id: number,
  excluir: boolean,
  usuarioNome: string = "Sistema"
) {
  try {
    const db = await getDb();
    if (tipo === "material") {
      await db.update(materiais).set({ excluirRelatorios: excluir }).where(eq(materiais.id, id));
    } else {
      await db.update(registrosSaida).set({ excluirRelatorios: excluir }).where(eq(registrosSaida.id, id));
    }
    await registrarAtividade(
      usuarioNome,
      excluir ? "EXCLUSAO_RELATORIO" : "INCLUSAO_RELATORIO",
      tipo === "material" ? "Material" : "Registro de saída",
      `${tipo === "material" ? "Material" : "Registro de saída"} #${id} ${excluir ? "marcado para não contar" : "voltou a contar"} nos relatórios/dashboard.`
    );
    return { success: true };
  } catch (error) {
    handleDbError(error, "setExclusaoRelatorio");
  }
}

export async function createRegistroSaida(data: any) {
  try {
    const db = await getDb();
    const [result] = await db.insert(registrosSaida).values({
      tipo: data.tipo,
      bitola: data.bitola,
      quantidade: data.quantidade,
      comprimento: data.comprimento,
      pesoTotal: data.pesoTotal,
      aco: data.aco,
      obraNome: data.obraNome,
      local: data.local,
      fornecedor: data.fornecedor,
      nf: data.nf,
      numero_certificado: data.numero_certificado,
      corrida: data.corrida,
      motivo: data.motivo || null,
      numeroPedido: data.numeroPedido || null,
      dataSaida: new Date(),
    });
    return result;
  } catch (error) {
    handleDbError(error, "createRegistroSaida");
  }
}

// ============================================================================
// REGISTROS DE ENTRADA
// ============================================================================

export async function listRegistrosEntrada() {
  try {
    const db = await getDb();
    return await db.select().from(registrosEntrada).orderBy(desc(registrosEntrada.dataEntrada));
  } catch (error) {
    handleDbError(error, "listRegistrosEntrada");
  }
}

/** Datas da última entrada e da última baixa registradas, para o balão de notificações. */
export async function getResumoNotificacoesEstoque() {
  try {
    const db = await getDb();

    const [ultimaEntrada] = await db
      .select({ dataEntrada: registrosEntrada.dataEntrada })
      .from(registrosEntrada)
      .orderBy(desc(registrosEntrada.dataEntrada))
      .limit(1);

    const [ultimaSaida] = await db
      .select({ dataSaida: registrosSaida.dataSaida })
      .from(registrosSaida)
      .orderBy(desc(registrosSaida.dataSaida))
      .limit(1);

    return {
      entrada: { ultimaMovimentacaoEm: ultimaEntrada?.dataEntrada ?? null },
      baixa: { ultimaMovimentacaoEm: ultimaSaida?.dataSaida ?? null },
    };
  } catch (error) {
    handleDbError(error, "getResumoNotificacoesEstoque");
  }
}

// ============================================================================
// RELATÓRIOS DE RECEBIMENTO
// Guarda só os dados estruturados (JSON pequeno) — nunca o PDF em si. O PDF
// é sempre regerado no navegador, sob demanda, a partir desses dados.
// ============================================================================

function lerDadosRelatorio(bruto: any): any {
  return typeof bruto === "string" ? JSON.parse(bruto) : bruto;
}

/**
 * Um relatório pode ter várias cargas (uma por NF/fornecedor recebida no
 * dia). Os relatórios antigos guardavam uma carga só, no formato
 * { itens, meta } — aqui os dois formatos viram a mesma lista de cargas.
 */
function cargasDoRelatorio(dados: any): any[] {
  if (Array.isArray(dados?.cargas)) return dados.cargas;
  return [{ ...(dados?.meta || {}), itens: dados?.itens || [] }];
}

function idsMateriaisDoRelatorio(dados: any): number[] {
  const ids = cargasDoRelatorio(dados)
    .flatMap((c: any) => c.itens || [])
    .map((it: any) => it.id)
    .filter((id: any) => typeof id === "number" && Number.isFinite(id));
  return Array.from(new Set<number>(ids));
}

export async function createRelatorioRecebimento(dados: any, usuarioNome: string = "Sistema") {
  try {
    const db = await getDb();
    const [result] = await db.insert(relatoriosRecebimento).values({
      dados: dados,
      usuarioNome,
    });
    const insertId = (result as any)?.insertId;

    // Ligação Relatório↔Material, pra rastreabilidade — aditivo, mesma
    // lógica já usada em salvarGrdGerada. Só grava pra itens que têm id
    // numérico real (alguns fluxos antigos podem não ter).
    for (const materialId of idsMateriaisDoRelatorio(dados)) {
      await db.insert(relatorioRecebimentoMateriais).values({ relatorioId: insertId, materialId });
    }

    const cargas = cargasDoRelatorio(dados);
    const totalItens = cargas.reduce((soma: number, c: any) => soma + (c.itens?.length ?? 0), 0);
    await registrarAtividade(
      usuarioNome,
      "CADASTRO",
      "RELATORIO_RECEBIMENTO",
      `Relatório de recebimento REL-${String(insertId).padStart(5, "0")} gerado (${cargas.length} carga(s), ${totalItens} itens).`
    );
    return { id: insertId };
  } catch (error) {
    handleDbError(error, "createRelatorioRecebimento");
  }
}

/**
 * Edição de um relatório já salvo (só administrador — ver routers.ts).
 * Substitui os dados e refaz a ligação com os materiais, já que a edição
 * pode ter tirado itens do relatório.
 */
export async function atualizarRelatorioRecebimento(id: number, dados: any, usuarioNome: string = "Sistema") {
  try {
    const db = await getDb();
    const existe = await db.select({ id: relatoriosRecebimento.id }).from(relatoriosRecebimento).where(eq(relatoriosRecebimento.id, id)).limit(1);
    if (!existe.length) throw new Error("Relatório não encontrado.");

    // As fotos de cada carga só valem se a imagem ainda existir nesse relatório.
    const imagens = await db.select({ id: relatorioRecebimentoImagens.id }).from(relatorioRecebimentoImagens).where(eq(relatorioRecebimentoImagens.relatorioId, id));
    const idsImagens = new Set(imagens.map(i => i.id));
    if (Array.isArray(dados?.cargas)) {
      for (const carga of dados.cargas) {
        carga.fotoIds = (carga.fotoIds || []).filter((fotoId: number) => idsImagens.has(fotoId));
      }
    }

    await db.update(relatoriosRecebimento).set({ dados }).where(eq(relatoriosRecebimento.id, id));

    await db.delete(relatorioRecebimentoMateriais).where(eq(relatorioRecebimentoMateriais.relatorioId, id));
    for (const materialId of idsMateriaisDoRelatorio(dados)) {
      await db.insert(relatorioRecebimentoMateriais).values({ relatorioId: id, materialId });
    }

    await registrarAtividade(usuarioNome, "EDICAO", "RELATORIO_RECEBIMENTO", `Relatório de recebimento REL-${String(id).padStart(5, "0")} editado.`);
    return { ok: true };
  } catch (error) {
    handleDbError(error, "atualizarRelatorioRecebimento");
  }
}

/**
 * Exclusão definitiva de um relatório salvo (só administrador) — apaga
 * também as fotos e a ligação com os materiais. Os materiais em si e o
 * estoque não são tocados: o relatório é só um documento sobre eles.
 */
export async function excluirRelatorioRecebimento(id: number, usuarioNome: string = "Sistema") {
  try {
    const db = await getDb();
    const existe = await db.select({ id: relatoriosRecebimento.id }).from(relatoriosRecebimento).where(eq(relatoriosRecebimento.id, id)).limit(1);
    if (!existe.length) throw new Error("Relatório não encontrado.");

    await db.delete(relatorioRecebimentoImagens).where(eq(relatorioRecebimentoImagens.relatorioId, id));
    await db.delete(relatorioRecebimentoMateriais).where(eq(relatorioRecebimentoMateriais.relatorioId, id));
    await db.delete(relatoriosRecebimento).where(eq(relatoriosRecebimento.id, id));

    await registrarAtividade(usuarioNome, "EXCLUSAO", "RELATORIO_RECEBIMENTO", `Relatório de recebimento REL-${String(id).padStart(5, "0")} excluído.`);
    return { ok: true };
  } catch (error) {
    handleDbError(error, "excluirRelatorioRecebimento");
  }
}

export async function uploadImagemRecebimento(
  relatorioId: number,
  imagem: { nomeArquivo: string; tipoArquivo: string; conteudoBase64: string; cargaId?: string },
  usuarioNome: string = "Sistema"
) {
  try {
    const db = await getDb();
    const buffer = Buffer.from(imagem.conteudoBase64, "base64");
    const [result] = await db.insert(relatorioRecebimentoImagens).values({
      relatorioId,
      nomeArquivo: imagem.nomeArquivo,
      tipoArquivo: imagem.tipoArquivo || "image/jpeg",
      tamanho: buffer.length,
      conteudo: buffer,
      usuarioNome,
    });
    const imagemId = (result as any)?.insertId;

    // A foto pertence a uma carga específica do relatório — o vínculo fica
    // guardado nos próprios dados do relatório (carga.fotoIds), pra que o PDF
    // mostre cada foto junto da carga certa.
    if (imagem.cargaId) {
      const rows = await db.select({ dados: relatoriosRecebimento.dados }).from(relatoriosRecebimento).where(eq(relatoriosRecebimento.id, relatorioId)).limit(1);
      const dados = rows.length ? lerDadosRelatorio(rows[0].dados) : null;
      const carga = Array.isArray(dados?.cargas) ? dados.cargas.find((c: any) => c.id === imagem.cargaId) : null;
      if (carga) {
        carga.fotoIds = [...(carga.fotoIds || []), imagemId];
        await db.update(relatoriosRecebimento).set({ dados }).where(eq(relatoriosRecebimento.id, relatorioId));
      }
    }

    return { id: imagemId };
  } catch (error) {
    handleDbError(error, "uploadImagemRecebimento");
  }
}

export async function listImagensRecebimento(relatorioId: number) {
  try {
    const db = await getDb();
    return await db.select({
      id: relatorioRecebimentoImagens.id,
      nomeArquivo: relatorioRecebimentoImagens.nomeArquivo,
      tipoArquivo: relatorioRecebimentoImagens.tipoArquivo,
      tamanho: relatorioRecebimentoImagens.tamanho,
      createdAt: relatorioRecebimentoImagens.createdAt,
    }).from(relatorioRecebimentoImagens).where(eq(relatorioRecebimentoImagens.relatorioId, relatorioId)).orderBy(desc(relatorioRecebimentoImagens.createdAt));
  } catch (error) {
    handleDbError(error, "listImagensRecebimento");
  }
}

export async function getImagemRecebimentoConteudo(id: number) {
  try {
    const db = await getDb();
    const rows = await db.select().from(relatorioRecebimentoImagens).where(eq(relatorioRecebimentoImagens.id, id)).limit(1);
    return rows[0] || null;
  } catch (error) {
    handleDbError(error, "getImagemRecebimentoConteudo");
  }
}

export async function deletarImagemRecebimento(id: number, usuarioNome: string = "Sistema") {
  try {
    const db = await getDb();
    const imagem = await db.select({ relatorioId: relatorioRecebimentoImagens.relatorioId }).from(relatorioRecebimentoImagens).where(eq(relatorioRecebimentoImagens.id, id)).limit(1);
    await db.delete(relatorioRecebimentoImagens).where(eq(relatorioRecebimentoImagens.id, id));

    // Tira a foto também da carga a que ela estava vinculada.
    if (imagem.length) {
      const rows = await db.select({ dados: relatoriosRecebimento.dados }).from(relatoriosRecebimento).where(eq(relatoriosRecebimento.id, imagem[0].relatorioId)).limit(1);
      const dados = rows.length ? lerDadosRelatorio(rows[0].dados) : null;
      if (Array.isArray(dados?.cargas) && dados.cargas.some((c: any) => (c.fotoIds || []).includes(id))) {
        for (const carga of dados.cargas) carga.fotoIds = (carga.fotoIds || []).filter((fotoId: number) => fotoId !== id);
        await db.update(relatoriosRecebimento).set({ dados }).where(eq(relatoriosRecebimento.id, imagem[0].relatorioId));
      }
    }

    await registrarAtividade(usuarioNome, "EXCLUSAO", "RELATORIO_RECEBIMENTO", `Foto do relatório de recebimento removida (id ${id}).`);
    return { ok: true };
  } catch (error) {
    handleDbError(error, "deletarImagemRecebimento");
  }
}


export async function listRelatoriosRecebimento() {
  try {
    const db = await getDb();
    const rows = await db.select({
      id: relatoriosRecebimento.id,
      usuarioNome: relatoriosRecebimento.usuarioNome,
      createdAt: relatoriosRecebimento.createdAt,
      dados: relatoriosRecebimento.dados,
    }).from(relatoriosRecebimento).orderBy(desc(relatoriosRecebimento.createdAt));
    const fotosPorRelatorio = await db.select({
      relatorioId: relatorioRecebimentoImagens.relatorioId,
      total: sql<number>`count(*)`,
    }).from(relatorioRecebimentoImagens).groupBy(relatorioRecebimentoImagens.relatorioId);
    const totalFotos = new Map(fotosPorRelatorio.map(f => [f.relatorioId, Number(f.total)]));

    // Retorna um resumo pra listagem — de cada item vai só o necessário pra
    // mostrar quais materiais estão no relatório, não o registro inteiro.
    return rows.map((r: any) => {
      const cargas = cargasDoRelatorio(lerDadosRelatorio(r.dados));
      const unicos = (valores: any[]) => Array.from(new Set(valores.map(v => String(v || "").trim()).filter(Boolean)));
      const fornecedores = unicos(cargas.map((c: any) => c.fornecedor));
      const nfs = unicos(cargas.map((c: any) => c.nf));
      return {
        id: r.id,
        usuarioNome: r.usuarioNome,
        createdAt: r.createdAt,
        fornecedor: fornecedores.join(" · ") || null,
        nf: nfs.join(", ") || null,
        totalCargas: cargas.length,
        totalItens: cargas.reduce((soma: number, c: any) => soma + (c.itens?.length ?? 0), 0),
        totalFotos: totalFotos.get(r.id) ?? 0,
        cargas: cargas.map((c: any) => ({
          fornecedor: c.fornecedor || null,
          nf: c.nf || null,
          itens: (c.itens || []).map((it: any) => ({
            tipo: it.tipo ?? null,
            bitola: it.bitola ?? null,
            aco: it.aco ?? null,
            categoria: it.categoria ?? null,
            quantidade: it.quantidade ?? null,
            comprimento: it.comprimento ?? null,
            largura: it.largura ?? null,
            pesoTotal: it.pesoTotal ?? null,
            obraNome: it.obraNome ?? null,
          })),
        })),
      };
    });
  } catch (error) {
    handleDbError(error, "listRelatoriosRecebimento");
  }
}

export async function getRelatorioRecebimentoById(id: number) {
  try {
    const db = await getDb();
    const rows = await db.select().from(relatoriosRecebimento).where(eq(relatoriosRecebimento.id, id)).limit(1);
    if (!rows.length) return null;
    const r = rows[0] as any;
    return {
      id: r.id,
      usuarioNome: r.usuarioNome,
      createdAt: r.createdAt,
      dados: typeof r.dados === "string" ? JSON.parse(r.dados) : r.dados,
    };
  } catch (error) {
    handleDbError(error, "getRelatorioRecebimentoById");
  }
}

// ============================================================================
// GRDs GERADAS + CERTIFICADOS
// Guarda os dados usados pra montar a GRD (regerada sob demanda via Python)
// junto com os certificados anexados (esses sim, arquivo real — LONGBLOB).
// ============================================================================

/**
 * Próximo número sugerido pra GRD — sequencial a partir do maior "numero" já
 * usado (não mais do `id` da tabela, que é interno e não bate com o número
 * exibido pro usuário quando alguma GRD antiga foi cadastrada fora de ordem
 * ou quando uma GRD é excluída). CAST(numero AS UNSIGNED) trata "0002" como
 * 2; números não-numéricos legados viram 0 e não atrapalham o MAX.
 */
export async function obterProximoNumeroGrdDb(): Promise<string> {
  try {
    const db = await getDb();
    const [row] = await db.execute(sql`
      SELECT COALESCE(MAX(CAST(numero AS UNSIGNED)), 0) AS maiorNumero FROM grds_geradas
    `) as any;
    const maiorNumero = Number((row[0] as any)?.maiorNumero ?? 0);
    return String(maiorNumero + 1).padStart(4, "0");
  } catch (error) {
    handleDbError(error, "obterProximoNumeroGrdDb");
  }
}

/** Exclui uma GRD gerada e seus certificados/links anexados — owner apenas. */
export async function deletarGrd(id: number, usuarioNome: string = "Sistema") {
  try {
    const db = await getDb();
    const [grd] = await db.select({ numero: grdsGeradas.numero, obra: grdsGeradas.obra }).from(grdsGeradas).where(eq(grdsGeradas.id, id)).limit(1);
    if (!grd) throw new Error("GRD não encontrada.");

    await db.delete(grdCertificados).where(eq(grdCertificados.grdId, id));
    await db.delete(grdMateriais).where(eq(grdMateriais.grdId, id));
    await db.delete(grdsGeradas).where(eq(grdsGeradas.id, id));

    await registrarAtividade(usuarioNome, "EXCLUSAO", "GRD", `GRD ${grd.numero} (${grd.obra}) removida.`);
    return { success: true };
  } catch (error) {
    handleDbError(error, "deletarGrd");
  }
}

/**
 * Corrige manualmente o número de uma GRD já salva — pra consertar números
 * fora de ordem/duplicados sem precisar excluir e regerar. Bloqueia se já
 * existir outra GRD com o mesmo número.
 */
export async function editarNumeroGrd(id: number, numero: string, usuarioNome: string = "Sistema") {
  try {
    const db = await getDb();
    const numeroLimpo = numero.trim();
    if (!numeroLimpo) throw new Error("Informe um número.");

    const [atual] = await db.select({ numero: grdsGeradas.numero }).from(grdsGeradas).where(eq(grdsGeradas.id, id)).limit(1);
    if (!atual) throw new Error("GRD não encontrada.");

    const duplicada = await db.select({ id: grdsGeradas.id }).from(grdsGeradas)
      .where(and(eq(grdsGeradas.numero, numeroLimpo), sql`${grdsGeradas.id} != ${id}`))
      .limit(1);
    if (duplicada.length > 0) throw new Error(`Já existe outra GRD com o número "${numeroLimpo}".`);

    await db.update(grdsGeradas).set({ numero: numeroLimpo }).where(eq(grdsGeradas.id, id));
    await registrarAtividade(usuarioNome, "EDICAO", "GRD", `Número da GRD alterado de "${atual.numero}" para "${numeroLimpo}".`);
    return { success: true };
  } catch (error) {
    handleDbError(error, "editarNumeroGrd");
  }
}

interface CertificadoUpload {
  nomeArquivo: string;
  tipoArquivo: string;
  conteudoBase64: string;
}

/**
 * Salva a GRD gerada (dados usados pra montar o .xlsm) + certificados
 * anexados, e marca `grdGerada = true` nos materiais envolvidos (quando têm
 * id real — cadastro em lote/NF-e recém-salvo, ou seleção da lista).
 */
export async function salvarGrdGerada(
  info: { numero: string; obra: string; cliente: string; dataGrd?: string; materiais: any[] },
  certificados: CertificadoUpload[],
  usuarioNome: string = "Sistema"
) {
  try {
    const db = await getDb();

    // O número é sempre calculado e reservado AQUI, na hora de salvar de
    // verdade — nunca confiando no que a tela sugeriu antes (info.numero é
    // ignorado pra esse propósito). Isso fecha a janela de corrida que
    // causava números repetidos: antes, o "próximo número" era calculado
    // numa consulta separada, então duas GRDs criadas em sequência rápida
    // podiam ver o mesmo "próximo disponível" antes de qualquer uma ter
    // sido salva. Agora, se duas tentativas colidirem (graças à restrição
    // de unicidade no banco), a segunda simplesmente recalcula e tenta de
    // novo com o número seguinte, até conseguir.
    let grdId: number | undefined;
    let numeroFinal: string | undefined;
    const MAX_TENTATIVAS = 5;

    for (let tentativa = 0; tentativa < MAX_TENTATIVAS; tentativa++) {
      const [row] = await db.execute(sql`
        SELECT COALESCE(MAX(CAST(numero AS UNSIGNED)), 0) AS maiorNumero FROM grds_geradas
      `) as any;
      const maiorNumero = Number((row[0] as any)?.maiorNumero ?? 0);
      const candidato = String(maiorNumero + 1).padStart(4, "0");

      try {
        const [result] = await db.insert(grdsGeradas).values({
          numero: candidato,
          obra: info.obra,
          cliente: info.cliente || null,
          dataGrd: info.dataGrd || null,
          dados: { materiais: info.materiais },
          usuarioNome,
        });
        grdId = (result as any)?.insertId;
        numeroFinal = candidato;
        break;
      } catch (err: any) {
        const ehDuplicata = err?.code === "ER_DUP_ENTRY" || err?.errno === 1062;
        if (ehDuplicata && tentativa < MAX_TENTATIVAS - 1) continue; // outro processo pegou esse número primeiro — tenta o próximo
        throw err;
      }
    }
    if (!grdId || !numeroFinal) {
      throw new Error("Não foi possível gerar um número de GRD único depois de várias tentativas — tente novamente.");
    }

    for (const cert of certificados) {
      const buffer = Buffer.from(cert.conteudoBase64, "base64");
      await db.insert(grdCertificados).values({
        grdId,
        nomeArquivo: cert.nomeArquivo,
        tipoArquivo: cert.tipoArquivo || "application/pdf",
        tamanho: buffer.length,
        conteudo: buffer,
      });
    }

    // Marca os materiais envolvidos (os que têm id numérico real) como "GRD gerada".
    const idsValidos = info.materiais
      .map((m: any) => m.id)
      .filter((id: any) => typeof id === "number" && Number.isFinite(id));
    if (idsValidos.length > 0) {
      await db.update(materiais).set({ grdGerada: true }).where(inArray(materiais.id, idsValidos));

      // Ligação GRD↔Material, pra rastreabilidade — aditivo, não afeta nada
      // do que já funcionava (geração/leitura da GRD continuam iguais).
      for (const materialId of idsValidos) {
        await db.insert(grdMateriais).values({ grdId, materialId });
      }
    }

    await registrarAtividade(
      usuarioNome,
      "CADASTRO",
      "GRD",
      `GRD ${numeroFinal} gerada para a obra "${info.obra}"${certificados.length > 0 ? ` com ${certificados.length} certificado(s) anexado(s)` : ""}.`
    );

    return { id: grdId, numero: numeroFinal };
  } catch (error) {
    handleDbError(error, "salvarGrdGerada");
  }
}

/** Listagem leve — sem carregar o conteúdo dos certificados (só a contagem). */
export async function listGrdsGeradas() {
  try {
    const db = await getDb();
    const grds = await db.select().from(grdsGeradas).orderBy(desc(grdsGeradas.createdAt));
    const certificadosContagem = await db.select({
      grdId: grdCertificados.grdId,
      id: grdCertificados.id,
    }).from(grdCertificados);

    const contagemPorGrd = new Map<number, number>();
    certificadosContagem.forEach((c: any) => {
      contagemPorGrd.set(c.grdId, (contagemPorGrd.get(c.grdId) || 0) + 1);
    });

    return grds.map((g: any) => {
      const dados = typeof g.dados === "string" ? JSON.parse(g.dados) : g.dados;
      return {
        id: g.id,
        numero: g.numero,
        obra: g.obra,
        cliente: g.cliente,
        dataGrd: g.dataGrd,
        usuarioNome: g.usuarioNome,
        createdAt: g.createdAt,
        totalItens: dados?.materiais?.length ?? 0,
        totalCertificados: contagemPorGrd.get(g.id) || 0,
      };
    });
  } catch (error) {
    handleDbError(error, "listGrdsGeradas");
  }
}

/** Dados completos pra regenerar o .xlsm + metadados dos certificados (sem o blob ainda). */
export async function getGrdGeradaById(id: number) {
  try {
    const db = await getDb();
    const rows = await db.select().from(grdsGeradas).where(eq(grdsGeradas.id, id)).limit(1);
    if (!rows.length) return null;
    const g = rows[0] as any;
    const certs = await db.select({
      id: grdCertificados.id,
      nomeArquivo: grdCertificados.nomeArquivo,
      tipoArquivo: grdCertificados.tipoArquivo,
      tamanho: grdCertificados.tamanho,
    }).from(grdCertificados).where(eq(grdCertificados.grdId, id));

    return {
      id: g.id,
      numero: g.numero,
      obra: g.obra,
      cliente: g.cliente,
      dataGrd: g.dataGrd,
      usuarioNome: g.usuarioNome,
      createdAt: g.createdAt,
      dados: typeof g.dados === "string" ? JSON.parse(g.dados) : g.dados,
      certificados: certs,
    };
  } catch (error) {
    handleDbError(error, "getGrdGeradaById");
  }
}

/** Busca o conteúdo binário de UM certificado específico (usado na hora de montar o ZIP). */
export async function getCertificadoConteudo(id: number) {
  try {
    const db = await getDb();
    const rows = await db.select().from(grdCertificados).where(eq(grdCertificados.id, id)).limit(1);
    if (!rows.length) return null;
    return rows[0];
  } catch (error) {
    handleDbError(error, "getCertificadoConteudo");
  }
}


// ============================================================================
// HISTÓRICO DE ATIVIDADES
// ============================================================================

export async function registrarAtividade(
  usuarioNome: string,
  acao: string,
  entidade: string,
  detalhes: string,
  usuarioId?: number,
  materialId?: number
) {
  try {
    const db = await getDb();
    const agora = new Date().toISOString().slice(0, 19).replace("T", " ");
    await db.execute(sql`
      INSERT INTO historico_atividades (usuario_nome, acao, entidade, detalhes, data_hora, material_id)
      VALUES (${usuarioNome}, ${acao}, ${entidade}, ${detalhes}, ${agora}, ${materialId ?? null})
    `);
  } catch (error) {
    console.error("[Histórico] Erro ao registrar atividade:", error);
    // Não lançar erro para não interromper a operação principal
  }
}

export async function listHistoricoAtividades(limit: number = 100, offset: number = 0) {
  try {
    const db = await getDb();
    const data = await db.select({
      id: historicoAtividades.id,
      usuarioNome: historicoAtividades.usuarioNome,
      acao: historicoAtividades.acao,
      entidade: historicoAtividades.entidade,
      detalhes: historicoAtividades.detalhes,
      dataHora: historicoAtividades.dataHora,
      materialId: historicoAtividades.materialId,
      materialTipo: materiais.tipo,
      materialBitola: materiais.bitola,
    })
      .from(historicoAtividades)
      .leftJoin(materiais, eq(historicoAtividades.materialId, materiais.id))
      .orderBy(desc(historicoAtividades.dataHora))
      .limit(limit)
      .offset(offset);
    
    const totalResult = await db.select({ count: sql<number>`count(*)` })
      .from(historicoAtividades);
    const total = totalResult[0]?.count || 0;

    return { data, total };
  } catch (error) {
    handleDbError(error, "listHistoricoAtividades");
  }
}

export async function getHistoricoAtividadesPorEntidade(entidade: string, limit: number = 50) {
  try {
    const db = await getDb();
    return await db.select()
      .from(historicoAtividades)
      .where(eq(historicoAtividades.entidade, entidade))
      .orderBy(desc(historicoAtividades.dataHora))
      .limit(limit);
  } catch (error) {
    handleDbError(error, "getHistoricoAtividadesPorEntidade");
  }
}

// ============================================================================
// SOLICITAÇÕES DE SEPARAÇÃO
// ============================================================================

export async function createSolicitacaoSeparacao(data: {
  usuarioSolicitante: string;
  observacaoSolicitante?: string;
  obraDestinoId?: number;
  dataLimite?: Date;
  usuarioId?: number;
  itens: {
    materialId: number;
    quantidadeSolicitada: number;
    loteId?: number;
    comprimentoEspecifico?: number;
  }[];
}) {
  const db = await getDb();

  // Formata Date para string MySQL "YYYY-MM-DD HH:MM:SS"
  // O mysql2 aceita esse formato sem ambiguidade de timezone
  const toMysqlDate = (d: Date) =>
    d.toISOString().slice(0, 19).replace("T", " ");

  const agora = toMysqlDate(new Date());
  const dataLimiteStr = data.dataLimite ? toMysqlDate(data.dataLimite) : null;

  // data_conclusao e createdAt são omitidas — MySQL usa DEFAULT NULL/DEFAULT NOW() automaticamente
  const [result] = await db.execute(sql`
    INSERT INTO solicitacoes_separacao
      (usuario_solicitante, observacao_solicitante, observacao_resposta,
       obra_destino_id, data_limite, status, data_solicitacao,
       updatedAt)
    VALUES
      (${data.usuarioSolicitante || "Sistema"},
       ${data.observacaoSolicitante || ""},
       ${""},
       ${data.obraDestinoId ?? null},
       ${dataLimiteStr},
       ${"pendente"},
       ${agora},
       ${agora})
  `) as any;

  const solicitacaoId = result.insertId;
  
  // 2. Criar os itens da solicitação e atualizar o status do material
  for (const item of data.itens) {
    await db.execute(sql`
      INSERT INTO itens_solicitacao (solicitacao_id, material_id, quantidade_solicitada, lote_id, comprimento_especifico)
      VALUES (
        ${solicitacaoId},
        ${item.materialId},
        ${item.quantidadeSolicitada},
        ${item.loteId ?? null},
        ${item.comprimentoEspecifico ?? null}
      )
    `).catch((err: any) => {
      throw new Error(`Falha ao inserir item_solicitacao (materialId=${item.materialId}): ${err.message}`);
    });
    
    // Marcar o material como solicitado — coluna status_solicitacao pode não existir
    await db.update(materiais).set({
      statusSolicitacao: "pendente"
    }).where(eq(materiais.id, item.materialId)).catch((err: any) => {
      console.warn(`[Aviso] Falha ao atualizar statusSolicitacao do material ${item.materialId}: ${err.message}`);
    });
  }
  
  // Registrar atividade
  await registrarAtividade(
    data.usuarioSolicitante,
    "CADASTRO",
    "SOLICITACAO",
    `Nova solicitação de separação criada (ID: ${solicitacaoId}) com ${data.itens.length} itens.`,
    data.usuarioId
  );
  
  return { id: solicitacaoId };
}

/**
 * Lista os lotes disponíveis de um material, juntando com os comprimentos
 * de barra do estoque ativo. Usado pelo solicitante para escolher o lote exato.
 */
export async function listLotesPorMaterial(materialId: number) {
  const db = await getDb();
  // Buscar lotes do material com seus estoques ativos
  const rows = await db
    .select({
      loteId: lotes.id,
      corridaNota: lotes.corridaNota,
      fornecedor: lotes.fornecedor,
      dataEntrada: lotes.dataEntrada,
      estoqueId: estoque.id,
      comprimentoBarra: estoque.comprimentoBarra,
      quantidade: estoque.quantidade,
      saldoAtual: estoque.saldoAtual,
    })
    .from(lotes)
    .innerJoin(estoque, and(eq(estoque.loteId, lotes.id), eq(estoque.ativo, true)))
    .where(and(eq(lotes.materialId, materialId), sql`${estoque.quantidade} > 0`))
    .orderBy(desc(lotes.dataEntrada));

  // Agrupar por lote
  const byLote = new Map<number, {
    loteId: number;
    corridaNota: string | null;
    fornecedor: string | null;
    dataEntrada: Date;
    barras: { estoqueId: number; comprimentoBarra: number; quantidade: number; saldoAtual: string }[];
  }>();

  for (const r of rows) {
    if (!byLote.has(r.loteId)) {
      byLote.set(r.loteId, {
        loteId: r.loteId,
        corridaNota: r.corridaNota,
        fornecedor: r.fornecedor,
        dataEntrada: r.dataEntrada,
        barras: [],
      });
    }
    byLote.get(r.loteId)!.barras.push({
      estoqueId: r.estoqueId,
      comprimentoBarra: r.comprimentoBarra,
      quantidade: r.quantidade,
      saldoAtual: String(r.saldoAtual),
    });
  }

  return Array.from(byLote.values());
}

export async function listSolicitacoesSeparacao() {
  const db = await getDb();
  // Buscar solicitações com seus itens e detalhes dos materiais
  const solicitacoes = await db.select({
    solicitacao: solicitacoesSeparacao,
    obraDestino: obras
  })
  .from(solicitacoesSeparacao)
  .leftJoin(obras, eq(solicitacoesSeparacao.obraDestinoId, obras.id))
  .orderBy(desc(solicitacoesSeparacao.dataSolicitacao));

  // Contagem de imagens por solicitação, numa consulta só (evita N+1).
  const todasImagens = await db.select({
    solicitacaoId: solicitacaoImagens.solicitacaoId,
    id: solicitacaoImagens.id,
  }).from(solicitacaoImagens);
  const contagemImagens = new Map<number, number>();
  todasImagens.forEach((img: any) => {
    contagemImagens.set(img.solicitacaoId, (contagemImagens.get(img.solicitacaoId) || 0) + 1);
  });

  const result = [];
  for (const row of solicitacoes) {
    const sol = row.solicitacao;
    const itens = await db.select({
      id: itensSolicitacao.id,
      quantidadeSolicitada: itensSolicitacao.quantidadeSolicitada,
      loteId: itensSolicitacao.loteId,
      comprimentoEspecifico: itensSolicitacao.comprimentoEspecifico,
      material: materiais
    })
    .from(itensSolicitacao)
    .innerJoin(materiais, eq(itensSolicitacao.materialId, materiais.id))
    .where(eq(itensSolicitacao.solicitacaoId, sol.id));
    
    result.push({
      ...sol,
      obraDestino: row.obraDestino,
      itens,
      totalImagens: contagemImagens.get(sol.id) || 0,
    });
  }
  
  return result;
}

export async function responderSolicitacao(id: number, observacaoResposta: string, usuarioNome: string = "Sistema") {
  const db = await getDb();
  await db.update(solicitacoesSeparacao).set({
    observacaoResposta,
    updatedAt: new Date()
  }).where(eq(solicitacoesSeparacao.id, id));
  
  await registrarAtividade(
    usuarioNome,
    "EDICAO",
    "SOLICITACAO",
    `Resposta adicionada à solicitação ID: ${id}`
  );
}

export async function atualizarObservacoesSeparacao(id: number, observacoesSeparacao: string, usuarioNome: string = "Sistema") {
  try {
    const db = await getDb();
    await db.update(solicitacoesSeparacao).set({
      observacoesSeparacao,
      updatedAt: new Date(),
    }).where(eq(solicitacoesSeparacao.id, id));
    await registrarAtividade(usuarioNome, "EDICAO", "SOLICITACAO", `Observações da separação atualizadas na solicitação #${id}.`);
    return { ok: true };
  } catch (error) {
    handleDbError(error, "atualizarObservacoesSeparacao");
  }
}

export async function uploadImagemSeparacao(
  solicitacaoId: number,
  imagem: { nomeArquivo: string; tipoArquivo: string; conteudoBase64: string },
  usuarioNome: string = "Sistema"
) {
  try {
    const db = await getDb();
    const buffer = Buffer.from(imagem.conteudoBase64, "base64");
    const [result] = await db.insert(solicitacaoImagens).values({
      solicitacaoId,
      nomeArquivo: imagem.nomeArquivo,
      tipoArquivo: imagem.tipoArquivo || "image/jpeg",
      tamanho: buffer.length,
      conteudo: buffer,
      usuarioNome,
    });
    return { id: (result as any)?.insertId };
  } catch (error) {
    handleDbError(error, "uploadImagemSeparacao");
  }
}

export async function listImagensSeparacao(solicitacaoId: number) {
  try {
    const db = await getDb();
    return await db.select({
      id: solicitacaoImagens.id,
      nomeArquivo: solicitacaoImagens.nomeArquivo,
      tipoArquivo: solicitacaoImagens.tipoArquivo,
      tamanho: solicitacaoImagens.tamanho,
      usuarioNome: solicitacaoImagens.usuarioNome,
      createdAt: solicitacaoImagens.createdAt,
    }).from(solicitacaoImagens).where(eq(solicitacaoImagens.solicitacaoId, solicitacaoId)).orderBy(desc(solicitacaoImagens.createdAt));
  } catch (error) {
    handleDbError(error, "listImagensSeparacao");
  }
}

export async function getImagemSeparacaoConteudo(id: number) {
  try {
    const db = await getDb();
    const rows = await db.select().from(solicitacaoImagens).where(eq(solicitacaoImagens.id, id)).limit(1);
    return rows[0] || null;
  } catch (error) {
    handleDbError(error, "getImagemSeparacaoConteudo");
  }
}

export async function deletarImagemSeparacao(id: number, usuarioNome: string = "Sistema") {
  try {
    const db = await getDb();
    await db.delete(solicitacaoImagens).where(eq(solicitacaoImagens.id, id));
    await registrarAtividade(usuarioNome, "EXCLUSAO", "SOLICITACAO", `Foto de separação removida (id ${id}).`);
    return { ok: true };
  } catch (error) {
    handleDbError(error, "deletarImagemSeparacao");
  }
}

export async function concluirSolicitacao(id: number, usuarioNome: string = "Sistema") {
  const db = await getDb();

  return await db.transaction(async (tx) => {
    // 1. Buscar a solicitação
    const [sol] = await tx
      .select()
      .from(solicitacoesSeparacao)
      .where(eq(solicitacoesSeparacao.id, id))
      .limit(1);
    if (!sol) throw new Error(`Solicitação ${id} não encontrada.`);
    if (sol.status === "concluido") throw new Error(`Solicitação ${id} já está concluída.`);

    // 2. Buscar os itens da solicitação
    const itens = await tx
      .select()
      .from(itensSolicitacao)
      .where(eq(itensSolicitacao.solicitacaoId, id));

    if (itens.length === 0) throw new Error(`Solicitação ${id} não possui itens.`);

    // 3. Para cada item: validar saldo, debitar quantidade e pesoTotal, registrar movimentação
    for (const item of itens) {
      // Buscar material atual
      const [mat] = await tx
        .select()
        .from(materiais)
        .where(eq(materiais.id, item.materialId))
        .limit(1);

      if (!mat) {
        throw new Error(`Material ID ${item.materialId} não encontrado.`);
      }

      const qtdAtual = mat.quantidade;
      const pesoAtual = parseFloat(String(mat.pesoTotal || "0"));

      if (qtdAtual < item.quantidadeSolicitada) {
        throw new Error(
          `Estoque insuficiente para ${mat.tipo} ${mat.bitola}: ` +
          `disponível ${qtdAtual} unid., solicitado ${item.quantidadeSolicitada} unid.`
        );
      }

      // Calcular novos valores
      const novaQtd = qtdAtual - item.quantidadeSolicitada;
      // Peso proporcional à quantidade debitada
      const pesoPorUnidade = qtdAtual > 0 ? pesoAtual / qtdAtual : 0;
      const pesoDebitado = +(pesoPorUnidade * item.quantidadeSolicitada).toFixed(3);
      const novoPeso = +(pesoAtual - pesoDebitado).toFixed(3);

      // Debitar na tabela materiais
      await tx
        .update(materiais)
        .set({
          quantidade: novaQtd,
          pesoTotal: String(Math.max(0, novoPeso)),
          statusSolicitacao: "concluido",
          updatedAt: new Date(),
        })
        .where(eq(materiais.id, item.materialId));

      // Registrar saída — usa a mesma tabela confiável de RegistrosSaida
      // (não mais "movimentacoes", que tinha usuarioId fixo em 1 e podia
      // quebrar a conclusão inteira se esse usuário não existisse mais).
      // Bônus: separações agora aparecem em "Registros de Saída" também.
      await tx.insert(registrosSaida).values({
        tipo: mat.tipo,
        bitola: mat.bitola,
        quantidade: item.quantidadeSolicitada,
        comprimento: mat.comprimento,
        pesoTotal: String(pesoDebitado),
        aco: mat.aco,
        obraNome: mat.obraNome,
        local: mat.local,
        fornecedor: mat.fornecedor,
        nf: mat.nf,
        numero_certificado: (mat as any).numero_certificado,
        corrida: mat.corrida,
        motivo: `Separação — Solicitação #${String(id).padStart(5, "0")}`,
        numeroPedido: (mat as any).numeroPedido || null,
        materialId: item.materialId,
        dataSaida: new Date(),
      });
    }

    // 4. Atualizar status da solicitação
    await tx
      .update(solicitacoesSeparacao)
      .set({
        status: "concluido",
        dataConclusao: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(solicitacoesSeparacao.id, id));

    // 5. Registrar no histórico
    await registrarAtividade(
      usuarioNome,
      "EDICAO",
      "SOLICITACAO",
      `Solicitação #${String(id).padStart(5, "0")} CONCLUÍDA — ${itens.length} item(ns) debitado(s) do estoque.`
    );

    return { sucesso: true, itensProcessados: itens.length };
  });
}


// ============================================================================
// AGREGAÇÃO DE DADOS PARA DASHBOARD
// ============================================================================

/**
 * Obter visão geral de materiais por obra (Disponível vs Consumido)
 */
export async function getVisaoGeralMateriais() {
  try {
    const db = await getDb();
    
    // Buscar todas as obras
    const todasObras = await db.select().from(obras).orderBy(desc(obras.createdAt));
    
    // Para cada obra, calcular o peso disponível, consumido e últimos itens
    const visaoGeral = await Promise.all(
      todasObras.map(async (obra) => {
        // Materiais ativos destinados à obra
        const disponivel = await db.select().from(materiais)
          .where(and(eq(materiais.ativo, true), eq(materiais.obraId, obra.id)))
          .orderBy(desc(materiais.createdAt));
        
        const pesoDisponivel = disponivel.reduce((sum, m) => {
          return sum + parseFloat(String(m.pesoTotal || 0));
        }, 0);

        // Últimos 3 materiais adicionados
        const ultimosAdicionados = disponivel.slice(0, 3).map((m) => ({
          id: m.id,
          descricao: `${m.tipo} ${m.bitola}${m.aco ? ` (${m.aco})` : ""}`,
          pesoTotal: parseFloat(String(m.pesoTotal || 0)),
          quantidade: m.quantidade,
          createdAt: m.createdAt,
        }));

        // Registros de saída da obra — peso consumido + últimos 3 usados
        const consumidoRows = await db.select().from(registrosSaida)
          .where(eq(registrosSaida.obraNome, obra.nome))
          .orderBy(desc(registrosSaida.dataSaida));
        
        const pesoConsumido = consumidoRows.reduce((sum, r) => {
          return sum + parseFloat(String(r.pesoTotal || 0));
        }, 0);

        const ultimosUsados = consumidoRows.slice(0, 3).map((r) => ({
          descricao: `${r.tipo} ${r.bitola}${r.aco ? ` (${r.aco})` : ""}`,
          pesoTotal: parseFloat(String(r.pesoTotal || 0)),
          quantidade: r.quantidade,
          dataSaida: r.dataSaida,
        }));

        return {
          id: obra.id,
          nome: obra.nome,
          cliente: obra.cliente,
          codigo: obra.codigo,
          localizacao: obra.localizacao,
          logoUrl: obra.logoUrl,
          status: obra.status,
          pesoDisponivel: parseFloat(pesoDisponivel.toFixed(3)),
          pesoConsumido: parseFloat(pesoConsumido.toFixed(3)),
          pesoTotal: parseFloat((pesoDisponivel + pesoConsumido).toFixed(3)),
          ultimosAdicionados,
          ultimosUsados,
        };
      })
    );

    // Adicionar "LIVRE" (materiais sem obra)
    const livres = await db.select().from(materiais)
      .where(and(eq(materiais.ativo, true), isNull(materiais.obraId)))
      .orderBy(desc(materiais.createdAt));
    
    const pesoLivre = livres.reduce((sum, m) => {
      return sum + parseFloat(String(m.pesoTotal || 0));
    }, 0);

    if (pesoLivre > 0) {
      const ultimosLivresAdicionados = livres.slice(0, 3).map((m) => ({
        id: m.id,
        descricao: `${m.tipo} ${m.bitola}${m.aco ? ` (${m.aco})` : ""}`,
        pesoTotal: parseFloat(String(m.pesoTotal || 0)),
        quantidade: m.quantidade,
        createdAt: m.createdAt,
      }));

      const livresUsados = await db.select().from(registrosSaida)
        .where(isNull(registrosSaida.obraNome))
        .orderBy(desc(registrosSaida.dataSaida))
        .limit(3);

      visaoGeral.unshift({
        id: 0,
        nome: "LIVRE",
        cliente: "Sem destinação",
        codigo: "LIVRE",
        localizacao: null,
        logoUrl: null,
        status: "ativa",
        pesoDisponivel: parseFloat(pesoLivre.toFixed(3)),
        pesoConsumido: 0,
        pesoTotal: parseFloat(pesoLivre.toFixed(3)),
        ultimosAdicionados: ultimosLivresAdicionados,
        ultimosUsados: livresUsados.map((r) => ({
          descricao: `${r.tipo} ${r.bitola}${r.aco ? ` (${r.aco})` : ""}`,
          pesoTotal: parseFloat(String(r.pesoTotal || 0)),
          quantidade: r.quantidade,
          dataSaida: r.dataSaida,
        })),
      });
    }

    // Ordenar por peso total (descendente) e pegar top 4
    return visaoGeral.sort((a, b) => b.pesoTotal - a.pesoTotal).slice(0, 4);
  } catch (error) {
    handleDbError(error, "getVisaoGeralMateriais");
  }
}

/**
 * Obter detalhes de consumo por obra (para gráficos avançados)
 */
export async function getDetalhesConsumoObra(obraId: number | null) {
  try {
    const db = await getDb();
    
    let obraNome = "LIVRE";
    if (obraId && obraId !== 0) {
      const obra = await db.select().from(obras).where(eq(obras.id, obraId)).limit(1);
      if (obra.length === 0) throw new Error("Obra não encontrada");
      obraNome = obra[0].nome;
    }

    // Registros de saída por dia
    const consumoPorDia = await db.select().from(registrosSaida)
      .where(eq(registrosSaida.obraNome, obraNome));

    // Agrupar por data
    const agrupado: Record<string, number> = {};
    consumoPorDia.forEach(r => {
      const data = new Date(r.dataSaida).toISOString().split('T')[0];
      agrupado[data] = (agrupado[data] || 0) + parseFloat(String(r.pesoTotal || 0));
    });

    // Materiais mais usados
    const materiaisMaisUsados: Record<string, number> = {};
    consumoPorDia.forEach(r => {
      const chave = `${r.tipo} ${r.bitola}`;
      materiaisMaisUsados[chave] = (materiaisMaisUsados[chave] || 0) + parseFloat(String(r.pesoTotal || 0));
    });

    return {
      consumoPorDia: Object.entries(agrupado).map(([data, peso]) => ({ data, peso })),
      materiaisMaisUsados: Object.entries(materiaisMaisUsados)
        .map(([material, peso]) => ({ material, peso }))
        .sort((a, b) => b.peso - a.peso)
        .slice(0, 10),
      totalConsumido: Object.values(agrupado).reduce((a, b) => a + b, 0),
    };
  } catch (error) {
    handleDbError(error, "getDetalhesConsumoObra");
  }
}


// ============================================================================
// BUSCA RÁPIDA
// ============================================================================

export async function buscaRapidaMaterial(termo: string) {
  try {
    const db = await getDb();
    const t = `%${termo.trim()}%`;

    // IMPORTANTE: Drizzle não encadeia dois .where() — o segundo sobrescreve o primeiro.
    // Usar and() para combinar ambas as condições numa única chamada.
    return await db
      .select({
        id: materiais.id,
        tipo: materiais.tipo,
        bitola: materiais.bitola,
        aco: materiais.aco,
        quantidade: materiais.quantidade,
        comprimento: materiais.comprimento,
        pesoTotal: materiais.pesoTotal,
        nf: materiais.nf,
        numero_certificado: materiais.numero_certificado,
        corrida: materiais.corrida,
        obraNome: materiais.obraNome,
        local: materiais.local,
        fornecedor: materiais.fornecedor,
      })
      .from(materiais)
      .where(
        and(
          eq(materiais.ativo, true),
          sql`(
            ${materiais.nf} LIKE ${t}
            OR ${materiais.numero_certificado} LIKE ${t}
            OR ${materiais.corrida} LIKE ${t}
            OR ${materiais.tipo} LIKE ${t}
            OR ${materiais.bitola} LIKE ${t}
            OR ${materiais.fornecedor} LIKE ${t}
          )`
        )
      )
      .limit(20);
  } catch (error) {
    handleDbError(error, "buscaRapidaMaterial");
  }
}

// ============================================================================
// EXPORTAÇÃO DE MOVIMENTAÇÕES COM FILTROS — Semana 2 Item 10
// ============================================================================

export async function exportarMovimentacoesFiltradas(filtros: {
  obraId?: number | null;
  dataInicio?: string | Date | null;
  dataFim?: string | Date | null;
}) {
  try {
    const db = await getDb();

    // Antes os filtros de data/obra eram aplicados em memória DEPOIS de já
    // ter buscado só as 5000 movimentações mais recentes — um período mais
    // antigo que essas 5000 vinha vazio, sem aviso nenhum. Agora os filtros
    // vão direto pro WHERE do SQL, então o corte de segurança abaixo só
    // limita o que já foi filtrado corretamente.
    const condicoes: any[] = [];

    // dataInicio podia chegar como string ("2024-01-01") comparada
    // diretamente com `<` contra um Date — em JS isso nunca é verdadeiro
    // (a string vira NaN na comparação), então o filtro de início nunca
    // filtrava nada. Convertendo explicitamente pra Date aqui.
    if (filtros.dataInicio) {
      const inicio = new Date(filtros.dataInicio as any);
      if (!Number.isNaN(inicio.getTime())) condicoes.push(gte(movimentacoes.dataHora, inicio));
    }
    if (filtros.dataFim) {
      const fim = new Date(filtros.dataFim as any);
      if (!Number.isNaN(fim.getTime())) {
        fim.setHours(23, 59, 59, 999);
        condicoes.push(lte(movimentacoes.dataHora, fim));
      }
    }
    if (filtros.obraId != null) {
      // obraId 0 = "Estoque livre" = material sem obra vinculada (obraId
      // NULL no banco, nunca 0). Comparar com `=== 0` direto nunca batia.
      condicoes.push(filtros.obraId === 0 ? isNull(materiais.obraId) : eq(materiais.obraId, filtros.obraId));
    }
    // Não exclui movimentação cujo material foi apagado (materiais.excluirRelatorios vem NULL no left join).
    condicoes.push(or(isNull(materiais.excluirRelatorios), eq(materiais.excluirRelatorios, false)) as any);

    const rows = await db
      .select({
        id: movimentacoes.id,
        tipo: movimentacoes.tipo,
        quantidade: movimentacoes.quantidade,
        saldoAnterior: movimentacoes.saldoAnterior,
        saldoPosterior: movimentacoes.saldoPosterior,
        observacao: movimentacoes.observacao,
        dataHora: movimentacoes.dataHora,
        estoqueId: movimentacoes.estoqueId,
        referenciaType: movimentacoes.referenciaType,
        referenciaId: movimentacoes.referenciaId,
        materialTipo: materiais.tipo,
        materialBitola: materiais.bitola,
        materialAco: materiais.aco,
        obraNome: materiais.obraNome,
        obraId: materiais.obraId,
      })
      .from(movimentacoes)
      // leftJoin (não innerJoin) pra não sumir com movimentações de material
      // já deletado — mantém o histórico completo, só perde o enriquecimento.
      .leftJoin(materiais, eq(movimentacoes.estoqueId, materiais.id))
      .where(condicoes.length ? and(...condicoes) : undefined)
      .orderBy(desc(movimentacoes.dataHora))
      // Corte de segurança pra exportação — agora aplicado DEPOIS do filtro
      // real de período/obra, não antes.
      .limit(20000);

    return rows.map((mov) => ({
      id: mov.id,
      dataHora: mov.dataHora,
      tipo: mov.tipo,
      materialDescricao: mov.materialTipo
        ? `${mov.materialTipo} ${mov.materialBitola}${mov.materialAco ? ` (${mov.materialAco})` : ""}`
        : `ID ${mov.estoqueId}`,
      obraNome: mov.obraNome || "LIVRE",
      obraId: mov.obraId ?? null,
      quantidade: mov.quantidade,
      saldoAnterior: mov.saldoAnterior,
      saldoPosterior: mov.saldoPosterior,
      observacao: mov.observacao || "",
      referencia: mov.referenciaType ? `${mov.referenciaType} #${mov.referenciaId}` : "",
    }));
  } catch (error) {
    handleDbError(error, "exportarMovimentacoesFiltradas");
  }
}


// ============================================================================
// INVENTÁRIO FÍSICO
// ============================================================================

export async function listInventarios() {
  try {
    const db = await getDb();
    return await db.select().from(inventarios).orderBy(desc(inventarios.createdAt));
  } catch (error) {
    handleDbError(error, "listInventarios");
  }
}

export async function createInventario(data: any) {
  try {
    const db = await getDb();
    const result = await db.insert(inventarios).values({
      numero: data.numero,
      descricao: data.descricao || null,
      observacoes: data.observacoes || null,
      usuarioAbertura: data.usuarioAbertura || data.usuario || "Sistema",
      status: "aberto",
    });
    return result;
  } catch (error) {
    handleDbError(error, "createInventario");
  }
}

export async function updateInventario(id: number, data: any) {
  try {
    const db = await getDb();
    return await db.update(inventarios).set(data).where(eq(inventarios.id, id));
  } catch (error) {
    handleDbError(error, "updateInventario");
  }
}

export async function deleteInventario(id: number) {
  try {
    const db = await getDb();
    return await db.delete(inventarios).where(eq(inventarios.id, id));
  } catch (error) {
    handleDbError(error, "deleteInventario");
  }
}

export async function abrirInventario(id: number, usuario: string) {
  try {
    const db = await getDb();

    return await db.transaction(async (tx) => {
      // 1. Verificar se o inventário existe e está no estado correto
      const [inv] = await tx.select().from(inventarios).where(eq(inventarios.id, id)).limit(1);
      if (!inv) throw new Error(`Inventário ${id} não encontrado.`);
      if (inv.status !== "aberto") throw new Error(`Inventário já está em "${inv.status}" — não pode ser reaberto.`);

      // 2. Limpar itens anteriores caso exista reentrada
      await tx.delete(itensInventario).where(eq(itensInventario.inventarioId, id));

      // 3. Buscar todos os materiais ativos e criar snapshot dos saldos atuais
      const mats = await tx
        .select({
          id: materiais.id,
          quantidade: materiais.quantidade,
          pesoTotal: materiais.pesoTotal,
        })
        .from(materiais)
        .where(eq(materiais.ativo, true));

      if (mats.length === 0) throw new Error("Nenhum material ativo encontrado para inventariar.");

      // 4. Inserir um item de inventário por material com a QUANTIDADE em unidades (não kg)
      const itens = mats.map((m) => ({
        inventarioId: id,
        materialId: m.id,
        quantidadeSistema: String(m.quantidade ?? 0),  // unidades, não kg
        status: "pendente" as const,
      }));

      // Inserir em lotes de 50 para evitar limites de parâmetros SQL
      const LOTE = 50;
      for (let i = 0; i < itens.length; i += LOTE) {
        await tx.insert(itensInventario).values(itens.slice(i, i + LOTE));
      }

      // 5. Atualizar status do inventário
      await tx.update(inventarios)
        .set({ status: "em_contagem", usuarioAbertura: usuario, updatedAt: new Date() })
        .where(eq(inventarios.id, id));

      await registrarAtividade(
        usuario,
        "EDICAO",
        "INVENTARIO",
        `Inventário #${inv.numero} aberto para contagem — snapshot de ${mats.length} materiais gerado.`
      );

      return { sucesso: true, totalMateriais: mats.length };
    });
  } catch (error) {
    handleDbError(error, "abrirInventario");
  }
}

export async function fecharInventario(id: number, usuario: string) {
  try {
    const db = await getDb();
    return await db.update(inventarios).set({
      status: "fechado",
      dataFechamento: new Date(),
      usuarioFechamento: usuario,
    }).where(eq(inventarios.id, id));
  } catch (error) {
    handleDbError(error, "fecharInventario");
  }
}

/**
 * Relatório de Divergência — lista só as divergências NEGATIVAS (material
 * faltando) de inventários já processados, com o motivo escrito na hora da
 * contagem. Serve pra conferência semanal e acompanhamento de requisição.
 */
export async function listDivergenciasNegativas() {
  try {
    const db = await getDb();
    const rows = await db.select({
      id: itensInventario.id,
      inventarioId: itensInventario.inventarioId,
      inventarioNumero: inventarios.numero,
      inventarioData: inventarios.dataFechamento,
      quantidadeSistema: itensInventario.quantidadeSistema,
      quantidadeContada: itensInventario.quantidadeContada,
      divergencia: itensInventario.divergencia,
      percentualDivergencia: itensInventario.percentualDivergencia,
      observacoes: itensInventario.observacoes,
      justificativa: itensInventario.justificativa,
      justificadoEm: itensInventario.justificadoEm,
      justificadoPor: itensInventario.justificadoPor,
      material: materiais,
    })
      .from(itensInventario)
      .innerJoin(materiais, eq(itensInventario.materialId, materiais.id))
      .innerJoin(inventarios, eq(itensInventario.inventarioId, inventarios.id))
      .where(sql`${itensInventario.divergencia} < 0`)
      .orderBy(desc(inventarios.id));
    return rows;
  } catch (error) {
    handleDbError(error, "listDivergenciasNegativas");
  }
}

/**
 * Justificativa de divergência — feita depois do inventário já processado,
 * direto no Relatório de Divergência. Não mexe em estoque nem desfaz a baixa
 * já feita (o material continua fora do estoque físico) — só documenta pra
 * onde ele foi, marcando o item como explicado.
 */
export async function justificarDivergencia(itemInventarioId: number, justificativa: string, usuarioNome: string = "Sistema") {
  try {
    const db = await getDb();
    await db.update(itensInventario)
      .set({
        justificativa,
        justificadoEm: new Date(),
        justificadoPor: usuarioNome,
        updatedAt: new Date(),
      })
      .where(eq(itensInventario.id, itemInventarioId));

    await registrarAtividade(
      usuarioNome,
      "EDICAO",
      "INVENTARIO",
      `Divergência justificada (item #${itemInventarioId}): ${justificativa}`
    );

    return { ok: true };
  } catch (error) {
    handleDbError(error, "justificarDivergencia");
  }
}

export async function processarAjustesInventario(id: number, usuarioId: number = 1, usuarioNome: string = "Sistema") {
  try {
    const db = await getDb();

    return await db.transaction(async (tx) => {
      // 1. Validar inventário
      const [inv] = await tx.select().from(inventarios).where(eq(inventarios.id, id)).limit(1);
      if (!inv) throw new Error(`Inventário ${id} não encontrado.`);
      if (inv.status !== "fechado") throw new Error(`Inventário precisa estar "fechado" para processar ajustes. Status atual: "${inv.status}".`);

      // 2. Buscar itens que foram contados (quantidadeContada preenchida)
      const itens = await tx
        .select()
        .from(itensInventario)
        .where(
          and(
            eq(itensInventario.inventarioId, id),
            sql`${itensInventario.quantidadeContada} IS NOT NULL`
          )
        );

      if (itens.length === 0) throw new Error("Nenhum item contado encontrado. Realize a contagem antes de processar.");

      let totalAjustes = 0;
      let totalDivergencias = 0;

      for (const item of itens) {
        const saldoSistema = parseFloat(String(item.quantidadeSistema || "0"));
        const saldoContado = parseFloat(String(item.quantidadeContada || "0"));
        const divergencia = +(saldoContado - saldoSistema).toFixed(2);
        // Teto de segurança — evita estourar a coluna mesmo em casos
        // extremos (ex: saldoSistema muito pequeno gerando percentual
        // gigante). DECIMAL(8,2) aguenta até 999999.99; travamos bem
        // abaixo disso, já que um percentual assim já significa "não bateu
        // nada" de qualquer forma.
        const percentual = saldoSistema > 0
          ? Math.min(99999.99, +((Math.abs(divergencia) / saldoSistema) * 100).toFixed(2))
          : 0;

        // Atualizar divergência no item
        await tx.update(itensInventario)
          .set({
            divergencia: String(divergencia),
            percentualDivergencia: String(percentual),
            status: "ajustado",
            updatedAt: new Date(),
          })
          .where(eq(itensInventario.id, item.id));

        // Só gera ajuste se houver divergência real
        if (divergencia === 0) continue;

        totalDivergencias++;
        const tipo = divergencia > 0 ? "entrada" : "saida";
        const qtdAbsoluta = Math.abs(divergencia);

        // Buscar material atual (completo, pra poder gerar o registro de saída se for divergência negativa)
        const [mat] = await tx.select()
          .from(materiais)
          .where(eq(materiais.id, item.materialId))
          .limit(1);

        if (!mat) continue;

        const pesoAtual = parseFloat(String(mat.pesoTotal || "0"));
        const qtdAtual = mat.quantidade || 1;
        // Converter divergência de unidades para kg usando peso proporcional
        const pesoPorUnidade = qtdAtual > 0 ? pesoAtual / qtdAtual : 0;
        const divergenciaKg = +(divergencia * pesoPorUnidade).toFixed(3);
        const novoPeso = +(pesoAtual + divergenciaKg).toFixed(3);

        // Atualizar quantidade e pesoTotal no material — se a contagem
        // zerou o saldo, desativa o material (mesmo padrão de uma baixa
        // total) em vez de deixá-lo listado com quantidade 0.
        const quantidadeFinal = Math.max(0, qtdAtual + divergencia);
        await tx.update(materiais)
          .set({
            quantidade: quantidadeFinal,
            pesoTotal: String(Math.max(0, novoPeso)),
            ativo: quantidadeFinal > 0,
            updatedAt: new Date(),
          })
          .where(eq(materiais.id, item.materialId));

        // Registrar ajuste na tabela ajustes_inventario
        await tx.insert(ajustesInventario).values({
          inventarioId: id,
          itemInventarioId: item.id,
          materialId: item.materialId,
          tipo,
          quantidade: String(qtdAbsoluta),
          motivo: `Inventário físico #${inv.numero} — divergência de ${divergencia > 0 ? "+" : ""}${divergencia} un (${divergenciaKg > 0 ? "+" : ""}${divergenciaKg} kg)`,
          status: "aplicado",
        });

        // Registrar movimentação de estoque para auditoria
        await tx.insert(movimentacoes).values({
          estoqueId: item.materialId,
          tipo: "ajuste",
          quantidade: String(qtdAbsoluta),
          saldoAnterior: String(pesoAtual.toFixed(2)),
          saldoPosterior: String(Math.max(0, novoPeso).toFixed(2)),
          referenciaType: "inventario",
          referenciaId: id,
          usuarioId,
          observacao: `Ajuste automático — Inventário #${inv.numero} | ${mat.tipo} ${mat.bitola} | ${tipo === "entrada" ? "+" : "-"}${qtdAbsoluta} unid. (${divergenciaKg > 0 ? "+" : ""}${divergenciaKg.toFixed(3)} kg)`,
          dataHora: new Date(),
        });

        // Divergência NEGATIVA (faltou material) — gera um Registro de Saída
        // de verdade, com destino "CONSUMO NÃO ALOCADO", pra aparecer nos
        // gráficos de consumo do Dashboard igual qualquer outra saída. O
        // motivo vem do que foi escrito na hora da contagem (campo
        // observacoes do item), com um texto padrão como reserva.
        if (divergencia < 0) {
          await tx.insert(registrosSaida).values({
            tipo: mat.tipo,
            bitola: mat.bitola,
            quantidade: qtdAbsoluta,
            comprimento: mat.comprimento,
            pesoTotal: String(Math.abs(divergenciaKg)),
            aco: mat.aco,
            obraNome: "CONSUMO NÃO ALOCADO",
            local: mat.local,
            fornecedor: mat.fornecedor,
            nf: mat.nf,
            numero_certificado: (mat as any).numero_certificado,
            corrida: mat.corrida,
            motivo: item.observacoes || `Divergência de inventário — Inventário #${inv.numero}, motivo não informado na contagem.`,
            numeroPedido: (mat as any).numeroPedido || null,
            materialId: item.materialId,
            dataSaida: new Date(),
          });
        }

        totalAjustes++;
      }

      // 3. Marcar inventário como processado
      await tx.update(inventarios)
        .set({ status: "processado", updatedAt: new Date() })
        .where(eq(inventarios.id, id));

      await registrarAtividade(
        usuarioNome,
        "EDICAO",
        "INVENTARIO",
        `Inventário #${inv.numero} PROCESSADO — ${totalDivergencias} divergência(s) encontrada(s), ${totalAjustes} ajuste(s) aplicado(s).`,
        usuarioId
      );

      return {
        sucesso: true,
        totalItensContados: itens.length,
        totalDivergencias,
        totalAjustes,
      };
    });
  } catch (error) {
    handleDbError(error, "processarAjustesInventario");
  }
}

// ============================================================================
// INVENTÁRIO — funções complementares
// ============================================================================

/**
 * Lista os itens de um inventário, enriquecidos com dados do material.
 */
export async function listItensInventario(inventarioId: number) {
  try {
    const db = await getDb();

    const itens = await db
      .select({
        id: itensInventario.id,
        inventarioId: itensInventario.inventarioId,
        materialId: itensInventario.materialId,
        quantidadeSistema: itensInventario.quantidadeSistema,
        quantidadeContada: itensInventario.quantidadeContada,
        divergencia: itensInventario.divergencia,
        percentualDivergencia: itensInventario.percentualDivergencia,
        status: itensInventario.status,
        observacoes: itensInventario.observacoes,
        updatedAt: itensInventario.updatedAt,
      })
      .from(itensInventario)
      .where(eq(itensInventario.inventarioId, inventarioId))
      .orderBy(itensInventario.id);

    // Enriquecer com dados do material
    const enriquecidos = await Promise.all(
      itens.map(async (item) => {
        const [mat] = await db
          .select({
            tipo: materiais.tipo,
            bitola: materiais.bitola,
            aco: materiais.aco,
            quantidade: materiais.quantidade,
            comprimento: materiais.comprimento,
            local: materiais.local,
            obraNome: materiais.obraNome,
          })
          .from(materiais)
          .where(eq(materiais.id, item.materialId))
          .limit(1);

        return {
          ...item,
          material: mat ?? null,
        };
      })
    );

    return enriquecidos;
  } catch (error) {
    handleDbError(error, "listItensInventario");
  }
}

/**
 * Persiste a contagem física de vários itens de um inventário.
 * Atualiza quantidadeContada e marca o item como "contado".
 */
export async function salvarContagemInventario(
  inventarioId: number,
  itens: Array<{ itemId: number; quantidadeContada: number; observacoes?: string }>
) {
  try {
    const db = await getDb();

    return await db.transaction(async (tx) => {
      // Validar inventário
      const [inv] = await tx.select().from(inventarios)
        .where(eq(inventarios.id, inventarioId)).limit(1);
      if (!inv) throw new Error("Inventário não encontrado.");
      if (inv.status !== "em_contagem") throw new Error("Inventário não está em contagem.");

      for (const it of itens) {
        await tx.update(itensInventario)
          .set({
            quantidadeContada: String(it.quantidadeContada.toFixed(2)),
            status: "contado",
            observacoes: it.observacoes ?? null,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(itensInventario.id, it.itemId),
              eq(itensInventario.inventarioId, inventarioId)
            )
          );
      }

      return { sucesso: true, itensAtualizados: itens.length };
    });
  } catch (error) {
    handleDbError(error, "salvarContagemInventario");
  }
}

// ============================================================================
// INVENTÁRIO — MATERIAL FORA DO CADASTRO (pendente de análise)
// ============================================================================

function textoOuNull(v: unknown) {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

/**
 * Material achado na contagem que não está no cadastro. Não entra na tabela
 * materiais — fica pendente até alguém analisar a origem (aprovar/reprovar).
 */
export async function criarMaterialPendenteInventario(data: {
  inventarioId: number;
  categoria: string;
  tipo: string;
  bitola: string;
  aco: string;
  quantidade: number;
  comprimento: number;
  largura?: number;
  local?: string;
  obraId?: number;
  fornecedor?: string;
  nf?: string;
  numeroCertificado?: string;
  corrida?: string;
  origem: string;
}, usuarioNome: string) {
  const db = await getDb();

  const [inv] = await db.select().from(inventarios).where(eq(inventarios.id, data.inventarioId)).limit(1);
  if (!inv) throw new Error("Inventário não encontrado.");
  if (inv.status !== "em_contagem") throw new Error("Só dá pra cadastrar material durante a contagem do inventário.");
  if (data.categoria === "CHAPA" && !(data.largura && data.largura > 0)) {
    throw new Error("Informe a largura da chapa.");
  }

  let obraNome: string | null = null;
  if (data.obraId) {
    const [obra] = await db.select({ nome: obras.nome }).from(obras).where(eq(obras.id, data.obraId)).limit(1);
    obraNome = obra?.nome ?? null;
  }

  const [result] = await db.insert(materiaisPendentesInventario).values({
    inventarioId: data.inventarioId,
    categoria: data.categoria === "CHAPA" ? "CHAPA" : "PERFIL",
    tipo: data.tipo.trim().toUpperCase(),
    bitola: data.bitola.trim().toUpperCase(),
    aco: data.aco.trim().toUpperCase(),
    quantidade: data.quantidade,
    comprimento: data.comprimento,
    largura: data.categoria === "CHAPA" ? data.largura ?? null : null,
    local: textoOuNull(data.local),
    obraId: data.obraId || null,
    obraNome,
    fornecedor: textoOuNull(data.fornecedor),
    nf: textoOuNull(data.nf),
    numeroCertificado: textoOuNull(data.numeroCertificado),
    corrida: textoOuNull(data.corrida),
    origem: data.origem.trim(),
    cadastradoPor: usuarioNome,
  });

  await registrarAtividade(
    usuarioNome,
    "CADASTRO",
    "INVENTARIO",
    `Inventário #${inv.numero}: material fora do cadastro registrado para análise — ${data.tipo} ${data.bitola} (${data.quantidade} un.)`
  );

  return { id: (result as any)?.insertId ?? null };
}

export async function listarMateriaisPendentesInventario(filtro: { inventarioId?: number; status?: "pendente" | "aprovado" | "reprovado" } = {}) {
  const db = await getDb();
  const condicoes: SQL[] = [];
  if (filtro.inventarioId) condicoes.push(eq(materiaisPendentesInventario.inventarioId, filtro.inventarioId));
  if (filtro.status) condicoes.push(eq(materiaisPendentesInventario.status, filtro.status));
  return await db
    .select({ ...getTableColumns(materiaisPendentesInventario), inventarioNumero: inventarios.numero })
    .from(materiaisPendentesInventario)
    .leftJoin(inventarios, eq(inventarios.id, materiaisPendentesInventario.inventarioId))
    .where(condicoes.length ? and(...condicoes) : undefined)
    .orderBy(desc(materiaisPendentesInventario.createdAt));
}

/** Pode ser removido enquanto ainda está pendente (ex.: cadastrou errado). */
export async function cancelarMaterialPendenteInventario(id: number, usuarioNome: string) {
  const db = await getDb();
  const [pend] = await db.select().from(materiaisPendentesInventario).where(eq(materiaisPendentesInventario.id, id)).limit(1);
  if (!pend) throw new Error("Cadastro não encontrado.");
  if (pend.status !== "pendente") throw new Error("Esse cadastro já foi analisado e não pode mais ser removido.");
  await db.delete(materiaisPendentesInventario).where(eq(materiaisPendentesInventario.id, id));
  await registrarAtividade(
    usuarioNome,
    "EXCLUSAO",
    "INVENTARIO",
    `Cadastro pendente de material removido antes da análise — ${pend.tipo} ${pend.bitola} (${pend.quantidade} un.)`
  );
  return { sucesso: true };
}

/**
 * Aprovado: vira material de verdade, pelo mesmo caminho do cadastro normal
 * (createMaterial — peso calculado pela especificação, registro de entrada,
 * histórico). A origem e o parecer vão nas observações do material.
 */
export async function aprovarMaterialPendenteInventario(id: number, parecer: string | undefined, usuarioNome: string) {
  const db = await getDb();
  const [pend] = await db.select().from(materiaisPendentesInventario).where(eq(materiaisPendentesInventario.id, id)).limit(1);
  if (!pend) throw new Error("Cadastro não encontrado.");
  if (pend.status !== "pendente") throw new Error("Esse cadastro já foi analisado.");

  // Trava o registro antes de criar o material — dois cliques/aprovadores
  // ao mesmo tempo não geram material duplicado.
  const [trava] = await db.update(materiaisPendentesInventario)
    .set({ status: "aprovado", analisadoPor: usuarioNome, analisadoEm: new Date(), parecer: textoOuNull(parecer) })
    .where(and(eq(materiaisPendentesInventario.id, id), eq(materiaisPendentesInventario.status, "pendente")));
  if (!(trava as any)?.affectedRows) throw new Error("Esse cadastro já foi analisado.");

  const [inv] = await db.select({ numero: inventarios.numero }).from(inventarios).where(eq(inventarios.id, pend.inventarioId)).limit(1);
  const parecerLimpo = textoOuNull(parecer);
  const observacoes = [
    `Recadastrado pelo inventário #${inv?.numero ?? pend.inventarioId} (encontrado na contagem por ${pend.cadastradoPor}).`,
    `Origem: ${pend.origem}`,
    parecerLimpo ? `Análise (${usuarioNome}): ${parecerLimpo}` : null,
  ].filter(Boolean).join("\n");

  try {
    const result: any = await createMaterial({
      categoria: pend.categoria,
      tipo: pend.tipo,
      bitola: pend.bitola,
      aco: pend.aco,
      quantidade: pend.quantidade,
      comprimento: pend.comprimento,
      largura: pend.largura ?? 0,
      local: pend.local,
      obraId: pend.obraId,
      obraNome: pend.obraNome,
      fornecedor: pend.fornecedor,
      nf: pend.nf,
      numeroCertificado: pend.numeroCertificado,
      corrida: pend.corrida,
      observacoes,
    }, usuarioNome);
    const materialId = result?.insertId ?? null;
    await db.update(materiaisPendentesInventario).set({ materialId }).where(eq(materiaisPendentesInventario.id, id));
    return { sucesso: true, materialId };
  } catch (err) {
    // Material não foi criado — volta pra pendente pra poder tentar de novo.
    await db.update(materiaisPendentesInventario)
      .set({ status: "pendente", analisadoPor: null, analisadoEm: null, parecer: null })
      .where(eq(materiaisPendentesInventario.id, id));
    throw err;
  }
}

/** Reprovado: nunca entra na lista de materiais — só fica o registro da análise. */
export async function reprovarMaterialPendenteInventario(id: number, parecer: string, usuarioNome: string) {
  const db = await getDb();
  const [trava] = await db.update(materiaisPendentesInventario)
    .set({ status: "reprovado", analisadoPor: usuarioNome, analisadoEm: new Date(), parecer: parecer.trim() })
    .where(and(eq(materiaisPendentesInventario.id, id), eq(materiaisPendentesInventario.status, "pendente")));
  if (!(trava as any)?.affectedRows) throw new Error("Esse cadastro não está mais pendente de análise.");
  const [pend] = await db.select().from(materiaisPendentesInventario).where(eq(materiaisPendentesInventario.id, id)).limit(1);
  await registrarAtividade(
    usuarioNome,
    "EXCLUSAO",
    "INVENTARIO",
    `Material fora do cadastro reprovado na análise — ${pend?.tipo} ${pend?.bitola} (${pend?.quantidade} un.). Motivo: ${parecer.trim()}`
  );
  return { sucesso: true };
}


// ============================================================================
// GERENCIAMENTO DE USUÁRIOS
// ============================================================================

export async function createUser(data: {
  name: string;
  email: string;
  password: string;
  role: "owner" | "admin" | "supervisor" | "operator" | "viewer";
  cargo?: string;
}, usuarioNome: string = "Sistema") {
  try {
    const db = await getDb();

    // Checar e-mail duplicado
    const existing = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, data.email))
      .limit(1);
    if (existing.length > 0) {
      throw new Error("E-mail já cadastrado no sistema.");
    }

    const passwordHash = hashPassword(data.password);
    const openId = `local_${nanoid(21)}`;
    const cargo = data.cargo || null;

    await db.execute(sql`
      INSERT INTO users (openId, name, email, password_hash, loginMethod, role, cargo, ativo)
      VALUES (${openId}, ${data.name}, ${data.email}, ${passwordHash}, 'local', ${data.role}, ${cargo}, 1)
    `);

    // Retornar o usuário criado (sem hash)
    const createdRows = await db.execute(sql`
      SELECT id, name, email, role, cargo, COALESCE(ativo, 1) AS ativo, createdAt
      FROM users WHERE email = ${data.email} LIMIT 1
    `);
    await registrarAtividade(usuarioNome, "CADASTRO", "USUARIO", `Novo usuário criado: ${data.name} (${data.email}) — role: ${data.role}${cargo ? ` — cargo: ${cargo}` : ""}`);
    return (createdRows[0] as any[])[0];
  } catch (error: any) {
    if (error.message?.includes("E-mail já cadastrado")) throw error;
    handleDbError(error, "createUser");
  }
}

export async function deleteUser(id: number, usuarioNome: string = "Sistema") {
  try {
    const db = await getDb();
    const target = await db.select({ name: users.name, email: users.email }).from(users).where(eq(users.id, id)).limit(1);
    await db.delete(users).where(eq(users.id, id));
    if (target[0]) {
      await registrarAtividade(usuarioNome, "EXCLUSAO", "USUARIO", `Usuário removido: ${target[0].name} (${target[0].email})`);
    }
    return { success: true };
  } catch (error) {
    handleDbError(error, "deleteUser");
  }
}

export async function listUsers() {
  try {
    const db = await getDb();
    // Usa SQL raw para ser resiliente a colunas que podem não existir
    // antes da migration 0008 ser rodada
    const rows = await db.execute(sql`
      SELECT
        id,
        name,
        email,
        role,
        COALESCE(cargo, '')              AS cargo,
        createdAt,
        lastSignedIn,
        loginMethod,
        COALESCE(ativo, 1)          AS ativo,
        CASE WHEN password_hash IS NOT NULL THEN 1 ELSE 0 END AS temSenha
      FROM users
      ORDER BY createdAt DESC
    `);
    return (rows[0] as any[]).map((r: any) => ({
      id: r.id,
      name: r.name,
      email: r.email,
      role: r.role,
      cargo: r.cargo || null,
      ativo: r.ativo === 1 || r.ativo === true,
      temSenha: r.temSenha === 1,
      createdAt: r.createdAt,
      lastSignedIn: r.lastSignedIn,
      loginMethod: r.loginMethod,
    }));
  } catch (error) {
    handleDbError(error, "listUsers");
  }
}

export async function getUserById(id: number) {
  try {
    const db = await getDb();
    const rows = await db.execute(sql`
      SELECT id, name, email, role,
             COALESCE(ativo, 1) AS ativo,
             createdAt, lastSignedIn, loginMethod
      FROM users WHERE id = ${id} LIMIT 1
    `);
    const result = rows[0] as any[];
    return result.length > 0 ? result[0] : null;
  } catch (error) {
    handleDbError(error, "getUserById");
  }
}

export async function updateUser(id: number, data: any, usuarioNome: string = "Sistema") {
  try {
    const db = await getDb();
    const alvo = await db.select({ name: users.name }).from(users).where(eq(users.id, id)).limit(1);

    const updateData: Record<string, any> = {};
    if (data.name  !== undefined) updateData.name  = data.name;
    if (data.email !== undefined) updateData.email = data.email;
    if (data.role  !== undefined) updateData.role  = data.role;
    if (data.cargo !== undefined) updateData.cargo = data.cargo || null;
    if (data.ativo !== undefined) updateData.ativo = data.ativo ? 1 : 0;

    // Senha: aceita tanto novaSenha (routers) quanto password
    const novaSenha = data.novaSenha || data.password;
    if (novaSenha && String(novaSenha).trim().length >= 6) {
      updateData.password_hash = hashPassword(String(novaSenha).trim());
    }

    if (Object.keys(updateData).length === 0) return { success: true };

    await db.update(users).set(updateData).where(eq(users.id, id));

    await registrarAtividade(
      usuarioNome,
      "ATUALIZACAO",
      "USUARIO",
      `Usuário "${alvo.length > 0 ? alvo[0].name : id}" atualizado: ${Object.keys(updateData).filter(k => k !== "password_hash").join(", ")}${updateData.password_hash ? " + senha" : ""}`
    );

    return { success: true };
  } catch (error) {
    handleDbError(error, "updateUser");
  }
}

export async function deactivateUser(id: number) {
  try {
    const db = await getDb();
    await db.execute(sql`UPDATE users SET ativo = 0 WHERE id = ${id}`);
    return { success: true };
  } catch (error) {
    handleDbError(error, "deactivateUser");
  }
}

export async function activateUser(id: number) {
  try {
    const db = await getDb();
    await db.execute(sql`UPDATE users SET ativo = 1 WHERE id = ${id}`);
    return { success: true };
  } catch (error) {
    handleDbError(error, "activateUser");
  }
}
// ─── Funções necessárias para autenticação local ──────────────────────────────

// export async function getUserByOpenId(openId: string) {
//   const db = await getDb();
//   const rows = await db
//     .select()
//     .from(users)
//     .where(eq(users.openId, openId))
//     .limit(1);
//   return rows[0] ?? null;
// }

export async function upsertUser(data: {
  openId: string;
  name?: string | null;
  email?: string | null;
  loginMethod?: string | null;
  lastSignedIn?: Date;
}) {
  const db = await getDb();
  const existing = await getUserByOpenId(data.openId);

  if (existing) {
    await db
      .update(users)
      .set({
        ...(data.name !== undefined && { name: data.name }),
        ...(data.email !== undefined && { email: data.email }),
        ...(data.loginMethod !== undefined && { loginMethod: data.loginMethod }),
        ...(data.lastSignedIn !== undefined && { lastSignedIn: data.lastSignedIn }),
      })
      .where(eq(users.openId, data.openId));
  } else {
    await db.insert(users).values({
      openId: data.openId,
      name: data.name ?? null,
      email: data.email ?? null,
      loginMethod: data.loginMethod ?? null,
      lastSignedIn: data.lastSignedIn ?? new Date(),
      role: "operator",
      ativo: true,
    });
  }
}
// =============================================================================
// ADICIONAR AO FINAL DE server/db.ts
// Cole todo este conteúdo no final do arquivo server/db.ts
// =============================================================================

// ─── Aliases para solicitações (nomes usados pelo router) ─────────────────────

export async function listSolicitacoes() {
  return listSolicitacoesSeparacao();
}

export async function createSolicitacao(data: {
  usuarioSolicitante: string;
  observacaoSolicitante?: string;
  obraDestinoId?: number | null;
  dataLimite?: string;
  itens: {
    materialId: number;
    quantidadeSolicitada: number;
    loteId?: number;
    comprimentoEspecifico?: number;
  }[];
}) {
  return createSolicitacaoSeparacao({
    ...data,
    obraDestinoId: data.obraDestinoId ?? undefined,
    dataLimite: data.dataLimite ? dataSomenteDiaParaTimestamp(data.dataLimite) : undefined,
  });
}

export async function deleteSolicitacao(id: number, usuarioNome: string = "Sistema") {
  try {
    const db = await getDb();
    await db.execute(sql`DELETE FROM itens_solicitacao WHERE solicitacao_id = ${id}`);
    await db.execute(sql`DELETE FROM solicitacoes_separacao WHERE id = ${id}`);
    await registrarAtividade(usuarioNome, "EXCLUSAO", "SOLICITACAO", `Solicitação #${String(id).padStart(5, "0")} removida.`);
    return { success: true };
  } catch (error) {
    handleDbError(error, "deleteSolicitacao");
  }
}

export async function updateSolicitacao(id: number, data: {
  status?: "pendente" | "em_separacao" | "concluido" | "cancelado";
  observacaoResposta?: string;
}) {
  try {
    const db = await getDb();
    const fields: string[] = [];
    if (data.status !== undefined) fields.push(`status = '${data.status}'`);
    if (data.observacaoResposta !== undefined) fields.push(`observacao_resposta = '${data.observacaoResposta.replace(/'/g, "''")}'`);
    if (fields.length === 0) return { success: true };
    await db.execute(sql`UPDATE solicitacoes_separacao SET ${sql.raw(fields.join(", "))} WHERE id = ${id}`);
    return { success: true };
  } catch (error) {
    handleDbError(error, "updateSolicitacao");
  }
}

// ─── Planos de Corte ──────────────────────────────────────────────────────────

export async function listPlanosCote() {
  try {
    const db = await getDb();
    const rows = await db
      .select()
      .from(planosCote)
      .orderBy(desc(planosCote.createdAt));
    return rows;
  } catch (error) {
    handleDbError(error, "listPlanosCote");
  }
}

export async function createPlanoCote(data: {
  obraId: number;
  titulo: string;
  operador?: string;
}) {
  try {
    const db = await getDb();
    const [result] = await db.execute(sql`
      INSERT INTO planos_corte (obra_id, titulo, operador, status)
      VALUES (${data.obraId}, ${data.titulo}, ${data.operador ?? null}, 'rascunho')
    `) as any;
    return { id: result.insertId };
  } catch (error) {
    handleDbError(error, "createPlanoCote");
  }
}

export async function adicionarItemPlano(data: {
  planoId: number;
  estoqueId: number;
  qtdBarrasUsadas: number;
  compConsumido: number;
  compSobra: number;
  pecasCorte: number;
  sobraRetornaEstoque?: boolean;
}) {
  try {
    const db = await getDb();
    const [result] = await db.execute(sql`
      INSERT INTO itens_plano (plano_id, estoque_id, qtd_barras_usadas, comp_consumido, comp_sobra, pecas_corte, sobra_retorna_estoque)
      VALUES (${data.planoId}, ${data.estoqueId}, ${data.qtdBarrasUsadas}, ${data.compConsumido}, ${data.compSobra}, ${data.pecasCorte}, ${data.sobraRetornaEstoque ? 1 : 0})
    `) as any;
    return { id: result.insertId };
  } catch (error) {
    handleDbError(error, "adicionarItemPlano");
  }
}

export async function removerItemPlano(itemId: number) {
  try {
    const db = await getDb();
    await db.execute(sql`DELETE FROM itens_plano WHERE id = ${itemId}`);
    return { success: true };
  } catch (error) {
    handleDbError(error, "removerItemPlano");
  }
}

export async function processarPlanoCote(planoId: number, usuarioNome: string = "Sistema") {
  try {
    const db = await getDb();
    // Busca itens do plano
    const itens = await db.select().from(itensPLano).where(eq(itensPLano.planoId, planoId));
    for (const item of itens) {
      if (!item.estoqueId) continue;
      // Desconta do estoque
      await db.execute(sql`
        UPDATE estoque
        SET quantidade = GREATEST(0, quantidade - ${item.qtdBarrasUsadas ?? 0}),
            saldo_atual = GREATEST(0, saldo_atual - ${item.compConsumido ?? 0})
        WHERE id = ${item.estoqueId}
      `);
      // Se sobra retorna ao estoque, cria registro de sobra
      if (item.sobraRetornaEstoque && item.compSobra && item.compSobra > 0) {
        await db.execute(sql`
          INSERT INTO sobras (item_plano_id, estoque_id, comprimento, quantidade)
          VALUES (${item.id}, ${item.estoqueId}, ${item.compSobra}, 1)
        `);
      }
    }
    await db.execute(sql`UPDATE planos_corte SET status = 'concluido' WHERE id = ${planoId}`);
    const planoAtual = await db.select().from(planosCote).where(eq(planosCote.id, planoId)).limit(1);
    const descPlano = planoAtual.length > 0 ? `Plano de corte "${planoAtual[0].titulo}" processado.` : `Plano de corte processado.`;
    await registrarAtividade(usuarioNome, "PROCESSAMENTO", "PLANO_CORTE", descPlano);
    return { success: true };
  } catch (error) {
    handleDbError(error, "processarPlanoCote");
  }
}

// ─── Relatórios / Dashboard ───────────────────────────────────────────────────

export async function getResumoEstoque() {
  return getEstoqueOverview(null);
}

export async function getConsumoPorObra() {
  try {
    const db = await getDb();
    const rows = await db.execute(sql`
      SELECT o.id AS obraId, o.nome AS obraNome,
             COALESCE(SUM(rs.peso_total), 0) AS totalKgConsumido,
             COALESCE(SUM(rs.quantidade), 0) AS totalBarrasConsumidas
      FROM obras o
      LEFT JOIN registros_saida rs ON rs.obra_nome = o.nome
      GROUP BY o.id, o.nome
      ORDER BY totalKgConsumido DESC
    `) as any;
    return (rows[0] as any[]) ?? [];
  } catch (error) {
    handleDbError(error, "getConsumoPorObra");
  }
}

export async function getMateriaisComBaixoEstoque() {
  try {
    const db = await getDb();
    const items = await db
      .select()
      .from(materiais)
      .where(eq(materiais.ativo, true));
    return items.filter((item: any) => {
      const peso = parseFloat(String(item.pesoTotal || "0"));
      const minimo = parseFloat(String(item.estoqueMinimo || "50"));
      return peso < minimo;
    });
  } catch (error) {
    handleDbError(error, "getMateriaisComBaixoEstoque");
  }
}

export async function getMovimentacoesPorPeriodo(dataInicio: string, dataFim: string) {
  try {
    const db = await getDb();
    const rows = await db.execute(sql`
      SELECT * FROM movimentacoes
      WHERE data_hora BETWEEN ${dataInicio} AND ${dataFim}
      ORDER BY data_hora DESC
    `) as any;
    return (rows[0] as any[]) ?? [];
  } catch (error) {
    handleDbError(error, "getMovimentacoesPorPeriodo");
  }
}

export async function getEstoqueByMaterial(materialId: number) {
  try {
    const db = await getDb();
    const rows = await db
      .select()
      .from(estoque)
      .where(and(eq(estoque.materialId, materialId), eq(estoque.ativo, true)));
    return rows;
  } catch (error) {
    handleDbError(error, "getEstoqueByMaterial");
  }
}

// ─── Exportação de dados ──────────────────────────────────────────────────────

export async function exportarDados(filtros: {
  obraId?: number | null;
  dataInicio?: string | null;
  dataFim?: string | null;
}) {
  return exportarMovimentacoesFiltradas({
    obraId: filtros.obraId ?? undefined,
    dataInicio: filtros.dataInicio ?? undefined,
    dataFim: filtros.dataFim ?? undefined,
  });
}

// ─── Importação de NF-e ───────────────────────────────────────────────────────

export async function importarNFe(nfeData: any, usuarioNome: string = "Sistema") {
  try {
    const db = await getDb();
    const criados: number[] = [];
    const itens = Array.isArray(nfeData?.itens) ? nfeData.itens : [];
    for (const item of itens) {
      const [result] = await db.execute(sql`
        INSERT INTO materiais (tipo, bitola, aco, quantidade, comprimento, peso_total, fornecedor, nf, ativo)
        VALUES (
          ${item.tipo ?? ""},
          ${item.bitola ?? ""},
          ${item.aco ?? ""},
          ${item.quantidade ?? 1},
          ${item.comprimento ?? 0},
          ${item.pesoTotal ?? "0.000"},
          ${nfeData.fornecedor ?? ""},
          ${nfeData.nf ?? ""},
          1
        )
      `) as any;
      criados.push(result.insertId);
    }
    await registrarAtividade(usuarioNome, "IMPORTACAO", "NF-e", `NF-e importada: ${criados.length} materiais criados.`);
    return { sucesso: true, criados: criados.length };
  } catch (error) {
    handleDbError(error, "importarNFe");
  }
}

// ─── Peso por metro (alias de getEspecificacaoByTipoBitolaAco) ───────────────

export async function obterPesoPorMetro(input: {
  tipo: string;
  bitola: string;
  aco: string;
  categoria?: string;
}) {
  try {
    const spec = await getEspecificacaoByTipoBitolaAco(
      input.tipo,
      input.bitola,
      input.aco,
      input.categoria ?? "PERFIL"
    );
    return { pesoPorMetro: spec?.pesoPorMetro ?? null };
  } catch (error) {
    handleDbError(error, "obterPesoPorMetro");
  }
}

// ─── Alias realizarBaixa -> baixaMateriais ────────────────────────────────────

export async function realizarBaixa(
  itens: { id: number; quantidadeBaixa: number }[],
  motivo?: string
) {
  return baixaMateriais(itens, motivo);
}

// ─── Alias marcarEtiquetaImpresa (typo fix) ───────────────────────────────────

export async function marcarEtiquetaImpresa(id: number) {
  return marcarEtiquetaImpressa(id);
}

// ─── Permissões por usuário ───────────────────────────────────────────────────

// Retorna lista de chaves de permissão ativas do usuário (string[])
export async function getUserPermissoes(usuarioId: number): Promise<string[]> {
  try {
    const db = await getDb();
    const rows = await db.execute(sql`
      SELECT p.chave, up.permitido
      FROM usuario_permissoes up
      JOIN permissoes p ON p.id = up.permissao_id
      WHERE up.usuario_id = ${usuarioId}
    `) as any;
    const all = (rows[0] as any[]) ?? [];
    // Retorna apenas as chaves com permitido = true (1 ou true)
    return all
      .filter((r: any) => r.permitido === 1 || r.permitido === true)
      .map((r: any) => String(r.chave));
  } catch (error) {
    handleDbError(error, "getUserPermissoes");
    return [];
  }
}

// Aceita string[] (lista de chaves permitidas) — converte internamente para {chave, permitido}
//
// Grava um override EXPLÍCITO (permitido = 1 ou 0) para cada permissão do catálogo,
// não só para as marcadas. Antes, chaves fora da lista simplesmente não geravam
// linha nenhuma em usuario_permissoes — e como getUserPermissions() parte do
// conjunto de permissões do role e só depois aplica os overrides existentes,
// desmarcar aqui uma permissão que o role já concede por padrão não tinha
// efeito nenhum (a ausência de override não é o mesmo que negar). Gravar
// permitido = 0 para toda chave não selecionada fecha essa lacuna.
export async function setUserPermissoes(usuarioId: number, permissoesPermitidas: string[]) {
  try {
    const db = await getDb();
    const permitidasSet = new Set(permissoesPermitidas);

    // Garante que toda chave selecionada já exista na tabela `permissoes`
    for (const chave of permissoesPermitidas) {
      const permRow = await db.execute(sql`SELECT id FROM permissoes WHERE chave = ${chave} LIMIT 1`) as any;
      if (!(permRow[0] as any[])[0]) {
        await db.execute(sql`
          INSERT IGNORE INTO permissoes (chave, descricao, modulo, acao)
          VALUES (${chave}, ${chave}, ${chave.split(':')[0] ?? 'geral'}, ${chave.split(':')[1] ?? 'acesso'})
        `);
      }
    }

    await db.execute(sql`DELETE FROM usuario_permissoes WHERE usuario_id = ${usuarioId}`);

    const todasPermissoes = await db.execute(sql`SELECT id, chave FROM permissoes`) as any;
    const linhas = (todasPermissoes[0] as any[]) ?? [];

    for (const { id, chave } of linhas) {
      await db.execute(sql`
        INSERT INTO usuario_permissoes (usuario_id, permissao_id, permitido)
        VALUES (${usuarioId}, ${id}, ${permitidasSet.has(chave) ? 1 : 0})
      `);
    }

    return { success: true };
  } catch (error) {
    handleDbError(error, "setUserPermissoes");
  }
}

// ─── Catálogo e matriz de permissões (painel /configuracoes/permissoes) ──────

export async function getCatalogoPermissoes() {
  try {
    const db = await getDb();
    const rows = await db.execute(sql`
      SELECT id, chave, descricao, modulo, acao FROM permissoes ORDER BY modulo, acao
    `) as any;
    return ((rows[0] as any[]) ?? []).map((r: any) => ({
      id: Number(r.id),
      chave: String(r.chave),
      descricao: String(r.descricao),
      modulo: String(r.modulo),
      acao: String(r.acao),
    }));
  } catch (error) {
    handleDbError(error, "getCatalogoPermissoes");
    return [];
  }
}

const ROLES_MATRIZ = ["owner", "admin", "supervisor", "operator", "viewer"] as const;

// Estado atual de role_permissoes, agrupado por role: { admin: ["materiais:ver", ...], ... }
export async function getMatrizRolePermissoes(): Promise<Record<string, string[]>> {
  try {
    const db = await getDb();
    const rows = await db.execute(sql`
      SELECT rp.role AS role, p.chave AS chave
      FROM role_permissoes rp
      JOIN permissoes p ON p.id = rp.permissao_id
    `) as any;
    const linhas = (rows[0] as any[]) ?? [];

    const matriz: Record<string, string[]> = {};
    for (const role of ROLES_MATRIZ) matriz[role] = [];
    for (const { role, chave } of linhas) {
      if (!matriz[role]) matriz[role] = [];
      matriz[role].push(String(chave));
    }
    return matriz;
  } catch (error) {
    handleDbError(error, "getMatrizRolePermissoes");
    return {};
  }
}

// Liga/desliga uma permissão para um role inteiro (role_permissoes). Efeito é
// imediato — getUserPermissions() lê essa tabela a cada requisição, sem cache
// entre requisições, então usuários já logados sentem o efeito na ação seguinte.
export async function definirRolePermissao(
  role: string,
  chave: string,
  habilitado: boolean,
  usuarioNome: string = "Sistema"
) {
  try {
    const db = await getDb();

    const permRow = await db.execute(sql`SELECT id FROM permissoes WHERE chave = ${chave} LIMIT 1`) as any;
    const perm = (permRow[0] as any[])[0];
    if (!perm) throw new Error(`Permissão desconhecida: "${chave}"`);

    const existente = await db.execute(sql`
      SELECT id FROM role_permissoes WHERE role = ${role} AND permissao_id = ${perm.id} LIMIT 1
    `) as any;
    const jaConcedida = ((existente[0] as any[]) ?? []).length > 0;

    if (habilitado && !jaConcedida) {
      await db.execute(sql`INSERT INTO role_permissoes (role, permissao_id) VALUES (${role}, ${perm.id})`);
    } else if (!habilitado && jaConcedida) {
      await db.execute(sql`DELETE FROM role_permissoes WHERE role = ${role} AND permissao_id = ${perm.id}`);
    }

    await registrarAtividade(
      usuarioNome,
      habilitado ? "CONCEDER_PERMISSAO" : "REVOGAR_PERMISSAO",
      "ROLE_PERMISSAO",
      `Permissão "${chave}" ${habilitado ? "concedida ao" : "revogada do"} role "${role}".`
    );

    return { success: true };
  } catch (error) {
    handleDbError(error, "definirRolePermissao");
  }
}

// ─── getUserByOpenId e upsertUser (necessários para autenticação) ─────────────

export async function getUserByOpenId(openId: string) {
  const db = await getDb();
  const rows = await db
    .select()
    .from(users)
    .where(eq(users.openId, openId))
    .limit(1);
  return rows[0] ?? null;
}

// export async function upsertUser(data: {
//   openId: string;
//   name?: string | null;
//   email?: string | null;
//   loginMethod?: string | null;
//   lastSignedIn?: Date;
// }) {
//   const db = await getDb();
//   const existing = await getUserByOpenId(data.openId);
//   if (existing) {
//     const update: Record<string, any> = {};
//     if (data.name !== undefined) update.name = data.name;
//     if (data.email !== undefined) update.email = data.email;
//     if (data.loginMethod !== undefined) update.loginMethod = data.loginMethod;
//     if (Object.keys(update).length > 0) {
//       await db.update(users).set(update).where(eq(users.openId, data.openId));
//     }
//   } else {
//     await db.insert(users).values({
//       openId: data.openId,
//       name: data.name ?? null,
//       email: data.email ?? null,
//       loginMethod: data.loginMethod ?? null,
//       role: "operator",
//       ativo: true,
//     } as any);
//   }
// }
// ============================================================================
// LIMPEZA DE DADOS — exclusivo para owner
// ============================================================================

export type TabelaLimpeza =
  | "solicitacoes"
  | "registros_saida"
  | "registros_entrada"
  | "movimentacoes"
  | "historico_atividades"
  | "materiais";

export interface FiltroLimpeza {
  tabela: TabelaLimpeza;
  de: string;   // ISO date string "YYYY-MM-DD"
  ate: string;  // ISO date string "YYYY-MM-DD"
}

/**
 * Conta quantos registros serão afetados sem deletar nada.
 * Usado para o preview antes da confirmação.
 */
export async function previewLimpeza(filtros: FiltroLimpeza[]): Promise<
  { tabela: TabelaLimpeza; count: number }[]
> {
  const db = await getDb();

  const resultado = await Promise.all(
    filtros.map(async ({ tabela, de, ate }) => {
      const dataInicio = new Date(`${de}T00:00:00.000Z`);
      const dataFim    = new Date(`${ate}T23:59:59.999Z`);

      let count = 0;

      if (tabela === "solicitacoes") {
        const rows = await db
          .select({ id: solicitacoesSeparacao.id })
          .from(solicitacoesSeparacao)
          .where(
            and(
              gte(solicitacoesSeparacao.dataSolicitacao, dataInicio),
              lte(solicitacoesSeparacao.dataSolicitacao, dataFim)
            )
          );
        count = rows.length;

      } else if (tabela === "registros_saida") {
        const rows = await db
          .select({ id: registrosSaida.id })
          .from(registrosSaida)
          .where(
            and(
              gte(registrosSaida.dataSaida, dataInicio),
              lte(registrosSaida.dataSaida, dataFim)
            )
          );
        count = rows.length;

      } else if (tabela === "movimentacoes") {
        const rows = await db
          .select({ id: movimentacoes.id })
          .from(movimentacoes)
          .where(
            and(
              gte(movimentacoes.dataHora, dataInicio),
              lte(movimentacoes.dataHora, dataFim)
            )
          );
        count = rows.length;

      } else if (tabela === "historico_atividades") {
        const rows = await db
          .select({ id: historicoAtividades.id })
          .from(historicoAtividades)
          .where(
            and(
              gte(historicoAtividades.dataHora, dataInicio),
              lte(historicoAtividades.dataHora, dataFim)
            )
          );
        count = rows.length;

      } else if (tabela === "materiais") {
        const rows = await db
          .select({ id: materiais.id })
          .from(materiais)
          .where(
            and(
              gte(materiais.createdAt, dataInicio),
              lte(materiais.createdAt, dataFim)
            )
          );
        count = rows.length;
      }

      return { tabela, count };
    })
  );

  return resultado;
}

/**
 * Executa a limpeza efetiva. Hard delete com transação por tabela.
 * Retorna quantos registros foram deletados por tabela.
 */
export async function executarLimpeza(
  filtros: FiltroLimpeza[],
  ownerNome: string
): Promise<{ tabela: TabelaLimpeza; deletados: number }[]> {
  const db = await getDb();
  const resultados: { tabela: TabelaLimpeza; deletados: number }[] = [];

  for (const { tabela, de, ate } of filtros) {
    const dataInicio = new Date(`${de}T00:00:00.000Z`);
    const dataFim    = new Date(`${ate}T23:59:59.999Z`);
    let deletados = 0;

    if (tabela === "solicitacoes") {
      // Deletar itens filhos primeiro (FK)
      const ids = await db
        .select({ id: solicitacoesSeparacao.id })
        .from(solicitacoesSeparacao)
        .where(
          and(
            gte(solicitacoesSeparacao.dataSolicitacao, dataInicio),
            lte(solicitacoesSeparacao.dataSolicitacao, dataFim)
          )
        );

      if (ids.length > 0) {
        const idList = ids.map((r) => r.id);
        await db
          .delete(itensSolicitacao)
          .where(inArray(itensSolicitacao.solicitacaoId, idList));

        const res = await db
          .delete(solicitacoesSeparacao)
          .where(inArray(solicitacoesSeparacao.id, idList));
        deletados = (res as any)?.[0]?.affectedRows ?? idList.length;
      }

    } else if (tabela === "registros_saida") {
      const res = await db
        .delete(registrosSaida)
        .where(
          and(
            gte(registrosSaida.dataSaida, dataInicio),
            lte(registrosSaida.dataSaida, dataFim)
          )
        );
      deletados = (res as any)?.[0]?.affectedRows ?? 0;

    } else if (tabela === "registros_entrada") {
      const res = await db
        .delete(registrosEntrada)
        .where(
          and(
            gte(registrosEntrada.dataEntrada, dataInicio),
            lte(registrosEntrada.dataEntrada, dataFim)
          )
        );
      deletados = (res as any)?.[0]?.affectedRows ?? 0;

    } else if (tabela === "movimentacoes") {
      const res = await db
        .delete(movimentacoes)
        .where(
          and(
            gte(movimentacoes.dataHora, dataInicio),
            lte(movimentacoes.dataHora, dataFim)
          )
        );
      deletados = (res as any)?.[0]?.affectedRows ?? 0;

    } else if (tabela === "historico_atividades") {
      const res = await db
        .delete(historicoAtividades)
        .where(
          and(
            gte(historicoAtividades.dataHora, dataInicio),
            lte(historicoAtividades.dataHora, dataFim)
          )
        );
      deletados = (res as any)?.[0]?.affectedRows ?? 0;

    } else if (tabela === "materiais") {
      // Busca IDs no período para usar o hardDeleteMateriais (que registra no histórico)
      const ids = await db
        .select({ id: materiais.id })
        .from(materiais)
        .where(
          and(
            gte(materiais.createdAt, dataInicio),
            lte(materiais.createdAt, dataFim)
          )
        );
      if (ids.length > 0) {
        const result = await hardDeleteMateriais(ids.map(r => r.id), ownerNome);
        deletados = result.deletados;
      }
    }

    resultados.push({ tabela, deletados });
  }

  // Registrar a operação no histórico (usando a própria tabela — irônico mas necessário)
  await registrarAtividade(
    ownerNome,
    "LIMPEZA",
    "SISTEMA",
    `Limpeza de dados executada: ${resultados
      .map((r) => `${r.tabela} (${r.deletados} registros)`)
      .join(", ")}`
  );

  return resultados;
}

/**
 * Dados consolidados para o dashboard operacional e Relatórios.
 * A função é somente de leitura e não altera regras de estoque.
 */
export async function getDashboardAnalytics(filters: {
  obraId?: number | null;
  dataInicio?: string | null;
  dataFim?: string | null;
} = {}) {
  try {
    const db = await getDb();
    const agora = new Date();
    const inicio = filters.dataInicio
      ? new Date(`${filters.dataInicio}T00:00:00`)
      : new Date(agora.getTime() - 30 * 24 * 60 * 60 * 1000);
    const fim = filters.dataFim
      ? new Date(`${filters.dataFim}T23:59:59`)
      : agora;

    let obraNomeFiltro: string | null = null;
    if (filters.obraId && filters.obraId !== 0) {
      const obra = await db.select().from(obras).where(eq(obras.id, filters.obraId)).limit(1);
      obraNomeFiltro = obra[0]?.nome ?? null;
    }

    const materiaisAtivos = await db.select().from(materiais)
      .where(and(eq(materiais.ativo, true), eq(materiais.excluirRelatorios, false)));
    const materiaisFiltrados = materiaisAtivos.filter((item: any) => {
      if (filters.obraId === 0) return item.obraId == null;
      if (filters.obraId && filters.obraId !== 0) return item.obraId === filters.obraId;
      return true;
    });

    // Estoque mínimo agora vem da ESPECIFICAÇÃO (tipo+bitola+aço), não mais
    // de cada material individual — um item sozinho quase sempre pesa menos
    // que um "mínimo de estoque" razoável, então comparar por item gerava
    // alerta pra praticamente tudo. O certo é somar todo o estoque daquela
    // especificação e comparar o total contra o mínimo definido uma vez só
    // em Especificações.
    const todasEspecs = await db.select().from(especificacoesMateriais).where(eq(especificacoesMateriais.ativo, true));
    const minimoPorEspec = new Map<string, number>();
    todasEspecs.forEach((e: any) => {
      const chave = `${e.tipo}|${e.bitola}|${e.aco}`;
      minimoPorEspec.set(chave, parseFloat(String(e.estoqueMinimo || "0")));
    });

    const peso = (item: any) => parseFloat(String(item.pesoTotal || "0"));
    const totalKg = materiaisFiltrados.reduce((sum, item) => sum + peso(item), 0);

    // Agrupa todo o estoque ATIVO (sem o filtro de obra — o mínimo é do
    // estoque total da empresa, não por obra) por especificação.
    const gruposEspec: Record<string, { tipo: string; bitola: string; aco: string; peso: number; obras: Set<string> }> = {};
    materiaisAtivos.forEach((item: any) => {
      const chave = `${item.tipo}|${item.bitola}|${item.aco}`;
      if (!gruposEspec[chave]) gruposEspec[chave] = { tipo: item.tipo, bitola: item.bitola, aco: item.aco, peso: 0, obras: new Set() };
      gruposEspec[chave].peso += peso(item);
      gruposEspec[chave].obras.add(item.obraNome || "LIVRE");
    });

    const alertas = Object.entries(gruposEspec)
      .map(([chave, grupo]) => {
        const minimoDef = minimoPorEspec.get(chave) ?? 0;
        return { ...grupo, minimoDef };
      })
      // minimoDef === 0 significa "sem mínimo configurado ainda" — não gera alerta.
      .filter((grupo) => grupo.minimoDef > 0 && grupo.peso < grupo.minimoDef)
      .map((grupo) => ({
        id: `${grupo.tipo}-${grupo.bitola}-${grupo.aco}`,
        descricao: `${grupo.tipo} ${grupo.bitola}${grupo.aco ? ` (${grupo.aco})` : ""}`,
        tipo: grupo.tipo,
        bitola: grupo.bitola,
        aco: grupo.aco,
        obraNome: grupo.obras.size === 1 ? Array.from(grupo.obras)[0] : `${grupo.obras.size} locais`,
        atual: Number(grupo.peso.toFixed(2)),
        minimo: Number(grupo.minimoDef.toFixed(2)),
        deficit: Number(Math.max(0, grupo.minimoDef - grupo.peso).toFixed(2)),
      }))
      .sort((a: any, b: any) => b.deficit - a.deficit)
      .slice(0, 10);

    const estoqueVsMinimo = Object.entries(gruposEspec)
      .map(([chave, grupo]) => ({ ...grupo, minimoDef: minimoPorEspec.get(chave) ?? 0 }))
      .filter((grupo) => grupo.minimoDef > 0)
      .map((grupo) => ({
        id: `${grupo.tipo}-${grupo.bitola}-${grupo.aco}`,
        material: `${grupo.tipo} ${grupo.bitola}`,
        obraNome: grupo.obras.size === 1 ? Array.from(grupo.obras)[0] : `${grupo.obras.size} locais`,
        atual: Number(grupo.peso.toFixed(2)),
        minimo: Number(grupo.minimoDef.toFixed(2)),
      }))
      .sort((a: any, b: any) => (a.atual - a.minimo) - (b.atual - b.minimo))
      .slice(0, 10);

    const alocacaoMap: Record<string, { livre: number; alocado: number }> = {};
    materiaisFiltrados.forEach((item: any) => {
      const nome = item.obraNome || "LIVRE";
      if (!alocacaoMap[nome]) alocacaoMap[nome] = { livre: 0, alocado: 0 };
      if (nome === "LIVRE") alocacaoMap[nome].livre += peso(item);
      else alocacaoMap[nome].alocado += peso(item);
    });
    const alocacaoPorObra = Object.entries(alocacaoMap)
      .map(([obra, valores]) => ({ obra, livre: Number(valores.livre.toFixed(2)), alocado: Number(valores.alocado.toFixed(2)), total: Number((valores.livre + valores.alocado).toFixed(2)) }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 8);

    const saidaWhere = [
      gte(registrosSaida.dataSaida, inicio),
      lte(registrosSaida.dataSaida, fim),
      eq(registrosSaida.excluirRelatorios, false),
    ];
    if (filters.obraId === 0) saidaWhere.push(isNull(registrosSaida.obraNome) as any);
    if (obraNomeFiltro) saidaWhere.push(eq(registrosSaida.obraNome, obraNomeFiltro) as any);
    const saidas = await db.select().from(registrosSaida).where(and(...(saidaWhere as any)));
    const consumoMap: Record<string, number> = {};
    const consumoObraMap: Record<string, number> = {};
    saidas.forEach((saida: any) => {
      const data = new Date(saida.dataSaida).toISOString().slice(0, 10);
      consumoMap[data] = (consumoMap[data] || 0) + parseFloat(String(saida.pesoTotal || "0"));
      const obra = saida.obraNome || "LIVRE";
      consumoObraMap[obra] = (consumoObraMap[obra] || 0) + parseFloat(String(saida.pesoTotal || "0"));
    });
    const consumoDiario = Object.entries(consumoMap)
      .map(([data, pesoTotal]) => ({ data, peso: Number(pesoTotal.toFixed(2)) }))
      .sort((a, b) => a.data.localeCompare(b.data));
    const consumoPorObra = Object.entries(consumoObraMap)
      .map(([obra, pesoTotal]) => ({ obra, peso: Number(pesoTotal.toFixed(2)) }))
      .sort((a, b) => b.peso - a.peso);
    const totalConsumido = consumoDiario.reduce((sum, item) => sum + item.peso, 0);
    const obrasAlocadas = new Set(materiaisFiltrados.filter((item: any) => item.obraId != null).map((item: any) => item.obraId)).size;

    return {
      periodo: { inicio: inicio.toISOString(), fim: fim.toISOString() },
      totalKg: Number(totalKg.toFixed(2)),
      itensCriticos: alertas.length,
      totalConsumido: Number(totalConsumido.toFixed(2)),
      obrasAlocadas,
      mediaDiaria: consumoDiario.length ? Number((totalConsumido / consumoDiario.length).toFixed(2)) : 0,
      estoqueVsMinimo,
      alocacaoPorObra,
      consumoDiario,
      consumoPorObra,
      alertas,
    };
  } catch (error) {
    handleDbError(error, "getDashboardAnalytics");
  }
}

// ============================================================================
// REQUISIÇÕES DE PRODUÇÃO (separação por leitura de QR code)
// ============================================================================

/** Status em que o material separado continua reservado (ainda no estoque). */
const STATUS_REQUISICAO_ABERTA = ["em_separacao", "aguardando_aprovacao"] as const;

/** Números das GRDs em que o material já entrou — usado na etiqueta/QR. */
export async function listarGrdsDoMaterial(materialId: number) {
  try {
    const db = await getDb();
    const rows = await db.select({ numero: grdsGeradas.numero })
      .from(grdMateriais)
      .innerJoin(grdsGeradas, eq(grdMateriais.grdId, grdsGeradas.id))
      .where(eq(grdMateriais.materialId, materialId))
      .orderBy(desc(grdsGeradas.createdAt));
    return rows.map((r) => r.numero);
  } catch (error) {
    handleDbError(error, "listarGrdsDoMaterial");
  }
}

/**
 * Quantidade de cada material reservada em requisições abertas (em separação
 * ou aguardando aprovação). Usado pra sinalizar na lista de materiais e pra
 * calcular o disponível na hora da leitura.
 */
export async function listReservasRequisicaoProducao() {
  try {
    const db = await getDb();
    return await db.select({
      materialId: itensRequisicaoProducao.materialId,
      quantidade: itensRequisicaoProducao.quantidade,
      requisicaoId: requisicoesProducao.id,
      numero: requisicoesProducao.numero,
      status: requisicoesProducao.status,
    })
      .from(itensRequisicaoProducao)
      .innerJoin(requisicoesProducao, eq(itensRequisicaoProducao.requisicaoId, requisicoesProducao.id))
      .where(inArray(requisicoesProducao.status, [...STATUS_REQUISICAO_ABERTA]));
  } catch (error) {
    handleDbError(error, "listReservasRequisicaoProducao");
  }
}

/** Soma reservada do material em requisições abertas, exceto a informada. */
async function quantidadeReservadaEmOutras(materialId: number, ignorarRequisicaoId?: number) {
  const db = await getDb();
  const rows = await db.select({
    total: sql<number>`COALESCE(SUM(${itensRequisicaoProducao.quantidade}), 0)`,
  })
    .from(itensRequisicaoProducao)
    .innerJoin(requisicoesProducao, eq(itensRequisicaoProducao.requisicaoId, requisicoesProducao.id))
    .where(and(
      eq(itensRequisicaoProducao.materialId, materialId),
      inArray(requisicoesProducao.status, [...STATUS_REQUISICAO_ABERTA]),
      ignorarRequisicaoId ? sql`${requisicoesProducao.id} <> ${ignorarRequisicaoId}` : sql`1 = 1`
    ));
  return Number(rows[0]?.total ?? 0);
}

async function getRequisicaoOuErro(id: number) {
  const db = await getDb();
  const [req] = await db.select().from(requisicoesProducao).where(eq(requisicoesProducao.id, id)).limit(1);
  if (!req) throw new Error(`Requisição ${id} não encontrada.`);
  return req;
}

/**
 * Leitura do QR code: devolve o material com o que ainda dá pra separar
 * (quantidade atual − reservado em outras requisições − já lido nesta).
 */
export async function lerMaterialParaRequisicao(materialId: number, requisicaoId?: number) {
  try {
    const db = await getDb();
    const [mat] = await db.select().from(materiais).where(eq(materiais.id, materialId)).limit(1);
    if (!mat) throw new Error(`Material ${materialId} não encontrado. Confira se a etiqueta é deste sistema.`);

    const grds = await listarGrdsDoMaterial(materialId);
    const reservadoOutras = await quantidadeReservadaEmOutras(materialId, requisicaoId);

    let nestaRequisicao = 0;
    if (requisicaoId) {
      const [item] = await db.select().from(itensRequisicaoProducao)
        .where(and(
          eq(itensRequisicaoProducao.requisicaoId, requisicaoId),
          eq(itensRequisicaoProducao.materialId, materialId)
        )).limit(1);
      nestaRequisicao = item?.quantidade ?? 0;
    }

    // Peças do mesmo perfil/corrida/NF somando todos os registros ativos —
    // o pacote pode ter sido dividido em mais de um cadastro
    const [mesmoLote] = await db.select({
      registros: sql<number>`COUNT(*)`,
      pecas: sql<number>`COALESCE(SUM(${materiais.quantidade}), 0)`,
    })
      .from(materiais)
      .where(and(
        eq(materiais.ativo, true),
        eq(materiais.tipo, mat.tipo),
        eq(materiais.bitola, mat.bitola),
        mat.corrida ? eq(materiais.corrida, mat.corrida) : isNull(materiais.corrida),
        mat.nf ? eq(materiais.nf, mat.nf) : isNull(materiais.nf)
      ));

    const disponivel = mat.ativo
      ? Math.max(0, (mat.quantidade || 0) - reservadoOutras - nestaRequisicao)
      : 0;

    return {
      material: mat,
      grds: grds ?? [],
      reservadoOutras,
      nestaRequisicao,
      disponivel,
      mesmoLote: {
        registros: Number(mesmoLote?.registros ?? 0),
        pecas: Number(mesmoLote?.pecas ?? 0),
      },
    };
  } catch (error) {
    handleDbError(error, "lerMaterialParaRequisicao");
  }
}

export async function criarRequisicaoProducao(
  data: { numero: string; dataRequisicao: string; obraId: number; etapa: string; observacoes?: string },
  usuarioNome: string = "Sistema"
) {
  try {
    const db = await getDb();
    const [obra] = await db.select().from(obras).where(eq(obras.id, data.obraId)).limit(1);
    if (!obra) throw new Error("Obra não encontrada.");

    const [result] = await db.insert(requisicoesProducao).values({
      numero: data.numero.trim(),
      dataRequisicao: data.dataRequisicao,
      obraId: obra.id,
      obraNome: obra.nome,
      etapa: data.etapa.trim(),
      observacoes: data.observacoes?.trim() || null,
      usuarioCriacao: usuarioNome,
      status: "em_separacao",
    });
    const id = (result as any)?.insertId as number;

    await registrarAtividade(
      usuarioNome,
      "CADASTRO",
      "REQUISICAO_PRODUCAO",
      `Requisição de produção ${data.numero} criada — obra ${obra.nome}, etapa ${data.etapa}.`
    );

    return { id };
  } catch (error) {
    handleDbError(error, "criarRequisicaoProducao");
  }
}

export async function atualizarCabecalhoRequisicao(
  id: number,
  data: { numero: string; dataRequisicao: string; obraId: number; etapa: string; observacoes?: string }
) {
  try {
    const db = await getDb();
    const req = await getRequisicaoOuErro(id);
    if (req.status !== "em_separacao") throw new Error("Só é possível editar uma requisição em separação.");

    const [obra] = await db.select().from(obras).where(eq(obras.id, data.obraId)).limit(1);
    if (!obra) throw new Error("Obra não encontrada.");

    await db.update(requisicoesProducao).set({
      numero: data.numero.trim(),
      dataRequisicao: data.dataRequisicao,
      obraId: obra.id,
      obraNome: obra.nome,
      etapa: data.etapa.trim(),
      observacoes: data.observacoes?.trim() || null,
    }).where(eq(requisicoesProducao.id, id));

    return { ok: true };
  } catch (error) {
    handleDbError(error, "atualizarCabecalhoRequisicao");
  }
}

export async function listRequisicoesProducao() {
  try {
    const db = await getDb();
    const reqs = await db.select().from(requisicoesProducao).orderBy(desc(requisicoesProducao.id));

    const totais = await db.select({
      requisicaoId: itensRequisicaoProducao.requisicaoId,
      itens: sql<number>`COUNT(*)`,
      pecas: sql<number>`COALESCE(SUM(${itensRequisicaoProducao.quantidade}), 0)`,
    })
      .from(itensRequisicaoProducao)
      .groupBy(itensRequisicaoProducao.requisicaoId);

    const porReq = new Map(totais.map((t) => [t.requisicaoId, t]));

    return reqs.map((r) => ({
      ...r,
      totalItens: Number(porReq.get(r.id)?.itens ?? 0),
      totalPecas: Number(porReq.get(r.id)?.pecas ?? 0),
    }));
  } catch (error) {
    handleDbError(error, "listRequisicoesProducao");
  }
}

export async function getRequisicaoProducao(id: number) {
  try {
    const db = await getDb();
    const req = await getRequisicaoOuErro(id);

    const itens = await db.select({
      id: itensRequisicaoProducao.id,
      materialId: itensRequisicaoProducao.materialId,
      quantidade: itensRequisicaoProducao.quantidade,
      usuarioNome: itensRequisicaoProducao.usuarioNome,
      createdAt: itensRequisicaoProducao.createdAt,
      updatedAt: itensRequisicaoProducao.updatedAt,
      material: materiais,
    })
      .from(itensRequisicaoProducao)
      .innerJoin(materiais, eq(itensRequisicaoProducao.materialId, materiais.id))
      .where(eq(itensRequisicaoProducao.requisicaoId, id))
      .orderBy(desc(itensRequisicaoProducao.updatedAt));

    return { ...req, itens };
  } catch (error) {
    handleDbError(error, "getRequisicaoProducao");
  }
}

/**
 * Autosave da leitura: grava o item na hora. Ler o mesmo material de novo
 * soma na quantidade já lida.
 */
export async function adicionarItemRequisicao(
  requisicaoId: number,
  materialId: number,
  quantidade: number,
  usuarioNome: string = "Sistema"
) {
  try {
    const db = await getDb();
    const req = await getRequisicaoOuErro(requisicaoId);
    if (req.status !== "em_separacao") throw new Error("Esta requisição não está mais em separação.");
    if (!Number.isInteger(quantidade) || quantidade <= 0) throw new Error("Informe uma quantidade de peças válida.");

    const leitura = await lerMaterialParaRequisicao(materialId, requisicaoId);
    if (!leitura) throw new Error("Material não encontrado.");
    if (!leitura.material.ativo) throw new Error("Este material não está mais no estoque.");
    if (quantidade > leitura.disponivel) {
      throw new Error(`Só há ${leitura.disponivel} peça(s) disponível(is) deste material para separar.`);
    }

    const [existente] = await db.select().from(itensRequisicaoProducao)
      .where(and(
        eq(itensRequisicaoProducao.requisicaoId, requisicaoId),
        eq(itensRequisicaoProducao.materialId, materialId)
      )).limit(1);

    if (existente) {
      await db.update(itensRequisicaoProducao)
        .set({ quantidade: existente.quantidade + quantidade, usuarioNome })
        .where(eq(itensRequisicaoProducao.id, existente.id));
    } else {
      await db.insert(itensRequisicaoProducao).values({ requisicaoId, materialId, quantidade, usuarioNome });
    }

    return { ok: true, quantidadeNaRequisicao: (existente?.quantidade ?? 0) + quantidade };
  } catch (error) {
    handleDbError(error, "adicionarItemRequisicao");
  }
}

/** Corrige a quantidade de um item já lido (0 remove o item). */
export async function definirQuantidadeItemRequisicao(itemId: number, quantidade: number) {
  try {
    const db = await getDb();
    const [item] = await db.select().from(itensRequisicaoProducao).where(eq(itensRequisicaoProducao.id, itemId)).limit(1);
    if (!item) throw new Error("Item não encontrado.");

    const req = await getRequisicaoOuErro(item.requisicaoId);
    if (req.status !== "em_separacao") throw new Error("Esta requisição não está mais em separação.");
    if (!Number.isInteger(quantidade) || quantidade < 0) throw new Error("Informe uma quantidade de peças válida.");

    if (quantidade === 0) {
      await db.delete(itensRequisicaoProducao).where(eq(itensRequisicaoProducao.id, itemId));
      return { ok: true };
    }

    const [mat] = await db.select().from(materiais).where(eq(materiais.id, item.materialId)).limit(1);
    const reservadoOutras = await quantidadeReservadaEmOutras(item.materialId, item.requisicaoId);
    const maximo = mat?.ativo ? Math.max(0, (mat.quantidade ?? 0) - reservadoOutras) : 0;
    if (quantidade > maximo) {
      throw new Error(`Só há ${maximo} peça(s) disponível(is) deste material para separar.`);
    }

    await db.update(itensRequisicaoProducao).set({ quantidade }).where(eq(itensRequisicaoProducao.id, itemId));
    return { ok: true };
  } catch (error) {
    handleDbError(error, "definirQuantidadeItemRequisicao");
  }
}

export async function enviarRequisicaoParaAprovacao(id: number, usuarioNome: string = "Sistema") {
  try {
    const db = await getDb();
    const req = await getRequisicaoProducao(id);
    if (!req) throw new Error("Requisição não encontrada.");
    if (req.status !== "em_separacao") throw new Error("Esta requisição não está em separação.");
    if (req.itens.length === 0) throw new Error("Leia ao menos um material antes de enviar para aprovação.");

    await db.update(requisicoesProducao)
      .set({ status: "aguardando_aprovacao", dataEnvio: new Date() })
      .where(eq(requisicoesProducao.id, id));

    await registrarAtividade(
      usuarioNome,
      "EDICAO",
      "REQUISICAO_PRODUCAO",
      `Requisição de produção ${req.numero} enviada para aprovação (${req.itens.length} materiais).`
    );

    return { ok: true };
  } catch (error) {
    handleDbError(error, "enviarRequisicaoParaAprovacao");
  }
}

/** ADM devolve para separação (ex: precisa corrigir um item). */
export async function devolverRequisicaoParaSeparacao(id: number, motivo: string | undefined, usuarioNome: string = "Sistema") {
  try {
    const db = await getDb();
    const req = await getRequisicaoOuErro(id);
    if (req.status !== "aguardando_aprovacao") throw new Error("Só é possível devolver uma requisição aguardando aprovação.");

    await db.update(requisicoesProducao)
      .set({ status: "em_separacao", dataEnvio: null, motivoRejeicao: motivo?.trim() || null })
      .where(eq(requisicoesProducao.id, id));

    await registrarAtividade(
      usuarioNome,
      "EDICAO",
      "REQUISICAO_PRODUCAO",
      `Requisição de produção ${req.numero} devolvida para separação.${motivo ? ` Motivo: ${motivo}` : ""}`
    );

    return { ok: true };
  } catch (error) {
    handleDbError(error, "devolverRequisicaoParaSeparacao");
  }
}

export async function rejeitarRequisicaoProducao(id: number, motivo: string, usuarioNome: string = "Sistema") {
  try {
    const db = await getDb();
    const req = await getRequisicaoOuErro(id);
    if (req.status !== "aguardando_aprovacao") throw new Error("Só é possível rejeitar uma requisição aguardando aprovação.");

    await db.update(requisicoesProducao)
      .set({ status: "rejeitada", motivoRejeicao: motivo.trim(), usuarioAprovacao: usuarioNome, dataAprovacao: new Date() })
      .where(eq(requisicoesProducao.id, id));

    await registrarAtividade(
      usuarioNome,
      "EDICAO",
      "REQUISICAO_PRODUCAO",
      `Requisição de produção ${req.numero} rejeitada. Motivo: ${motivo}`
    );

    return { ok: true };
  } catch (error) {
    handleDbError(error, "rejeitarRequisicaoProducao");
  }
}

/** Cancela uma requisição ainda em separação — libera os materiais reservados. */
export async function cancelarRequisicaoProducao(id: number, usuarioNome: string = "Sistema") {
  try {
    const db = await getDb();
    const req = await getRequisicaoOuErro(id);
    if (req.status !== "em_separacao") throw new Error("Só é possível cancelar uma requisição em separação.");

    await db.update(requisicoesProducao)
      .set({ status: "cancelada" })
      .where(eq(requisicoesProducao.id, id));

    await registrarAtividade(
      usuarioNome,
      "EDICAO",
      "REQUISICAO_PRODUCAO",
      `Requisição de produção ${req.numero} cancelada.`
    );

    return { ok: true };
  } catch (error) {
    handleDbError(error, "cancelarRequisicaoProducao");
  }
}

/**
 * Aprovação do ADM: confere se todo item ainda tem saldo e dá baixa pelo
 * fluxo normal (baixaMateriais) — gera os registros de saída com o número da
 * requisição, a obra de destino e a data da requisição.
 */
export async function aprovarRequisicaoProducao(id: number, usuarioNome: string = "Sistema") {
  try {
    const db = await getDb();
    const req = await getRequisicaoProducao(id);
    if (!req) throw new Error("Requisição não encontrada.");
    if (req.status !== "aguardando_aprovacao") throw new Error("Esta requisição não está aguardando aprovação.");

    const problemas = req.itens
      .filter((it) => !it.material.ativo || it.quantidade > (it.material.quantidade || 0))
      .map((it) => `${it.material.tipo} ${it.material.bitola} (corrida ${it.material.corrida || "-"}): lido ${it.quantidade}, em estoque ${it.material.ativo ? it.material.quantidade : 0}`);
    if (problemas.length > 0) {
      throw new Error(`Saldo insuficiente — devolva a requisição para correção. ${problemas.join("; ")}`);
    }

    // Trava contra aprovação dupla (dois cliques / dois ADMs ao mesmo tempo)
    const [travou] = await db.update(requisicoesProducao)
      .set({ status: "aprovada", usuarioAprovacao: usuarioNome, dataAprovacao: new Date(), motivoRejeicao: null })
      .where(and(eq(requisicoesProducao.id, id), eq(requisicoesProducao.status, "aguardando_aprovacao")));
    if (!(travou as any)?.affectedRows) throw new Error("Esta requisição já foi processada por outro usuário.");

    try {
      await baixaMateriais(
        req.itens.map((it) => ({ id: it.materialId, quantidadeBaixa: it.quantidade })),
        `Requisição de produção ${req.numero} — Etapa: ${req.etapa}`,
        usuarioNome,
        req.obraNome,
        dataSomenteDiaParaTimestamp(req.dataRequisicao),
        req.numero
      );
    } catch (error) {
      await db.update(requisicoesProducao)
        .set({ status: "aguardando_aprovacao", usuarioAprovacao: null, dataAprovacao: null })
        .where(eq(requisicoesProducao.id, id));
      throw error;
    }

    await registrarAtividade(
      usuarioNome,
      "BAIXA",
      "REQUISICAO_PRODUCAO",
      `Requisição de produção ${req.numero} aprovada — baixa de ${req.itens.length} materiais para ${req.obraNome} (etapa ${req.etapa}).`
    );

    return { ok: true, totalItens: req.itens.length };
  } catch (error) {
    handleDbError(error, "aprovarRequisicaoProducao");
  }
}

/** Itens de requisições de produção de um material — alimenta a Linha do Tempo. */
export async function listRequisicoesDoMaterial(materialId: number) {
  try {
    const db = await getDb();
    return await db.select({
      itemId: itensRequisicaoProducao.id,
      quantidade: itensRequisicaoProducao.quantidade,
      usuarioNome: itensRequisicaoProducao.usuarioNome,
      createdAt: itensRequisicaoProducao.createdAt,
      requisicaoId: requisicoesProducao.id,
      numero: requisicoesProducao.numero,
      obraNome: requisicoesProducao.obraNome,
      etapa: requisicoesProducao.etapa,
      status: requisicoesProducao.status,
      usuarioAprovacao: requisicoesProducao.usuarioAprovacao,
      dataAprovacao: requisicoesProducao.dataAprovacao,
      motivoRejeicao: requisicoesProducao.motivoRejeicao,
    })
      .from(itensRequisicaoProducao)
      .innerJoin(requisicoesProducao, eq(itensRequisicaoProducao.requisicaoId, requisicoesProducao.id))
      .where(eq(itensRequisicaoProducao.materialId, materialId))
      .orderBy(desc(itensRequisicaoProducao.createdAt));
  } catch (error) {
    handleDbError(error, "listRequisicoesDoMaterial");
  }
}

/**
 * Pacote do material (aberto pela leitura do QR na Linha do Tempo): outros
 * cadastros ativos do mesmo perfil/corrida/NF — o pacote pode ter sido
 * dividido —, peças reservadas em requisições abertas e GRDs.
 */
export async function getPacoteMaterial(materialId: number) {
  try {
    const db = await getDb();
    const [mat] = await db.select().from(materiais).where(eq(materiais.id, materialId)).limit(1);
    if (!mat) return null;

    const mesmoPacote = await db.select({
      id: materiais.id,
      quantidade: materiais.quantidade,
      comprimento: materiais.comprimento,
      largura: materiais.largura,
      categoria: materiais.categoria,
      local: materiais.local,
      obraNome: materiais.obraNome,
    })
      .from(materiais)
      .where(and(
        eq(materiais.ativo, true),
        eq(materiais.tipo, mat.tipo),
        eq(materiais.bitola, mat.bitola),
        mat.corrida ? eq(materiais.corrida, mat.corrida) : isNull(materiais.corrida),
        mat.nf ? eq(materiais.nf, mat.nf) : isNull(materiais.nf)
      ))
      .orderBy(materiais.id);

    // Tabelas de requisição podem ainda não existir — não derruba a consulta
    const reservado = await quantidadeReservadaEmOutras(materialId).catch(() => 0);
    const grds = (await listarGrdsDoMaterial(materialId).catch(() => [])) ?? [];

    return {
      cadastros: mesmoPacote,
      totalPecas: mesmoPacote.reduce((soma, m) => soma + (m.quantidade || 0), 0),
      reservado,
      grds,
    };
  } catch (error) {
    handleDbError(error, "getPacoteMaterial");
  }
}
