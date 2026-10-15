import { decimal, int, mysqlEnum, mysqlTable, text, timestamp, varchar, boolean, json, customType, foreignKey } from "drizzle-orm/mysql-core";

/** LONGBLOB — usado só pra guardar os PDFs de certificado (arquivo binário real). */
const longblob = customType<{ data: Buffer }>({
  dataType() {
    return "longblob";
  },
});
import { relations, sql } from "drizzle-orm";

/**
 * Core user table backing auth flow.
 */
export const users = mysqlTable("users", {
  id: int("id").autoincrement().primaryKey(),
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  passwordHash: varchar("password_hash", { length: 255 }), // Para login local
  role: mysqlEnum("role", ["owner", "admin", "supervisor", "operator", "viewer"]).default("operator").notNull(),
  cargo: varchar("cargo", { length: 100 }),  // Cargo/função textual: "Almoxarife", "Supervisor", etc.
  ativo: boolean("ativo").default(true).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

// ============================================================================
// SISTEMA DE ESTOQUE - TABELAS PRINCIPAIS (BASEADO NO DIAGNÓSTICO REAL)
// ============================================================================

/**
 * Tabela de especificações de materiais (Banco de Dados Técnico)
 */
export const especificacoesMateriais = mysqlTable("especificacoes_materiais", {
  id: int("id").autoincrement().primaryKey(),
  tipo: varchar("tipo", { length: 100 }).notNull(),
  bitola: varchar("bitola", { length: 100 }).notNull(),
  aco: varchar("aco", { length: 50 }).notNull(),
  pesoPorMetro: decimal("peso_por_metro", { precision: 10, scale: 3 }).notNull(), // Para chapas, será peso por m2
  categoria: varchar("categoria", { length: 20 }).default("PERFIL").notNull(),
  unidade: varchar("unidade", { length: 20 }).default("mm").notNull(),
  // Estoque mínimo (kg) — definido uma vez por especificação (tipo+bitola+aço),
  // não mais por item cadastrado individualmente. Usado pros alertas de
  // "estoque crítico" no Dashboard, somando o peso de TODOS os materiais
  // ativos que casam com essa especificação.
  estoqueMinimo: decimal("estoque_minimo", { precision: 12, scale: 2 }).default("0.00").notNull(),
  // Valor unitário (R$/kg) — usado pra estimar o valor em R$ do material
  // consumido em cada baixa, alimentando os gráficos de gasto por período.
  // Opcional: especificação sem valor definido simplesmente não entra nesse
  // cálculo, sem quebrar nada do resto (peso, estoque mínimo, etc. seguem
  // funcionando normalmente sem depender desse campo).
  valorUnitario: decimal("valor_unitario", { precision: 10, scale: 2 }).default(sql`null`),
  ativo: boolean("ativo").default(true).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type EspecificacaoMaterial = typeof especificacoesMateriais.$inferSelect;
export type InsertEspecificacaoMaterial = typeof especificacoesMateriais.$inferInsert;

/**
 * Tabela de materiais (Itens em estoque)
 */
export const materiais = mysqlTable("materiais", {
  id: int("id").autoincrement().primaryKey(),
  especificacaoId: int("especificacao_id").references(() => especificacoesMateriais.id),
  tipo: varchar("tipo", { length: 100 }).notNull(),
  bitola: varchar("bitola", { length: 100 }).notNull(),
  quantidade: int("quantidade").notNull().default(1),
  comprimento: int("comprimento").notNull(),
  pesoTotal: decimal("peso_total", { precision: 12, scale: 3 }).notNull(),
  aco: varchar("aco", { length: 50 }).notNull(),
  obraId: int("obra_id").references(() => obras.id),
  obraNome: varchar("obra_nome", { length: 200 }),
  // Obra de compra — só informativo, grava pra qual obra a compra foi
  // originalmente destinada. Nunca muda depois do cadastro, diferente de
  // obraId/obraNome (alocação atual, que muda na baixa/reatribuição).
  obraCompraId: int("obra_compra_id").references(() => obras.id),
  obraCompraNome: varchar("obra_compra_nome", { length: 200 }),
  local: varchar("local", { length: 200 }),
  fornecedor: varchar("fornecedor", { length: 200 }),
  nf: varchar("nf", { length: 50 }),
  numero_certificado: varchar("numero_certificado", { length: 100 }),
  corrida: varchar("corrida", { length: 100 }),
  ativo: boolean("ativo").default(true).notNull(),
  etiquetaImpressa: boolean("etiqueta_impressa").default(false).notNull(),
  dataImpressaoEtiqueta: timestamp("data_impressao_etiqueta", { mode: 'date' }),
  grdGerada: boolean("grd_gerada").default(false).notNull(),
  statusSolicitacao: varchar("status_solicitacao", { length: 50 }), // null, 'pendente', 'concluido'
  categoria: varchar("categoria", { length: 20 }).default("PERFIL").notNull(), // 'PERFIL' ou 'CHAPA'
  largura: int("largura"), // Apenas para chapas
  estoqueMinimo: decimal("estoque_minimo", { precision: 10, scale: 2 }).default("50.00").notNull(),
  observacoes: text("observacoes_material"),
  numeroPedido: varchar("numero_pedido", { length: 100 }),
  // Marca material de teste/inválido que não deve contar em nenhum total,
  // gráfico ou alerta do dashboard/relatórios — sem precisar apagar o
  // registro (mantém rastreabilidade). Não afeta o estoque físico real.
  excluirRelatorios: boolean("excluir_relatorios").default(false).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type Material = typeof materiais.$inferSelect;
export type InsertMaterial = typeof materiais.$inferInsert;

/**
 * Tabela de lotes
 */
export const lotes = mysqlTable("lotes", {
  id: int("id").autoincrement().primaryKey(),
  materialId: int("material_id").notNull().references(() => materiais.id),
  corridaNota: varchar("corrida_nota", { length: 100 }),
  fornecedor: varchar("fornecedor", { length: 200 }),
  dataEntrada: timestamp("data_entrada").defaultNow().notNull(),
  observacoes: text("observacoes"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type Lote = typeof lotes.$inferSelect;
export type InsertLote = typeof lotes.$inferInsert;

/**
 * Tabela de obras
 */
export const obras = mysqlTable("obras", {
  id: int("id").autoincrement().primaryKey(),
  nome: varchar("nome", { length: 200 }).notNull(),
  cliente: varchar("cliente", { length: 200 }),
  codigo: varchar("codigo", { length: 50 }).unique(),
  localizacao: varchar("localizacao", { length: 500 }),
  logoUrl: varchar("logo_url", { length: 500 }),
  status: mysqlEnum("status", ["ativa", "concluida", "pausada"]).default("ativa").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type Obra = typeof obras.$inferSelect;

/**
 * Locais predefinidos de estoque no pátio (ex: "Galpão A", "Pátio Externo").
 * Substitui a antiga estrutura livre de Rua/Vão/Prateleira por uma lista
 * fixa selecionável via dropdown — mais simples de manter e sem erro de digitação.
 */
export const locaisEstoque = mysqlTable("locais_estoque", {
  id: int("id").autoincrement().primaryKey(),
  nome: varchar("nome", { length: 100 }).notNull().unique(),
  ativo: boolean("ativo").default(true).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type LocalEstoque = typeof locaisEstoque.$inferSelect;
export type InsertUserObra = typeof obras.$inferInsert;

/**
 * Tabela de estoque (saldo atual)
 */
export const estoque = mysqlTable("estoque", {
  id: int("id").autoincrement().primaryKey(),
  materialId: int("material_id").notNull().references(() => materiais.id),
  loteId: int("lote_id").references(() => lotes.id),
  obraId: int("obra_id").references(() => obras.id),
  comprimentoBarra: int("comprimento_barra").notNull(),
  quantidade: int("quantidade").notNull().default(0),
  localizacaoPatio: varchar("localizacao_patio", { length: 100 }),
  saldoAtual: decimal("saldo_atual", { precision: 12, scale: 2 }).notNull().default("0"),
  ativo: boolean("ativo").default(true).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type Estoque = typeof estoque.$inferSelect;
export type InsertEstoque = typeof estoque.$inferInsert;

/**
 * Tabela de movimentações
 */
export const movimentacoes = mysqlTable("movimentacoes", {
  id: int("id").autoincrement().primaryKey(),
  estoqueId: int("estoque_id").notNull(), // referencia o id do material (tabela materiais)
  tipo: mysqlEnum("tipo", ["entrada", "saida", "retorno_sobra", "ajuste"]).notNull(),
  quantidade: decimal("quantidade", { precision: 12, scale: 2 }).notNull(),
  comprimento: decimal("comprimento", { precision: 10, scale: 2 }),
  saldoAnterior: decimal("saldo_anterior", { precision: 12, scale: 2 }).notNull(),
  saldoPosterior: decimal("saldo_posterior", { precision: 12, scale: 2 }).notNull(),
  referenciaType: varchar("referencia_type", { length: 50 }),
  referenciaId: int("referencia_id"),
  usuarioId: int("usuario_id").notNull().references(() => users.id),
  observacao: text("observacao"),
  dataHora: timestamp("data_hora").defaultNow().notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type Movimentacao = typeof movimentacoes.$inferSelect;
export type InsertMovimentacao = typeof movimentacoes.$inferInsert;

/**
 * Tabela de planos de corte
 */
export const planosCote = mysqlTable("planos_corte", {
  id: int("id").autoincrement().primaryKey(),
  obraId: int("obra_id").notNull().references(() => obras.id),
  titulo: varchar("titulo", { length: 200 }).notNull(),
  dataEmissao: timestamp("data_emissao"),
  operador: varchar("operador", { length: 100 }),
  arquivoPdf: varchar("arquivo_pdf", { length: 500 }),
  status: mysqlEnum("status", ["rascunho", "processando", "concluido", "erro"]).default("rascunho").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

/**
 * Tabela de itens dentro de um plano de corte
 */
export const itensPLano = mysqlTable("itens_plano", {
  id: int("id").autoincrement().primaryKey(),
  planoId: int("plano_id").notNull().references(() => planosCote.id),
  estoqueId: int("estoque_id").references(() => estoque.id),
  qtdBarrasUsadas: int("qtd_barras_usadas"),
  compConsumido: int("comp_consumido"),
  compSobra: int("comp_sobra"),
  pecasCorte: int("pecas_corte"),
  sobraRetornaEstoque: boolean("sobra_retorna_estoque").default(false),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

/**
 * Tabela de sobras/retalhos
 */
export const sobras = mysqlTable("sobras", {
  id: int("id").autoincrement().primaryKey(),
  itemPlanoId: int("item_plano_id").references(() => itensPLano.id),
  estoqueId: int("estoque_id").notNull().references(() => estoque.id),
  comprimento: int("comprimento").notNull(),
  quantidade: int("quantidade").notNull().default(1),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

// ============================================================================
// RELAÇÕES
// ============================================================================

export const especificacoesMateriaisRelations = relations(especificacoesMateriais, ({ many }) => ({
  materiais: many(materiais),
}));

export const materiaisRelations = relations(materiais, ({ one, many }) => ({
  especificacao: one(especificacoesMateriais, { fields: [materiais.especificacaoId], references: [especificacoesMateriais.id] }),
  obra: one(obras, { fields: [materiais.obraId], references: [obras.id] }),
  lotes: many(lotes),
  estoques: many(estoque),
}));

export const lotesRelations = relations(lotes, ({ one, many }) => ({
  material: one(materiais, { fields: [lotes.materialId], references: [materiais.id] }),
  estoques: many(estoque),
}));

export const obrasRelations = relations(obras, ({ many }) => ({
  estoques: many(estoque),
  planosCote: many(planosCote),
}));

export const estoqueRelations = relations(estoque, ({ one, many }) => ({
  material: one(materiais, { fields: [estoque.materialId], references: [materiais.id] }),
  lote: one(lotes, { fields: [estoque.loteId], references: [lotes.id] }),
  obra: one(obras, { fields: [estoque.obraId], references: [obras.id] }),
  movimentacoes: many(movimentacoes),
  itensPlano: many(itensPLano),
  sobras: many(sobras),
}));

export const movimentacoesRelations = relations(movimentacoes, ({ one }) => ({
  material: one(materiais, { fields: [movimentacoes.estoqueId], references: [materiais.id] }),
  usuario: one(users, { fields: [movimentacoes.usuarioId], references: [users.id] }),
}));

export const planosCoteRelations = relations(planosCote, ({ one, many }) => ({
  obra: one(obras, { fields: [planosCote.obraId], references: [obras.id] }),
  itensPlano: many(itensPLano),
}));

export const itensPLanoRelations = relations(itensPLano, ({ one, many }) => ({
  plano: one(planosCote, { fields: [itensPLano.planoId], references: [planosCote.id] }),
  estoque: one(estoque, { fields: [itensPLano.estoqueId], references: [estoque.id] }),
  sobras: many(sobras),
}));

export const sobrasRelations = relations(sobras, ({ one }) => ({
  itemPlano: one(itensPLano, { fields: [sobras.itemPlanoId], references: [itensPLano.id] }),
  estoque: one(estoque, { fields: [sobras.estoqueId], references: [estoque.id] }),
}));

/**
 * Tabela de registros de saída (Histórico de uso de materiais)
 */
export const registrosSaida = mysqlTable("registros_saida", {
  id: int("id").autoincrement().primaryKey(),
  tipo: varchar("tipo", { length: 100 }).notNull(),
  bitola: varchar("bitola", { length: 100 }).notNull(),
  quantidade: int("quantidade").notNull(),
  comprimento: int("comprimento").notNull(),
  pesoTotal: decimal("peso_total", { precision: 12, scale: 3 }).notNull(),
  aco: varchar("aco", { length: 50 }).notNull(),
  obraNome: varchar("obra_nome", { length: 200 }),
  local: varchar("local", { length: 200 }),
  fornecedor: varchar("fornecedor", { length: 200 }),
  nf: varchar("nf", { length: 50 }),
  numero_certificado: varchar("numero_certificado", { length: 100 }),
  corrida: varchar("corrida", { length: 100 }),
  motivo: varchar("motivo", { length: 300 }),
  numeroPedido: varchar("numero_pedido", { length: 100 }),
  numeroRequisicao: varchar("numero_requisicao", { length: 100 }),
  // Referência opcional ao material de origem — usada pra rastreabilidade
  // (linha do tempo do material). Fica nula em registros antigos, sem
  // problema nenhum: o registro em si já é um retrato completo por conta
  // própria, essa coluna só ajuda a linkar de volta quando disponível.
  materialId: int("material_id"),
  // Mesma ideia de materiais.excluirRelatorios: marca saída de teste/inválida
  // pra tirar do consumo do dashboard/relatórios sem apagar o histórico.
  excluirRelatorios: boolean("excluir_relatorios").default(false).notNull(),
  dataSaida: timestamp("data_saida").defaultNow().notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type RegistroSaida = typeof registrosSaida.$inferSelect;
export type InsertRegistroSaida = typeof registrosSaida.$inferInsert;

/**
 * Registro de entrada — retrato IMUTÁVEL do momento em que um material é
 * cadastrado (manual ou via NF-e). Preenchido automaticamente por
 * createMaterial, nunca é atualizado depois. Espelha registros_saida.
 */
export const registrosEntrada = mysqlTable("registros_entrada", {
  id: int("id").autoincrement().primaryKey(),
  tipo: varchar("tipo", { length: 100 }).notNull(),
  bitola: varchar("bitola", { length: 100 }).notNull(),
  quantidade: int("quantidade").notNull(),
  comprimento: int("comprimento").notNull(),
  largura: int("largura"),
  categoria: varchar("categoria", { length: 20 }),
  pesoTotal: decimal("peso_total", { precision: 12, scale: 3 }).notNull(),
  aco: varchar("aco", { length: 50 }).notNull(),
  obraNome: varchar("obra_nome", { length: 200 }),
  obraCompraNome: varchar("obra_compra_nome", { length: 200 }),
  local: varchar("local", { length: 200 }),
  fornecedor: varchar("fornecedor", { length: 200 }),
  nf: varchar("nf", { length: 50 }),
  numero_certificado: varchar("numero_certificado", { length: 100 }),
  corrida: varchar("corrida", { length: 100 }),
  numeroPedido: varchar("numero_pedido", { length: 100 }),
  usuarioNome: varchar("usuario_nome", { length: 100 }),
  // Mesma referência opcional de rastreabilidade — ver comentário em
  // registrosSaida.materialId.
  materialId: int("material_id"),
  dataEntrada: timestamp("data_entrada").defaultNow().notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type RegistroEntrada = typeof registrosEntrada.$inferSelect;
export type InsertRegistroEntrada = typeof registrosEntrada.$inferInsert;

/**
 * Relatórios de recebimento salvos — guarda só os DADOS estruturados usados
 * pra montar o PDF (itens + campos preenchidos no momento), nunca o arquivo
 * PDF em si. O PDF é sempre regerado sob demanda a partir daqui, o que
 * mantém o armazenamento pequeno (poucos KB por registro) mesmo com milhares
 * de relatórios acumulados. O próprio `id` (auto-incremento do MySQL) vira a
 * numeração/identificação do documento — sem precisar de contador separado.
 */
export const relatoriosRecebimento = mysqlTable("relatorios_recebimento", {
  id: int("id").autoincrement().primaryKey(),
  dados: json("dados").notNull(),
  usuarioNome: varchar("usuario_nome", { length: 100 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type RelatorioRecebimento = typeof relatoriosRecebimento.$inferSelect;

/**
 * Ligação Relatório de Recebimento ↔ Material — mesma lógica da de GRD,
 * puramente aditiva.
 */
export const relatorioRecebimentoMateriais = mysqlTable("relatorio_recebimento_materiais", {
  id: int("id").autoincrement().primaryKey(),
  relatorioId: int("relatorio_id").notNull(),
  materialId: int("material_id").notNull().references(() => materiais.id),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => ({
  relatorioFk: foreignKey({
    columns: [table.relatorioId],
    foreignColumns: [relatoriosRecebimento.id],
    name: "rel_receb_materiais_relatorio_fk",
  }),
}));

export type RelatorioRecebimentoMaterial = typeof relatorioRecebimentoMateriais.$inferSelect;

/**
 * Fotos anexadas ao Relatório de Recebimento — mesmo padrão já usado pros
 * certificados de GRD e pras fotos de separação (LONGBLOB direto no MySQL,
 * volume pequeno o suficiente pra não precisar de armazenamento externo).
 */
export const relatorioRecebimentoImagens = mysqlTable("relatorio_recebimento_imagens", {
  id: int("id").autoincrement().primaryKey(),
  relatorioId: int("relatorio_id").notNull(),
  nomeArquivo: varchar("nome_arquivo", { length: 255 }).notNull(),
  tipoArquivo: varchar("tipo_arquivo", { length: 100 }),
  tamanho: int("tamanho"),
  conteudo: longblob("conteudo").notNull(),
  usuarioNome: varchar("usuario_nome", { length: 100 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => ({
  // Nome curto explícito — o gerado automaticamente pelo Drizzle passava do
  // limite de 64 caracteres que o MySQL aceita pra nomes de constraint.
  relatorioFk: foreignKey({
    columns: [table.relatorioId],
    foreignColumns: [relatoriosRecebimento.id],
    name: "rel_receb_imagens_relatorio_fk",
  }),
}));

export type RelatorioRecebimentoImagem = typeof relatorioRecebimentoImagens.$inferSelect;

/**
 * GRDs geradas — guarda os dados usados pra montar a GRD (regerada sob
 * demanda via Python, igual o Relatório de Recebimento) + o(s) certificado(s)
 * anexados manualmente na hora da geração. Diferente do Relatório, aqui o
 * certificado É um arquivo real (PDF) — por isso a tabela filha guarda o
 * binário direto (LONGBLOB), já que o volume mensal é pequeno (poucas
 * dezenas de MB por ano) e não compensa a complexidade de um serviço de
 * armazenamento externo por enquanto.
 */
/**
 * Pedidos de Compra — Fase 1 da área "Materiais a Chegar". Por enquanto o
 * PDF é anexado manualmente (Fase 2 conecta isso ao e-mail automaticamente).
 * Guarda os dados extraídos do PDF pra acompanhar o que está a caminho, e
 * cruza com registros_entrada.numeroPedido quando a NF-e chega de verdade.
 */
/**
 * Fornecedores selecionados pra leitura automática de pedido por e-mail
 * (Fase 2) — só e-mails de/com cópia pra um endereço cadastrado aqui viram
 * candidatos a pedido de compra. Uma linha pode ter vários e-mails
 * (separados por vírgula) pro mesmo fornecedor.
 */
export const fornecedoresPedidosEmail = mysqlTable("fornecedores_pedidos_email", {
  id: int("id").autoincrement().primaryKey(),
  nome: varchar("nome", { length: 200 }).notNull(),
  emails: text("emails").notNull(), // separados por vírgula
  ativo: boolean("ativo").default(true).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type FornecedorPedidoEmail = typeof fornecedoresPedidosEmail.$inferSelect;

/**
 * Controle de quais e-mails já foram varridos — evita reprocessar a mesma
 * mensagem a cada rodada do robô.
 */
export const emailsPedidoProcessados = mysqlTable("emails_pedido_processados", {
  id: int("id").autoincrement().primaryKey(),
  gmailMessageId: varchar("gmail_message_id", { length: 100 }).notNull().unique(),
  remetente: varchar("remetente", { length: 300 }),
  assunto: varchar("assunto", { length: 500 }),
  resultado: mysqlEnum("resultado", ["fila_revisao", "ignorado", "erro"]).notNull(),
  detalhes: text("detalhes"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type EmailPedidoProcessado = typeof emailsPedidoProcessados.$inferSelect;

/**
 * Fila de revisão — pedidos detectados automaticamente no e-mail, ainda
 * não confirmados pelo usuário. Guarda os dados já extraídos (mesmo
 * formato que o upload manual produz), pra abrir direto na tela de revisão
 * já pré-preenchida. Só vira um pedidos_compra de verdade quando
 * confirmado.
 */
export const pedidosCompraFilaRevisao = mysqlTable("pedidos_compra_fila_revisao", {
  id: int("id").autoincrement().primaryKey(),
  gmailMessageId: varchar("gmail_message_id", { length: 100 }),
  remetente: varchar("remetente", { length: 300 }),
  nomeArquivoOriginal: varchar("nome_arquivo_original", { length: 255 }),
  dadosExtraidos: json("dados_extraidos").notNull(), // { cabecalho, itens } — mesmo formato do parser
  status: mysqlEnum("status", ["pendente_revisao", "confirmado", "rejeitado"]).default("pendente_revisao").notNull(),
  // Calculado na hora da varredura (ver buscarPedidoDuplicado em db.ts):
  // sinaliza quando o número de pedido extraído já existe em outro pedido
  // confirmado ou já está esperando revisão — evita duplicar sem perceber.
  possivelDuplicado: boolean("possivel_duplicado").default(false).notNull(),
  duplicadoDetalhe: text("duplicado_detalhe"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type PedidoCompraFilaRevisao = typeof pedidosCompraFilaRevisao.$inferSelect;


export const pedidosCompra = mysqlTable("pedidos_compra", {
  id: int("id").autoincrement().primaryKey(),
  numeroPedido: varchar("numero_pedido", { length: 50 }).notNull(),
  processoNumero: varchar("processo_numero", { length: 50 }),
  obraNome: varchar("obra_nome", { length: 300 }),
  fornecedorNome: varchar("fornecedor_nome", { length: 300 }),
  fornecedorCnpj: varchar("fornecedor_cnpj", { length: 30 }),
  dataEmissao: varchar("data_emissao", { length: 20 }),
  dataEntregaPrevista: varchar("data_entrega_prevista", { length: 20 }),
  condPagamento: varchar("cond_pagamento", { length: 100 }),
  cotacao: varchar("cotacao", { length: 200 }),
  valorTotalPedido: decimal("valor_total_pedido", { precision: 12, scale: 2 }),
  status: mysqlEnum("status", ["pendente", "parcial", "recebido", "cancelado"]).default("pendente").notNull(),
  usuarioNome: varchar("usuario_nome", { length: 100 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type PedidoCompra = typeof pedidosCompra.$inferSelect;

export const itensPedidoCompra = mysqlTable("itens_pedido_compra", {
  id: int("id").autoincrement().primaryKey(),
  pedidoCompraId: int("pedido_compra_id").notNull().references(() => pedidosCompra.id),
  codigo: varchar("codigo", { length: 50 }),
  descricaoOriginal: text("descricao_original"),
  categoria: varchar("categoria", { length: 20 }).default("PERFIL"),
  tipo: varchar("tipo", { length: 50 }),
  bitola: varchar("bitola", { length: 50 }),
  aco: varchar("aco", { length: 50 }),
  comprimento: int("comprimento"), // mm
  quantidadePecas: int("quantidade_pecas"),
  unidade: varchar("unidade", { length: 20 }),
  pesoTotal: decimal("peso_total", { precision: 12, scale: 3 }),
  valorUnitario: decimal("valor_unitario", { precision: 10, scale: 2 }),
  valorTotalItem: decimal("valor_total_item", { precision: 12, scale: 2 }),
  // Quantidade acumulada de todas as entradas já cruzadas com esse item —
  // um pedido pode chegar em várias NF-e diferentes, ao longo do tempo.
  quantidadeRecebida: int("quantidade_recebida").default(0).notNull(),
  // pendente = nada chegou ainda · parcial = já chegou algo, mas ainda não
  // bateu (nem foi encerrado manualmente) · completo = bateu dentro da
  // margem de tolerância, ou foi encerrado manualmente.
  statusItem: mysqlEnum("status_item", ["pendente", "parcial", "completo"]).default("pendente").notNull(),
  // Só usado quando o item é encerrado manualmente com uma diferença maior
  // que a margem de tolerância — obrigatório nesse caso, explica se a
  // diferença é aceitável ou se tem algo errado.
  justificativaDivergencia: text("justificativa_divergencia"),
  encerradoManualmente: boolean("encerrado_manualmente").default(false).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type ItemPedidoCompra = typeof itensPedidoCompra.$inferSelect;

/**
 * Uma linha por entrega (NF-e) que contribuiu pra um item de pedido de
 * compra — permite ver o histórico completo ("chegou em 3 partes: X, Y, Z")
 * em vez de só o total acumulado.
 */
export const entregasItemPedidoCompra = mysqlTable("entregas_item_pedido_compra", {
  id: int("id").autoincrement().primaryKey(),
  itemPedidoCompraId: int("item_pedido_compra_id").notNull(),
  materialId: int("material_id"),
  quantidade: int("quantidade").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => ({
  itemFk: foreignKey({
    columns: [table.itemPedidoCompraId],
    foreignColumns: [itensPedidoCompra.id],
    name: "entregas_item_pedido_fk",
  }),
}));

export type EntregaItemPedidoCompra = typeof entregasItemPedidoCompra.$inferSelect;

export const grdsGeradas = mysqlTable("grds_geradas", {
  id: int("id").autoincrement().primaryKey(),
  numero: varchar("numero", { length: 50 }).notNull().unique(),
  obra: varchar("obra", { length: 200 }).notNull(),
  cliente: varchar("cliente", { length: 200 }),
  dataGrd: varchar("data_grd", { length: 20 }), // data informada no formulário (YYYY-MM-DD)
  dados: json("dados").notNull(), // snapshot dos materiais usados pra gerar/regerar o .xlsm
  usuarioNome: varchar("usuario_nome", { length: 100 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type GrdGerada = typeof grdsGeradas.$inferSelect;

/**
 * Ligação GRD ↔ Material — pra rastreabilidade ("esse material apareceu em
 * qual GRD?"). Puramente aditiva: preenchida do lado de quem gera a GRD, sem
 * mexer em nada da geração/leitura da GRD em si. Se um material não tiver
 * id real no momento (ex: fluxo antigo), simplesmente não gera linha aqui —
 * a GRD continua funcionando normalmente de qualquer jeito.
 */
export const grdMateriais = mysqlTable("grd_materiais", {
  id: int("id").autoincrement().primaryKey(),
  grdId: int("grd_id").notNull().references(() => grdsGeradas.id),
  materialId: int("material_id").notNull().references(() => materiais.id),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type GrdMaterial = typeof grdMateriais.$inferSelect;

export const grdCertificados = mysqlTable("grd_certificados", {
  id: int("id").autoincrement().primaryKey(),
  grdId: int("grd_id").notNull().references(() => grdsGeradas.id),
  nomeArquivo: varchar("nome_arquivo", { length: 255 }).notNull(),
  tipoArquivo: varchar("tipo_arquivo", { length: 100 }),
  tamanho: int("tamanho"), // bytes, só pra exibir na listagem sem carregar o blob inteiro
  conteudo: longblob("conteudo").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type GrdCertificado = typeof grdCertificados.$inferSelect;

/**
 * Tabela de histórico de atividades (Auditoria)
 */
export const historicoAtividades = mysqlTable("historico_atividades", {
  id: int("id").autoincrement().primaryKey(),
  usuarioNome: varchar("usuario_nome", { length: 100 }).notNull().default("Sistema"),
  acao: varchar("acao", { length: 50 }).notNull(), // EX: "CADASTRO", "EDICAO", "EXCLUSAO", "BAIXA", "TROCA_OBRA"
  entidade: varchar("entidade", { length: 50 }).notNull(), // EX: "MATERIAL", "OBRA", "ESPECIFICACAO"
  materialId: int("material_id").references(() => materiais.id),
  detalhes: text("detalhes").notNull(),
  dataHora: timestamp("data_hora").defaultNow().notNull(),
});

export type HistoricoAtividade = typeof historicoAtividades.$inferSelect;
export type InsertHistoricoAtividade = typeof historicoAtividades.$inferInsert;



/**
 * Tabela de solicitações de separação
 */
export const solicitacoesSeparacao = mysqlTable("solicitacoes_separacao", {
  id: int("id").autoincrement().primaryKey(),
  usuarioSolicitante: varchar("usuario_solicitante", { length: 100 }).notNull().default("Sistema"),
  observacaoSolicitante: text("observacao_solicitante"),
  observacaoResposta: text("observacao_resposta"),
  // Observações livres sobre a separação em si (divergências, condição do
  // material, etc.) — diferente da observação de quem pediu e da resposta
  // do almoxarifado. Aparece no documento gerado.
  observacoesSeparacao: text("observacoes_separacao"),
  obraDestinoId: int("obra_destino_id").references(() => obras.id),
  dataLimite: timestamp("data_limite").default(sql`null`),
  status: mysqlEnum("status", ["pendente", "em_separacao", "concluido", "cancelado"]).default("pendente").notNull(),
  dataSolicitacao: timestamp("data_solicitacao").defaultNow().notNull(),
  dataConclusao: timestamp("data_conclusao").default(sql`null`),
  // createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type SolicitacaoSeparacao = typeof solicitacoesSeparacao.$inferSelect;
export type InsertSolicitacaoSeparacao = typeof solicitacoesSeparacao.$inferInsert;

/**
 * Fotos da separação anexadas manualmente — comprimidas no navegador antes do
 * upload (reduz uma foto de celular de alguns MB pra poucas centenas de KB),
 * guardadas como LONGBLOB direto no MySQL (mesmo padrão já usado pros
 * certificados de GRD).
 */
export const solicitacaoImagens = mysqlTable("solicitacao_imagens", {
  id: int("id").autoincrement().primaryKey(),
  solicitacaoId: int("solicitacao_id").notNull().references(() => solicitacoesSeparacao.id),
  nomeArquivo: varchar("nome_arquivo", { length: 255 }).notNull(),
  tipoArquivo: varchar("tipo_arquivo", { length: 100 }),
  tamanho: int("tamanho"),
  conteudo: longblob("conteudo").notNull(),
  usuarioNome: varchar("usuario_nome", { length: 100 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type SolicitacaoImagem = typeof solicitacaoImagens.$inferSelect;

/**
 * Tabela de itens de uma solicitação de separação
 */
export const itensSolicitacao = mysqlTable("itens_solicitacao", {
  id: int("id").autoincrement().primaryKey(),
  solicitacaoId: int("solicitacao_id").notNull().references(() => solicitacoesSeparacao.id),
  materialId: int("material_id").notNull().references(() => materiais.id),
  quantidadeSolicitada: int("quantidade_solicitada").notNull(),
  /** Lote específico escolhido pelo solicitante (NF/corrida) */
  loteId: int("lote_id").references(() => lotes.id),
  /** Comprimento exato da barra escolhida (mm), quando aplicável */
  comprimentoEspecifico: int("comprimento_especifico"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type ItemSolicitacao = typeof itensSolicitacao.$inferSelect;
export type InsertItemSolicitacao = typeof itensSolicitacao.$inferInsert;

// Relações para as novas tabelas
export const solicitacoesSeparacaoRelations = relations(solicitacoesSeparacao, ({ one, many }) => ({
  itens: many(itensSolicitacao),
  obraDestino: one(obras, { fields: [solicitacoesSeparacao.obraDestinoId], references: [obras.id] }),
}));

export const itensSolicitacaoRelations = relations(itensSolicitacao, ({ one }) => ({
  solicitacao: one(solicitacoesSeparacao, { fields: [itensSolicitacao.solicitacaoId], references: [solicitacoesSeparacao.id] }),
  material: one(materiais, { fields: [itensSolicitacao.materialId], references: [materiais.id] }),
}));

// ============================================================================
// REQUISIÇÕES DE PRODUÇÃO (separação por leitura de QR code)
// ============================================================================

/**
 * Requisição de produção — separação feita lendo o QR code das etiquetas.
 * Segue a mesma ideia do inventário: o material separado fica sinalizado
 * (reservado) enquanto a requisição está em separação ou aguardando
 * aprovação, e só sai do estoque quando um ADM aprova — aí passa pelo fluxo
 * normal de baixa (baixaMateriais), gerando registro de saída.
 */
export const requisicoesProducao = mysqlTable("requisicoes_producao", {
  id: int("id").autoincrement().primaryKey(),
  numero: varchar("numero", { length: 100 }).notNull(),
  dataRequisicao: varchar("data_requisicao", { length: 10 }).notNull(), // YYYY-MM-DD
  obraId: int("obra_id").references(() => obras.id),
  obraNome: varchar("obra_nome", { length: 200 }).notNull(),
  etapa: varchar("etapa", { length: 200 }).notNull(),
  status: mysqlEnum("status", ["em_separacao", "aguardando_aprovacao", "aprovada", "rejeitada", "cancelada"]).default("em_separacao").notNull(),
  observacoes: text("observacoes"),
  usuarioCriacao: varchar("usuario_criacao", { length: 100 }).notNull(),
  dataEnvio: timestamp("data_envio").default(sql`null`),
  usuarioAprovacao: varchar("usuario_aprovacao", { length: 100 }),
  dataAprovacao: timestamp("data_aprovacao").default(sql`null`),
  motivoRejeicao: text("motivo_rejeicao"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type RequisicaoProducao = typeof requisicoesProducao.$inferSelect;

/**
 * Itens lidos na requisição — um por material (ler o mesmo material de novo
 * soma na quantidade). Gravado na hora da leitura (autosave).
 */
export const itensRequisicaoProducao = mysqlTable("itens_requisicao_producao", {
  id: int("id").autoincrement().primaryKey(),
  requisicaoId: int("requisicao_id").notNull().references(() => requisicoesProducao.id),
  materialId: int("material_id").notNull().references(() => materiais.id),
  quantidade: int("quantidade").notNull(),
  usuarioNome: varchar("usuario_nome", { length: 100 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type ItemRequisicaoProducao = typeof itensRequisicaoProducao.$inferSelect;

// ============================================================================
// MÓDULO DE INVENTÁRIO FÍSICO / CONTAGEM PERIÓDICA
// ============================================================================

/**
 * Tabela de inventários (contagens periódicas)
 */
export const inventarios = mysqlTable("inventarios", {
  id: int("id").autoincrement().primaryKey(),
  numero: varchar("numero", { length: 50 }).notNull().unique(),
  descricao: varchar("descricao", { length: 200 }),
  dataAbertura: timestamp("data_abertura").defaultNow().notNull(),
  dataFechamento: timestamp("data_fechamento").default(sql`null`),
  usuarioAbertura: varchar("usuario_abertura", { length: 100 }).notNull(),
  usuarioFechamento: varchar("usuario_fechamento", { length: 100 }).default(sql`null`),
  status: mysqlEnum("status", ["aberto", "em_contagem", "fechado", "processado"]).default("aberto").notNull(),
  observacoes: text("observacoes"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type Inventario = typeof inventarios.$inferSelect;
export type InsertInventario = typeof inventarios.$inferInsert;

/**
 * Tabela de itens de inventário (Contagem de cada material)
 */
export const itensInventario = mysqlTable("itens_inventario", {
  id: int("id").autoincrement().primaryKey(),
  inventarioId: int("inventario_id").notNull().references(() => inventarios.id),
  materialId: int("material_id").notNull().references(() => materiais.id),
  quantidadeSistema: decimal("quantidade_sistema", { precision: 12, scale: 2 }).notNull(),
  quantidadeContada: decimal("quantidade_contada", { precision: 12, scale: 2 }).default(sql`null`),
  divergencia: decimal("divergencia", { precision: 12, scale: 2 }).default(sql`null`),
  percentualDivergencia: decimal("percentual_divergencia", { precision: 8, scale: 2 }).default(sql`null`),
  status: mysqlEnum("status", ["pendente", "contado", "ajustado"]).default("pendente").notNull(),
  observacoes: text("observacoes"),
  // Justificativa — feita depois do processamento, direto no Relatório de
  // Divergência ("pra onde esse material foi"). Diferente de `observacoes`
  // (que é o motivo digitado na hora da contagem, antes do processamento) —
  // aqui é um acompanhamento posterior, funciona como uma segunda baixa
  // conceitual: não mexe em estoque nem no registro já feito, só documenta.
  justificativa: text("justificativa"),
  justificadoEm: timestamp("justificado_em").default(sql`null`),
  justificadoPor: varchar("justificado_por", { length: 100 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type ItemInventario = typeof itensInventario.$inferSelect;
export type InsertItemInventario = typeof itensInventario.$inferInsert;

/**
 * Tabela de ajustes gerados automaticamente (Divergências)
 */
export const ajustesInventario = mysqlTable("ajustes_inventario", {
  id: int("id").autoincrement().primaryKey(),
  inventarioId: int("inventario_id").notNull().references(() => inventarios.id),
  itemInventarioId: int("item_inventario_id").notNull().references(() => itensInventario.id),
  materialId: int("material_id").notNull().references(() => materiais.id),
  tipo: mysqlEnum("tipo", ["entrada", "saida"]).notNull(), // entrada se contagem > sistema, saida se contagem < sistema
  quantidade: decimal("quantidade", { precision: 12, scale: 2 }).notNull(),
  motivo: varchar("motivo", { length: 200 }).default("Ajuste por inventário físico").notNull(),
  status: mysqlEnum("status", ["pendente", "aplicado", "cancelado"]).default("pendente").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type AjusteInventario = typeof ajustesInventario.$inferSelect;
export type InsertAjusteInventario = typeof ajustesInventario.$inferInsert;

/**
 * Materiais encontrados na contagem física que não estão no cadastro
 * (material antigo, ou que saiu do cadastro por algum motivo). Ficam aqui —
 * FORA da tabela materiais — até alguém analisar a origem: aprovado vira
 * material de verdade (materialId aponta pra ele); reprovado nunca entra na
 * lista de materiais, só fica o registro da análise.
 */
export const materiaisPendentesInventario = mysqlTable("materiais_pendentes_inventario", {
  id: int("id").autoincrement().primaryKey(),
  inventarioId: int("inventario_id").notNull().references(() => inventarios.id),
  categoria: varchar("categoria", { length: 20 }).default("PERFIL").notNull(),
  tipo: varchar("tipo", { length: 100 }).notNull(),
  bitola: varchar("bitola", { length: 100 }).notNull(),
  aco: varchar("aco", { length: 50 }).notNull(),
  quantidade: int("quantidade").notNull(),
  comprimento: int("comprimento").notNull(),
  largura: int("largura"),
  local: varchar("local", { length: 200 }),
  obraId: int("obra_id").references(() => obras.id),
  obraNome: varchar("obra_nome", { length: 200 }),
  fornecedor: varchar("fornecedor", { length: 200 }),
  nf: varchar("nf", { length: 50 }),
  numeroCertificado: varchar("numero_certificado", { length: 100 }),
  corrida: varchar("corrida", { length: 100 }),
  // Onde foi encontrado / possível origem — obrigatório, é o que a análise usa.
  origem: text("origem").notNull(),
  status: mysqlEnum("status", ["pendente", "aprovado", "reprovado"]).default("pendente").notNull(),
  cadastradoPor: varchar("cadastrado_por", { length: 100 }).notNull(),
  analisadoPor: varchar("analisado_por", { length: 100 }),
  analisadoEm: timestamp("analisado_em").default(sql`null`),
  parecer: text("parecer"),
  materialId: int("material_id").references(() => materiais.id),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type MaterialPendenteInventario = typeof materiaisPendentesInventario.$inferSelect;

// ─── Relações para Inventário ──────────────────────────────────────────────

export const inventariosRelations = relations(inventarios, ({ many }) => ({
  itens: many(itensInventario),
  ajustes: many(ajustesInventario),
}));

export const itensInventarioRelations = relations(itensInventario, ({ one, many }) => ({
  inventario: one(inventarios, { fields: [itensInventario.inventarioId], references: [inventarios.id] }),
  material: one(materiais, { fields: [itensInventario.materialId], references: [materiais.id] }),
  ajustes: many(ajustesInventario),
}));

export const ajustesInventarioRelations = relations(ajustesInventario, ({ one }) => ({
  inventario: one(inventarios, { fields: [ajustesInventario.inventarioId], references: [inventarios.id] }),
  itemInventario: one(itensInventario, { fields: [ajustesInventario.itemInventarioId], references: [itensInventario.id] }),
  material: one(materiais, { fields: [ajustesInventario.materialId], references: [materiais.id] }),
}));

// ============================================================================
// SISTEMA DE PERMISSÕES GRANULARES (RBAC)
// ============================================================================

/**
 * Tabela de permissões disponíveis no sistema
 * Define todas as ações possíveis que podem ser controladas
 */
export const permissoes = mysqlTable("permissoes", {
  id: int("id").autoincrement().primaryKey(),
  chave: varchar("chave", { length: 100 }).notNull().unique(), // Ex: "material.criar", "material.editar", "obra.deletar"
  descricao: varchar("descricao", { length: 200 }).notNull(),
  modulo: varchar("modulo", { length: 50 }).notNull(), // Ex: "materiais", "obras", "inventario"
  acao: varchar("acao", { length: 50 }).notNull(), // Ex: "criar", "editar", "deletar", "visualizar", "baixa"
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type Permissao = typeof permissoes.$inferSelect;
export type InsertPermissao = typeof permissoes.$inferInsert;

/**
 * Tabela de associação entre roles e permissões
 * Define quais permissões cada role possui
 */
export const rolePermissoes = mysqlTable("role_permissoes", {
  id: int("id").autoincrement().primaryKey(),
  role: mysqlEnum("role", ["owner", "admin", "supervisor", "operator", "viewer"]).notNull(),
  permissaoId: int("permissao_id").notNull().references(() => permissoes.id),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type RolePermissao = typeof rolePermissoes.$inferSelect;
export type InsertRolePermissao = typeof rolePermissoes.$inferInsert;

/**
 * Tabela de permissões customizadas por usuário
 * Permite sobrescrever permissões padrão do role para usuários específicos
 */
export const usuarioPermissoes = mysqlTable("usuario_permissoes", {
  id: int("id").autoincrement().primaryKey(),
  usuarioId: int("usuario_id").notNull().references(() => users.id),
  permissaoId: int("permissao_id").notNull().references(() => permissoes.id),
  permitido: boolean("permitido").notNull().default(true), // true = permitir, false = negar
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type UsuarioPermissao = typeof usuarioPermissoes.$inferSelect;
export type InsertUsuarioPermissao = typeof usuarioPermissoes.$inferInsert;

// ─── Relações para Permissões ──────────────────────────────────────────────

export const permissoesRelations = relations(permissoes, ({ many }) => ({
  rolePermissoes: many(rolePermissoes),
  usuarioPermissoes: many(usuarioPermissoes),
}));

export const rolePermissoesRelations = relations(rolePermissoes, ({ one }) => ({
  permissao: one(permissoes, { fields: [rolePermissoes.permissaoId], references: [permissoes.id] }),
}));

export const usuarioPermissoesRelations = relations(usuarioPermissoes, ({ one }) => ({
  usuario: one(users, { fields: [usuarioPermissoes.usuarioId], references: [users.id] }),
  permissao: one(permissoes, { fields: [usuarioPermissoes.permissaoId], references: [permissoes.id] }),
}));

export const usersRelations = relations(users, ({ many }) => ({
  usuarioPermissoes: many(usuarioPermissoes),
}));
