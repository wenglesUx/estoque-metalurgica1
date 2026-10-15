import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, protectedProcedure, router } from "./_core/trpc";
import { adminProcedure, operatorProcedure, viewerProcedure, permissaoProcedure, permissaoEstritaProcedure, ownerProcedure, CHAVES_SEM_COBERTURA_BACKEND, CHAVES_ESTRITAS } from "./_core/rbac";
import { z } from "zod";
import * as db from "./db";
import { parseNfeXml } from "./importers/nfeParser";
import { gerarGrd } from "./grd.service";
import { gerarGrdPdf } from "./grdPdf.service";
import { extrairPedidoCompraDoPdf } from "./pedidoCompra.service";
import { executarBackupCompleto } from "./backup.service";
import { authenticateUser, getUserPermissions } from "./_core/auth";
import { sdk } from "./_core/sdk";
import { COOKIE_NAME, ONE_YEAR_MS } from "@shared/const";
import { dataSomenteDiaParaTimestamp } from "./_core/dates";

export const appRouter = router({
  system: systemRouter,

  auth: router({
    me: publicProcedure.query(async (opts) => {
      const user = opts.ctx.user;
      if (!user) return null;
      // Busca permissoes reais para todos os roles (admin/owner recebem lista completa)
      const permissoes = await getUserPermissions(user.id).catch(() => [] as string[]);
      return { ...user, permissoes };
    }),

    login: publicProcedure
      .input(z.object({
        email: z.string().email(),
        senha: z.string().min(1),
      }))
      .mutation(async ({ input, ctx }) => {
        // Autentica com email+senha local
        const user = await authenticateUser(input.email, input.senha);

        // Cria JWT de sessão usando o openId do usuário
        const sessionToken = await sdk.createSessionToken(user.openId, {
          expiresInMs: ONE_YEAR_MS,
          name: user.name || user.email || "",
        });

        // Define o cookie de sessão
        const cookieOptions = getSessionCookieOptions(ctx.req);
        ctx.res.cookie(COOKIE_NAME, sessionToken, {
          ...cookieOptions,
          maxAge: ONE_YEAR_MS,
        });

        return {
          success: true,
          user: {
            id: user.id,
            name: user.name,
            email: user.email,
            role: user.role,
          },
        };
      }),

    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);

      ctx.res.clearCookie(COOKIE_NAME, {
        ...cookieOptions,
        maxAge: -1,
      });

      return { success: true } as const;
    }),

    getPermissions: protectedProcedure.query(async ({ ctx }) => {
      // getUserPermissions (auth.ts) = permissões do role + overrides individuais
      // getUserPermissoes (db.ts)    = apenas overrides individuais (incompleto)
      return await getUserPermissions(ctx.user!.id);
    }),
  }),

  // ============================================================================
  // DASHBOARD
  // ============================================================================
  notificacoesEstoque: router({
    resumo: permissaoProcedure("dashboard:ver").query(async () => {
      return await db.getResumoNotificacoesEstoque();
    }),
  }),

  dashboard: router({
    overview: permissaoProcedure("dashboard:ver")
      .input(z.object({ obraId: z.number().nullable().optional() }).optional())
      .query(async ({ input }) => {
        return await db.getEstoqueOverview(input?.obraId ?? null);
      }),

    gastoMaterialPorPeriodo: permissaoProcedure("dashboard:ver")
      .input(z.object({
        dataInicio: z.string(),
        dataFim: z.string(),
        agrupamento: z.enum(["dia", "mes"]).default("dia"),
        obraId: z.number().nullable().optional(),
      }))
      .query(async ({ input }) => {
        return await db.getGastoMaterialPorPeriodo(
          new Date(input.dataInicio),
          new Date(input.dataFim),
          input.agrupamento,
          input.obraId ?? null
        );
      }),
    visaoGeralMateriais: permissaoProcedure("dashboard:ver").query(async () => {
      return await db.getVisaoGeralMateriais();
    }),
    detalhesConsumo: permissaoProcedure("dashboard:ver")
      .input(z.object({ obraId: z.number().nullable() }))
      .query(async ({ input }) => {
        return await db.getDetalhesConsumoObra(input.obraId);
      }),
    // Era operatorProcedure — nenhuma chave protegia de fato o export de
    // relatórios, apesar de "relatorios:exportar" existir no catálogo desde
    // sempre. Todos os roles (inclusive viewer) já têm essa chave nos defaults,
    // então viewer passa a poder exportar aqui — alinhado com o que
    // usePermission("relatorios:exportar") já prometia no frontend (Relatorios.tsx).
    exportar: permissaoProcedure("relatorios:exportar")
      .input(z.object({
        obraId: z.number().nullable().optional(),
        dataInicio: z.string().nullable().optional(),
        dataFim: z.string().nullable().optional(),
      }))
      .query(async ({ input }) => {
        return await db.exportarDados(input);
      }),
    analytics: permissaoProcedure("dashboard:ver")
      .input(z.object({
        obraId: z.number().nullable().optional(),
        dataInicio: z.string().nullable().optional(),
        dataFim: z.string().nullable().optional(),
      }).optional())
      .query(async ({ input }) => {
        return await db.getDashboardAnalytics(input ?? {});
      }),

    // Método "master" de exclusão de dados de teste — marca um material ou
    // registro de saída pra não contar mais em nenhum total/gráfico do
    // dashboard e relatórios, sem apagar o registro.
    marcarExclusaoRelatorio: permissaoProcedure("materiais:editar")
      .input(z.object({
        tipo: z.enum(["material", "saida"]),
        id: z.number(),
        excluir: z.boolean(),
      }))
      .mutation(async ({ input, ctx }) => {
        return await db.setExclusaoRelatorio(input.tipo, input.id, input.excluir, ctx.user?.name ?? "Sistema");
      }),
  }),

  // ============================================================================
  // MATERIAIS
  // ============================================================================
  materiais: router({
    listar: permissaoProcedure("materiais:ver").query(async () => {
      return await db.listMateriais();
    }),

    // aliases em inglês usados pelas páginas
    list: permissaoProcedure("materiais:ver").query(async () => {
      return await db.listMateriais();
    }),

    checkNfDuplicada: permissaoProcedure("materiais:ver")
      .input(z.object({ nf: z.string() }))
      .query(async ({ input }) => {
        return await db.checkNfDuplicada(input.nf);
      }),

    checkDuplicado: permissaoProcedure("materiais:ver")
      .input(z.object({
        tipo: z.string(),
        bitola: z.string(),
        aco: z.string(),
        corrida: z.string().optional(),
        quantidade: z.number().optional(),
        local: z.string().optional(),
        comprimento: z.number().optional(),
      }))
      .query(async ({ input }) => {
        return await db.checkMaterialDuplicado(input.tipo, input.bitola, input.aco, input.corrida, input.quantidade, input.local, input.comprimento);
      }),

    listarDuplicados: permissaoProcedure("materiais:ver").query(async () => {
      return await db.listMateriaisDuplicados();
    }),

    listHistorico: permissaoProcedure("materiais:ver")
      .input(z.object({
        limit: z.number().int().positive().default(100),
        offset: z.number().int().nonnegative().default(0),
      }).optional())
      .query(async ({ input }) => {
        return await db.listHistoricoAtividades(input?.limit ?? 100, input?.offset ?? 0);
      }),

    linhaDoTempo: permissaoProcedure("materiais:ver")
      .input(z.object({ materialId: z.number() }))
      .query(async ({ input }) => {
        return await db.getLinhaDoTempoMaterial(input.materialId);
      }),

    // Pacote do material (mesmo perfil/corrida/NF) — quadro da Linha do Tempo
    pacote: permissaoProcedure("materiais:ver")
      .input(z.object({ materialId: z.number() }))
      .query(async ({ input }) => {
        return await db.getPacoteMaterial(input.materialId);
      }),

    buscarParaLinhaDoTempo: permissaoProcedure("materiais:ver")
      .input(z.object({ termo: z.string().min(1) }))
      .query(async ({ input }) => {
        return await db.buscarMaterialParaLinhaDoTempo(input.termo);
      }),

    sugestoesLinhaDoTempo: permissaoProcedure("materiais:ver")
      .input(z.object({ termo: z.string().min(2) }))
      .query(async ({ input }) => {
        return await db.sugestoesLinhaDoTempo(input.termo);
      }),

    listRegistrosSaida: permissaoProcedure("materiais:ver").query(async () => {
      return await db.listRegistrosSaida();
    }),

    baixaLote: permissaoProcedure("materiais:ajustar")
      .input(z.object({
        itens: z.array(z.object({
          id: z.number(),
          quantidadeBaixa: z.number(),
        })),
        motivo: z.string().optional(),
        obraDestino: z.string().optional(),
        dataBaixa: z.string().optional(),
        numeroRequisicao: z.string().optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        return await db.baixaMateriais(
          input.itens,
          input.motivo,
          ctx.user?.name ?? "Sistema",
          input.obraDestino,
          input.dataBaixa ? dataSomenteDiaParaTimestamp(input.dataBaixa) : undefined,
          input.numeroRequisicao
        );
      }),

    mudarObraLote: permissaoProcedure("materiais:ajustar")
      .input(z.object({
        materialIds: z.array(z.number()),
        obraId: z.number().nullable(),
        obraNome: z.string().nullable(),
      }))
      .mutation(async ({ input, ctx }) => {
        return await db.mudarObraLote(input.materialIds, { obraId: input.obraId, obraNome: input.obraNome }, ctx.user?.name ?? "Sistema");
      }),

    criar: permissaoProcedure("materiais:criar")
      .input(z.object({
        tipo: z.string(),
        bitola: z.string(),
        quantidade: z.number(),
        comprimento: z.number(),
        pesoTotal: z.string(),
        aco: z.string(),
        obraId: z.number().nullable().optional(),
        obraNome: z.string().nullable().optional(),
        obraCompraId: z.number().nullable().optional(),
        obraCompraNome: z.string().nullable().optional(),
        local: z.string().nullable().optional(),
        rua: z.string().nullable().optional(),
        vao: z.string().nullable().optional(),
        fornecedor: z.string().nullable().optional(),
        nf: z.string().nullable().optional(),
        numero_certificado: z.string().nullable().optional(),
        numeroCertificado: z.string().nullable().optional(),
        corrida: z.string().nullable().optional(),
        categoria: z.string().default("PERFIL"),
        largura: z.number().nullable().optional(),
        observacoes: z.string().nullable().optional(),
        numeroPedido: z.string().nullable().optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        return await db.createMaterial(input, ctx.user?.name ?? "Sistema");
      }),

    atualizar: permissaoProcedure("materiais:editar")
      .input(z.object({
        id: z.number(),
        tipo: z.string().optional(),
        bitola: z.string().optional(),
        quantidade: z.number().optional(),
        comprimento: z.number().optional(),
        pesoTotal: z.string().optional(),
        aco: z.string().optional(),
        obraId: z.number().nullable().optional(),
        obraNome: z.string().nullable().optional(),
        obraCompraId: z.number().nullable().optional(),
        obraCompraNome: z.string().nullable().optional(),
        local: z.string().nullable().optional(),
        rua: z.string().nullable().optional(),
        vao: z.string().nullable().optional(),
        fornecedor: z.string().nullable().optional(),
        nf: z.string().nullable().optional(),
        numero_certificado: z.string().nullable().optional(),
        numeroCertificado: z.string().nullable().optional(),
        corrida: z.string().nullable().optional(),
        categoria: z.string().optional(),
        largura: z.number().nullable().optional(),
        observacoes: z.string().nullable().optional(),
        numeroPedido: z.string().nullable().optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        const { id, ...data } = input;
        return await db.updateMaterial(id, data, ctx.user?.name ?? "Sistema");
      }),

    deletar: permissaoProcedure("materiais:remover")
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input, ctx }) => {
        return await db.deleteMaterial(input.id, ctx.user?.name ?? "Sistema");
      }),

    obterPeso: permissaoProcedure("materiais:ver")
      .input(z.object({
        tipo: z.string(),
        bitola: z.string(),
        aco: z.string(),
        categoria: z.string().optional(),
      }))
      .query(async ({ input }) => {
        return await db.obterPesoPorMetro(input);
      }),

    baixa: permissaoProcedure("materiais:ajustar")
      .input(z.object({
        itens: z.array(z.object({
          id: z.number(),
          quantidadeBaixa: z.number(),
        })),
        motivo: z.string().optional(),
      }))
      .mutation(async ({ input }) => {
        return await db.realizarBaixa(input.itens, input.motivo);
      }),

    gerarEtiqueta: operatorProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input }) => {
        return await db.marcarEtiquetaImpressa(input.id);
      }),

    marcarEtiquetaImpressa: operatorProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input }) => {
        return await db.marcarEtiquetaImpressa(input.id);
      }),

    // GRDs do material — entram no QR code da etiqueta
    grdsDoMaterial: permissaoProcedure("materiais:ver")
      .input(z.object({ id: z.number() }))
      .query(async ({ input }) => {
        return await db.listarGrdsDoMaterial(input.id);
      }),

    // aliases em inglês usados pelas páginas
    create: permissaoProcedure("materiais:criar")
      .input(z.object({
        tipo: z.string(),
        bitola: z.string(),
        quantidade: z.number(),
        comprimento: z.number(),
        pesoTotal: z.string(),
        aco: z.string(),
        obraId: z.number().nullable().optional(),
        obraNome: z.string().nullable().optional(),
        obraCompraId: z.number().nullable().optional(),
        obraCompraNome: z.string().nullable().optional(),
        local: z.string().nullable().optional(),
        rua: z.string().nullable().optional(),
        vao: z.string().nullable().optional(),
        fornecedor: z.string().nullable().optional(),
        nf: z.string().nullable().optional(),
        numero_certificado: z.string().nullable().optional(),
        numeroCertificado: z.string().nullable().optional(),
        corrida: z.string().nullable().optional(),
        categoria: z.string().default("PERFIL"),
        largura: z.number().nullable().optional(),
        observacoes: z.string().nullable().optional(),
        numeroPedido: z.string().nullable().optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        return await db.createMaterial(input, ctx.user?.name ?? "Sistema");
      }),

    update: permissaoProcedure("materiais:editar")
      .input(z.object({
        id: z.number(),
        tipo: z.string().optional(),
        bitola: z.string().optional(),
        quantidade: z.number().optional(),
        comprimento: z.number().optional(),
        pesoTotal: z.string().optional(),
        aco: z.string().optional(),
        obraId: z.number().nullable().optional(),
        obraNome: z.string().nullable().optional(),
        obraCompraId: z.number().nullable().optional(),
        obraCompraNome: z.string().nullable().optional(),
        local: z.string().nullable().optional(),
        rua: z.string().nullable().optional(),
        vao: z.string().nullable().optional(),
        fornecedor: z.string().nullable().optional(),
        nf: z.string().nullable().optional(),
        numero_certificado: z.string().nullable().optional(),
        numeroCertificado: z.string().nullable().optional(),
        corrida: z.string().nullable().optional(),
        categoria: z.string().optional(),
        largura: z.number().nullable().optional(),
        observacoes: z.string().nullable().optional(),
        numeroPedido: z.string().nullable().optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        const { id, ...data } = input;
        return await db.updateMaterial(id, data, ctx.user?.name ?? "Sistema");
      }),

    delete: permissaoProcedure("materiais:remover")
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input, ctx }) => {
        return await db.deleteMaterial(input.id, ctx.user?.name ?? "Sistema");
      }),

    // Hard delete em lote — exclusivo para owner
    hardDelete: ownerProcedure
      .input(z.object({
        ids: z.array(z.number()).min(1),
        confirmacao: z.literal("CONFIRMAR"),
      }))
      .mutation(async ({ input, ctx }) => {
        const ownerNome = ctx.user?.name ?? "Owner";
        return await db.hardDeleteMateriais(input.ids, ownerNome);
      }),

    // Busca global de materiais (usada pelo StockDashboardLayout)
    busca: permissaoProcedure("materiais:ver")
      .input(z.object({ termo: z.string().min(2) }))
      .query(async ({ input }) => {
        return await db.buscaRapidaMaterial(input.termo) ?? [];
      }),
  }),

  // ============================================================================
  // OBRAS
  // ============================================================================
  locais: router({
    listar: permissaoProcedure("locais:ver").query(async () => {
      return await db.listLocaisEstoque();
    }),

    listarAtivos: permissaoProcedure("locais:ver").query(async () => {
      return await db.listLocaisEstoque(true);
    }),

    criar: permissaoProcedure("locais:criar")
      .input(z.object({ nome: z.string().min(1) }))
      .mutation(async ({ input }) => {
        return await db.createLocalEstoque(input.nome);
      }),

    atualizar: permissaoProcedure("locais:editar")
      .input(z.object({ id: z.number(), nome: z.string().min(1).optional(), ativo: z.boolean().optional() }))
      .mutation(async ({ input }) => {
        const { id, ...data } = input;
        return await db.updateLocalEstoque(id, data);
      }),

    deletar: permissaoProcedure("locais:remover")
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input }) => {
        return await db.deleteLocalEstoque(input.id);
      }),
  }),

  obras: router({
    listar: permissaoProcedure("obras:ver").query(async () => {
      return await db.listObras();
    }),

    // aliases em inglês usados pelas páginas
    list: permissaoProcedure("obras:ver").query(async () => {
      return await db.listObras();
    }),

    criar: permissaoProcedure("obras:criar")
      .input(z.object({
        nome: z.string(),
        cliente: z.string().optional(),
        codigo: z.string().optional(),
        localizacao: z.string().optional(),
        logoUrl: z.string().optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        return await db.createObra(input, ctx.user?.name ?? "Sistema");
      }),

    create: permissaoProcedure("obras:criar")
      .input(z.object({
        nome: z.string(),
        cliente: z.string().optional(),
        codigo: z.string().optional(),
        localizacao: z.string().optional(),
        logoUrl: z.string().optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        return await db.createObra(input, ctx.user?.name ?? "Sistema");
      }),

    atualizar: permissaoProcedure("obras:editar")
      .input(z.object({
        id: z.number(),
        nome: z.string().optional(),
        cliente: z.string().optional(),
        codigo: z.string().optional(),
        localizacao: z.string().optional(),
        logoUrl: z.string().optional(),
        status: z.enum(["ativa", "concluida", "pausada"]).optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        const { id, ...data } = input;
        return await db.updateObra(id, data, ctx.user?.name ?? "Sistema");
      }),

    update: permissaoProcedure("obras:editar")
      .input(z.object({
        id: z.number(),
        nome: z.string().optional(),
        cliente: z.string().optional(),
        codigo: z.string().optional(),
        localizacao: z.string().optional(),
        logoUrl: z.string().optional(),
        status: z.enum(["ativa", "concluida", "pausada"]).optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        const { id, ...data } = input;
        return await db.updateObra(id, data, ctx.user?.name ?? "Sistema");
      }),

    deletar: permissaoProcedure("obras:remover")
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input, ctx }) => {
        return await db.deleteObra(input.id, ctx.user?.name ?? "Sistema");
      }),

    delete: permissaoProcedure("obras:remover")
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input, ctx }) => {
        return await db.deleteObra(input.id, ctx.user?.name ?? "Sistema");
      }),
  }),

  // ============================================================================
  // ESPECIFICAÇÕES
  // ============================================================================
  especificacoes: router({
    listar: permissaoProcedure("especificacoes:ver").query(async () => {
      return await db.listEspecificacoes();
    }),

    // aliases em inglês usados pelas páginas
    list: permissaoProcedure("especificacoes:ver")
      .input(z.object({
        page: z.number().default(1),
        pageSize: z.number().default(50),
        search: z.string().optional(),
        categoria: z.string().optional(),
        tipo: z.string().optional(),
        aco: z.string().optional(),
      }).optional())
      .query(async ({ input }) => {
        const temFiltroDedicado = !!(input?.categoria || input?.tipo || input?.aco);
        // Se vier com paginação ou algum filtro (texto ou dedicado), usa função paginada
        if (input?.search || temFiltroDedicado || (input?.page && input.page > 1)) {
          return await db.getEspecificacoesPaginated(
            input.page ?? 1,
            input.pageSize ?? 50,
            input.search,
            { categoria: input?.categoria, tipo: input?.tipo, aco: input?.aco }
          );
        }
        // Sem filtro ou página 1 sem busca: retorna tudo no formato { data, total, totalPages }
        const all = await db.listEspecificacoes() ?? [];
        const pageSize = input?.pageSize ?? 50;
        const page = input?.page ?? 1;
        const start = (page - 1) * pageSize;
        const data = all.slice(start, start + pageSize);
        return {
          data,
          total: all.length,
          totalPages: Math.max(1, Math.ceil(all.length / pageSize)),
          page,
        };
      }),

    criar: permissaoProcedure("especificacoes:editar")
      .input(z.object({
        tipo: z.string(),
        bitola: z.string(),
        aco: z.string(),
        pesoPorMetro: z.string(),
        categoria: z.string().default("PERFIL"),
        unidade: z.string().default("mm"),
        estoqueMinimo: z.string().optional(),
        valorUnitario: z.string().optional(),
      }))
      .mutation(async ({ input }) => {
        return await db.createEspecificacao(input);
      }),

    create: permissaoProcedure("especificacoes:editar")
      .input(z.object({
        tipo: z.string(),
        bitola: z.string(),
        aco: z.string(),
        pesoPorMetro: z.string(),
        categoria: z.string().default("PERFIL"),
        unidade: z.string().default("mm"),
        estoqueMinimo: z.string().optional(),
        valorUnitario: z.string().optional(),
      }))
      .mutation(async ({ input }) => {
        return await db.createEspecificacao(input);
      }),

    atualizar: permissaoProcedure("especificacoes:editar")
      .input(z.object({
        id: z.number(),
        tipo: z.string().optional(),
        bitola: z.string().optional(),
        aco: z.string().optional(),
        pesoPorMetro: z.string().optional(),
        categoria: z.string().optional(),
        unidade: z.string().optional(),
        estoqueMinimo: z.string().optional(),
        valorUnitario: z.string().optional(),
        ativo: z.boolean().optional(),
      }))
      .mutation(async ({ input }) => {
        const { id, ...data } = input;
        return await db.updateEspecificacao(id, data);
      }),

    update: permissaoProcedure("especificacoes:editar")
      .input(z.object({
        id: z.number(),
        tipo: z.string().optional(),
        bitola: z.string().optional(),
        aco: z.string().optional(),
        pesoPorMetro: z.string().optional(),
        categoria: z.string().optional(),
        unidade: z.string().optional(),
        estoqueMinimo: z.string().optional(),
        valorUnitario: z.string().optional(),
        ativo: z.boolean().optional(),
      }))
      .mutation(async ({ input }) => {
        const { id, ...data } = input;
        return await db.updateEspecificacao(id, data);
      }),

    lookup: permissaoProcedure("especificacoes:ver")
      .input(z.object({
        tipo: z.string(),
        bitola: z.string(),
        aco: z.string(),
        categoria: z.string().optional(),
      }))
      .query(async ({ input }) => {
        return await db.getEspecificacaoByTipoBitolaAco(
          input.tipo,
          input.bitola,
          input.aco,
          input.categoria ?? "PERFIL"
        );
      }),

    paginated: permissaoProcedure("especificacoes:ver")
      .input(z.object({
        page: z.number().default(1),
        pageSize: z.number().default(20),
        search: z.string().optional(),
      }))
      .query(async ({ input }) => {
        return await db.getEspecificacoesPaginated(input.page, input.pageSize, input.search);
      }),

    deletar: permissaoProcedure("especificacoes:editar")
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input }) => {
        return await db.deleteEspecificacao(input.id);
      }),

    delete: permissaoProcedure("especificacoes:editar")
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input }) => {
        return await db.deleteEspecificacao(input.id);
      }),

    importarExcel: permissaoProcedure("especificacoes:editar")
      .input(
        z.object({
          dados: z.array(z.record(z.string(), z.any())),
        })
      )
      .mutation(async ({ input }) => {
        let count = 0;

        for (const linha of input.dados) {
          const tipo = String(linha["TIPO"] || linha["tipo"] || "").trim();
          const bitola = String(
            linha["EM  MILIMETROS"] ||
              linha["EM MILIMETROS"] ||
              linha["bitola"] ||
              ""
          ).trim();

          const aco = String(
            linha["AÇO"] || linha["ACO"] || linha["aco"] || ""
          ).trim();

          const peso = String(
            linha["PESO POR METRO"] || linha["peso"] || "0"
          ).replace(",", ".");

          if (tipo && bitola && peso !== "0") {
            await db.createEspecificacao({
              tipo,
              bitola,
              aco,
              pesoPorMetro: peso,
              unidade: "mm",
            });

            count++;
          }
        }

        return { sucesso: true, total: count };
      }),

    atualizarValoresEmLote: permissaoProcedure("especificacoes:editar")
      .input(z.object({
        itens: z.array(z.object({
          id: z.number(),
          valorUnitario: z.string(),
        })),
      }))
      .mutation(async ({ input, ctx }) => {
        return await db.atualizarValoresEmLote(input.itens, ctx.user?.name ?? "Sistema");
      }),

    atualizarValorPorTipo: permissaoProcedure("especificacoes:editar")
      .input(z.object({
        grupos: z.array(z.object({
          tipo: z.string(),
          categoria: z.string(),
          valorUnitario: z.string(),
        })),
      }))
      .mutation(async ({ input, ctx }) => {
        return await db.atualizarValorPorTipo(input.grupos, ctx.user?.name ?? "Sistema");
      }),
  }),

  // ============================================================================
  // ESTOQUE
  // ============================================================================
  estoque: router({
    list: viewerProcedure.query(async () => {
      return await db.listEstoque();
    }),

    obterPorMaterial: viewerProcedure
      .input(z.object({ materialId: z.number() }))
      .query(async ({ input }) => {
        return await db.getEstoqueByMaterial(input.materialId);
      }),
  }),

  // ============================================================================
  // MOVIMENTAÇÕES
  // ============================================================================
  movimentacoes: router({
    list: permissaoProcedure("movimentacoes:ver").query(async () => {
      return await db.listMovimentacoes();
    }),

    create: operatorProcedure
      .input(z.object({
        estoqueId: z.number(),
        tipo: z.enum(["entrada", "saida", "retorno_sobra", "ajuste"]),
        quantidade: z.string(),
        comprimento: z.string().optional(),
        saldoAnterior: z.string(),
        saldoPosterior: z.string(),
        observacao: z.string().optional(),
        referenciaType: z.string().optional(),
        referenciaId: z.number().optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        return await db.createMovimentacao(input, ctx.user?.id || 1);
      }),
  }),

  // ============================================================================
  // PLANOS DE CORTE
  // ============================================================================
  planoCorte: router({
    listar: viewerProcedure.query(async () => {
      return await db.listPlanosCote();
    }),

    // Nota: reaproveita a chave "solicitacoes:criar" — apesar do nome, essa
    // chave nunca protegeu a criação de solicitações (solicitacoes.criar usa
    // só operatorProcedure). Ver comentário em shared/permissoes.ts.
    criar: permissaoProcedure("solicitacoes:criar")
      .input(z.object({
        obraId: z.number(),
        titulo: z.string(),
        operador: z.string().optional(),
      }))
      .mutation(async ({ input }) => {
        return await db.createPlanoCote(input);
      }),

    adicionarItem: operatorProcedure
      .input(z.object({
        planoId: z.number(),
        estoqueId: z.number(),
        qtdBarrasUsadas: z.number(),
        compConsumido: z.number(),
        compSobra: z.number(),
        pecasCorte: z.number(),
        sobraRetornaEstoque: z.boolean().optional(),
      }))
      .mutation(async ({ input }) => {
        return await db.adicionarItemPlano(input);
      }),

    removerItem: operatorProcedure
      .input(z.object({ itemId: z.number() }))
      .mutation(async ({ input }) => {
        return await db.removerItemPlano(input.itemId);
      }),

    processar: permissaoProcedure("importacao:executar")
      .input(z.object({ planoId: z.number() }))
      .mutation(async ({ input, ctx }) => {
        return await db.processarPlanoCote(input.planoId, ctx.user?.name ?? "Sistema");
      }),
  }),

  // ============================================================================
  // IMPORTAÇÃO
  // ============================================================================
  importacao: router({
    processar: operatorProcedure
      .input(z.object({ xmlContent: z.string() }))
      .mutation(async ({ input, ctx }) => {
        const nfeData = parseNfeXml(input.xmlContent);
        return await db.importarNFe(nfeData, ctx.user?.name ?? "Sistema");
      }),

    processarNfe: permissaoProcedure("materiais:importar")
      .input(z.object({
        xml: z.string().optional(),
        xmlContent: z.string().optional(),
      }))
      .mutation(async ({ input }) => {
        const xmlStr = input.xml ?? input.xmlContent ?? "";
        if (!xmlStr) throw new Error("Conteúdo XML não informado.");
        // Apenas parseia e retorna — o client exibe, edita e confirma separadamente
        // O salvamento real acontece via materiais.create (confirmarImportacaoXml)
        const nfeData = parseNfeXml(xmlStr);
        if (!nfeData.itens.length) throw new Error("Nenhum item encontrado no XML. Verifique se é uma NF-e válida.");
        return {
          nf: nfeData.nf,
          fornecedor: nfeData.fornecedor,
          itens: nfeData.itens,   // array completo para o client editar antes de salvar
        };
      }),

    // O botão "Confirmar Importação" em Importacao.tsx sempre exigiu
    // permission="importacao:executar" no frontend; o backend exigia
    // "materiais:importar" — alinhado aqui. Atenção: o role "supervisor" tem
    // "materiais:importar" por padrão mas NÃO tem "importacao:executar" — essa
    // troca restringe quem consegue confirmar importação por Excel nessa tela
    // (ver relatório de auditoria, achado #4, para detalhes desse efeito colateral).
    processarExcel: permissaoProcedure("importacao:executar")
      .input(z.object({
        dados: z.array(z.record(z.string(), z.union([z.string(), z.number(), z.null(), z.undefined()]))).optional(),
        itens: z.array(z.record(z.string(), z.union([z.string(), z.number(), z.null(), z.undefined()]))).optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        const linhas = input.dados ?? input.itens ?? [];
        const erros: string[] = [];
        let total = 0;
        const usuarioNome = ctx.user?.name ?? "Sistema";

        // Helper: extrai string limpa ou undefined se vazio/undefined
        const str = (v: any): string | undefined => {
          if (v === undefined || v === null) return undefined;
          const s = String(v).trim();
          return s === "" || s === "undefined" || s === "null" ? undefined : s;
        };

        // Helper: extrai número ou fallback
        const num = (v: any, fallback = 0): number => {
          if (v === undefined || v === null) return fallback;
          // Tratar formatos como "12.000" (separador de milhar) ou "12,5" (decimal BR)
          const cleaned = String(v).replace(/\./g, "").replace(",", ".");
          const n = parseFloat(cleaned);
          return isNaN(n) ? fallback : n;
        };

        for (let i = 0; i < linhas.length; i++) {
          const item = linhas[i];
          const linha = i + 2; // linha real no Excel (1 = header)

          try {
            const tipo   = str(item.tipo);
            const bitola = str(item.bitola);

            if (!tipo || !bitola) {
              erros.push(`Linha ${linha}: TIPO e BITOLA são obrigatórios (encontrado: tipo="${item.tipo}", bitola="${item.bitola}")`);
              continue;
            }

            const quantidade  = Math.max(1, Math.round(num(item.quantidade, 1)));
            const comprimento = Math.round(num(item.comprimento, 0));
            const aco         = str(item.aco) || "A36";
            const obraNome    = str(item.obra) || "LIVRE";
            const local       = str(item.local) || null;
            const fornecedor  = str(item.fornecedor) || null;
            const nf          = str(item.nf) || null;
            const numeroCertificado = str(item.numeroCertificado) || null;
            const corrida     = str(item.corrida) || null;

            await db.createMaterial({
              tipo: tipo.toUpperCase(),
              bitola: bitola.toUpperCase(),
              aco: aco.toUpperCase(),
              quantidade,
              comprimento,
              obraNome,
              local,
              fornecedor,
              nf,
              numeroCertificado,
              corrida,
              pesoTotal: "0.000",
            }, `${usuarioNome} (Importação Excel)`);

            total++;
          } catch (err: any) {
            const msg = err?.message || String(err);
            erros.push(`Linha ${linha} (${item.tipo || "?"} ${item.bitola || "?"}): ${msg}`);
            console.error(`[processarExcel] Erro na linha ${linha}:`, err);
          }
        }

        return { sucesso: true, total, erros };
      }),
  }),

  // ============================================================================
  // SOLICITAÇÕES DE SEPARAÇÃO
  // ============================================================================
  solicitacoes: router({
    listar: permissaoProcedure("solicitacoes:ver").query(async () => {
      return await db.listSolicitacoes();
    }),

    // aliases em inglês + ações específicas usadas pelas páginas
    list: permissaoProcedure("solicitacoes:ver").query(async () => {
      return await db.listSolicitacoes();
    }),

    criar: operatorProcedure
      .input(z.object({
        usuarioSolicitante: z.string().optional(),
        observacaoSolicitante: z.string().optional(),
        obraDestinoId: z.number().nullable().optional(),
        dataLimite: z.string().optional(),
        itens: z.array(z.object({
          materialId: z.number(),
          quantidadeSolicitada: z.number(),
          loteId: z.number().optional(),
          comprimentoEspecifico: z.number().optional(),
        })),
      }))
      .mutation(async ({ input, ctx }) => {
        return await db.createSolicitacao({ ...input, usuarioSolicitante: ctx.user?.name ?? input.usuarioSolicitante ?? "Sistema" });
      }),

    create: operatorProcedure
      .input(z.object({
        usuarioSolicitante: z.string().optional(),
        observacaoSolicitante: z.string().optional(),
        obraDestinoId: z.number().nullable().optional(),
        dataLimite: z.string().optional(),
        itens: z.array(z.object({
          materialId: z.number(),
          quantidadeSolicitada: z.number(),
          loteId: z.number().optional(),
          comprimentoEspecifico: z.number().optional(),
        })),
      }))
      .mutation(async ({ input, ctx }) => {
        return await db.createSolicitacao({ ...input, usuarioSolicitante: ctx.user?.name ?? input.usuarioSolicitante ?? "Sistema" });
      }),

    atualizar: operatorProcedure
      .input(z.object({
        id: z.number(),
        status: z.enum(["pendente", "em_separacao", "concluido", "cancelado"]).optional(),
        observacaoResposta: z.string().optional(),
      }))
      .mutation(async ({ input }) => {
        const { id, ...data } = input;
        return await db.updateSolicitacao(id, data);
      }),

    responder: permissaoProcedure("solicitacoes:responder")
      .input(z.object({
        id: z.number(),
        observacaoResposta: z.string(),
      }))
      .mutation(async ({ input, ctx }) => {
        return await db.responderSolicitacao(input.id, input.observacaoResposta, ctx.user?.name ?? "Sistema");
      }),

    atualizarObservacoesSeparacao: permissaoProcedure("solicitacoes:responder")
      .input(z.object({ id: z.number(), observacoesSeparacao: z.string() }))
      .mutation(async ({ input, ctx }) => {
        return await db.atualizarObservacoesSeparacao(input.id, input.observacoesSeparacao, ctx.user?.name ?? "Sistema");
      }),

    uploadImagem: permissaoProcedure("solicitacoes:responder")
      .input(z.object({
        solicitacaoId: z.number(),
        nomeArquivo: z.string(),
        tipoArquivo: z.string(),
        conteudoBase64: z.string(),
      }))
      .mutation(async ({ input, ctx }) => {
        return await db.uploadImagemSeparacao(input.solicitacaoId, input, ctx.user?.name ?? "Sistema");
      }),

    listarImagens: permissaoProcedure("solicitacoes:ver")
      .input(z.object({ solicitacaoId: z.number() }))
      .query(async ({ input }) => {
        return await db.listImagensSeparacao(input.solicitacaoId);
      }),

    obterImagem: permissaoProcedure("solicitacoes:ver")
      .input(z.object({ id: z.number() }))
      .query(async ({ input }) => {
        const img = await db.getImagemSeparacaoConteudo(input.id);
        if (!img) return null;
        return {
          nomeArquivo: img.nomeArquivo,
          tipoArquivo: img.tipoArquivo,
          conteudoBase64: (img.conteudo as Buffer).toString("base64"),
        };
      }),

    deletarImagem: permissaoProcedure("solicitacoes:responder")
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input, ctx }) => {
        return await db.deletarImagemSeparacao(input.id, ctx.user?.name ?? "Sistema");
      }),

    concluir: permissaoProcedure("solicitacoes:concluir")
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input, ctx }) => {
        return await db.concluirSolicitacao(input.id, ctx.user?.name ?? "Sistema");
      }),

    // Nota: reaproveita a chave "solicitacoes:criar" para proteger a EXCLUSÃO
    // de uma solicitação — ver comentário em shared/permissoes.ts.
    deletar: permissaoProcedure("solicitacoes:criar")
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input, ctx }) => {
        return await db.deleteSolicitacao(input.id, ctx.user?.name ?? "Sistema");
      }),
  }),

  // ============================================================================
  // REQUISIÇÕES DE PRODUÇÃO (separação por leitura de QR code)
  // ============================================================================
  // Separar segue a mesma regra de criar solicitação (qualquer operador);
  // aprovar/rejeitar/devolver é exclusivo de ADM (admin/owner), porque a
  // aprovação dá baixa no estoque.
  requisicoesProducao: router({
    listar: permissaoProcedure("solicitacoes:ver").query(async () => {
      return await db.listRequisicoesProducao();
    }),

    obter: permissaoProcedure("solicitacoes:ver")
      .input(z.object({ id: z.number() }))
      .query(async ({ input }) => {
        return await db.getRequisicaoProducao(input.id);
      }),

    lerMaterial: permissaoProcedure("solicitacoes:ver")
      .input(z.object({ materialId: z.number(), requisicaoId: z.number().optional() }))
      .query(async ({ input }) => {
        return await db.lerMaterialParaRequisicao(input.materialId, input.requisicaoId);
      }),

    // Usado pela lista de Materiais pra sinalizar o que está reservado
    reservas: permissaoProcedure("materiais:ver").query(async () => {
      return await db.listReservasRequisicaoProducao();
    }),

    criar: operatorProcedure
      .input(z.object({
        numero: z.string().trim().min(1, "Informe o número da requisição"),
        dataRequisicao: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Informe a data da requisição"),
        obraId: z.number({ message: "Selecione a obra" }),
        etapa: z.string().trim().min(1, "Informe a etapa"),
        observacoes: z.string().optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        return await db.criarRequisicaoProducao(input, ctx.user?.name ?? "Sistema");
      }),

    atualizarCabecalho: operatorProcedure
      .input(z.object({
        id: z.number(),
        numero: z.string().trim().min(1, "Informe o número da requisição"),
        dataRequisicao: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Informe a data da requisição"),
        obraId: z.number({ message: "Selecione a obra" }),
        etapa: z.string().trim().min(1, "Informe a etapa"),
        observacoes: z.string().optional(),
      }))
      .mutation(async ({ input }) => {
        const { id, ...data } = input;
        return await db.atualizarCabecalhoRequisicao(id, data);
      }),

    adicionarItem: operatorProcedure
      .input(z.object({ requisicaoId: z.number(), materialId: z.number(), quantidade: z.number().int().positive() }))
      .mutation(async ({ input, ctx }) => {
        return await db.adicionarItemRequisicao(input.requisicaoId, input.materialId, input.quantidade, ctx.user?.name ?? "Sistema");
      }),

    definirQuantidadeItem: operatorProcedure
      .input(z.object({ itemId: z.number(), quantidade: z.number().int().min(0) }))
      .mutation(async ({ input }) => {
        return await db.definirQuantidadeItemRequisicao(input.itemId, input.quantidade);
      }),

    enviarParaAprovacao: operatorProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input, ctx }) => {
        return await db.enviarRequisicaoParaAprovacao(input.id, ctx.user?.name ?? "Sistema");
      }),

    cancelar: operatorProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input, ctx }) => {
        return await db.cancelarRequisicaoProducao(input.id, ctx.user?.name ?? "Sistema");
      }),

    aprovar: adminProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input, ctx }) => {
        return await db.aprovarRequisicaoProducao(input.id, ctx.user?.name ?? "Sistema");
      }),

    rejeitar: adminProcedure
      .input(z.object({ id: z.number(), motivo: z.string().trim().min(1, "Informe o motivo") }))
      .mutation(async ({ input, ctx }) => {
        return await db.rejeitarRequisicaoProducao(input.id, input.motivo, ctx.user?.name ?? "Sistema");
      }),

    devolver: adminProcedure
      .input(z.object({ id: z.number(), motivo: z.string().optional() }))
      .mutation(async ({ input, ctx }) => {
        return await db.devolverRequisicaoParaSeparacao(input.id, input.motivo, ctx.user?.name ?? "Sistema");
      }),
  }),

  // ============================================================================
  // REGISTROS DE SAÍDA
  // ============================================================================
  registrosEntrada: router({
    listar: permissaoProcedure("registros_entrada:ver").query(async () => {
      return await db.listRegistrosEntrada();
    }),
  }),

  relatoriosRecebimento: router({
    listar: viewerProcedure.query(async () => {
      return await db.listRelatoriosRecebimento();
    }),
    obter: viewerProcedure
      .input(z.object({ id: z.number() }))
      .query(async ({ input }) => {
        return await db.getRelatorioRecebimentoById(input.id);
      }),
    criar: operatorProcedure
      .input(z.object({ dados: z.any() }))
      .mutation(async ({ input, ctx }) => {
        return await db.createRelatorioRecebimento(input.dados, ctx.user?.name ?? "Sistema");
      }),

    // Editar e excluir relatório já salvo: só administrador (e owner).
    atualizar: adminProcedure
      .input(z.object({ id: z.number(), dados: z.any() }))
      .mutation(async ({ input, ctx }) => {
        return await db.atualizarRelatorioRecebimento(input.id, input.dados, ctx.user?.name ?? "Sistema");
      }),
    excluir: adminProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input, ctx }) => {
        return await db.excluirRelatorioRecebimento(input.id, ctx.user?.name ?? "Sistema");
      }),

    uploadImagem: operatorProcedure
      .input(z.object({
        relatorioId: z.number(),
        nomeArquivo: z.string(),
        tipoArquivo: z.string(),
        conteudoBase64: z.string(),
        cargaId: z.string().optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        return await db.uploadImagemRecebimento(input.relatorioId, input, ctx.user?.name ?? "Sistema");
      }),

    listarImagens: viewerProcedure
      .input(z.object({ relatorioId: z.number() }))
      .query(async ({ input }) => {
        return await db.listImagensRecebimento(input.relatorioId);
      }),

    obterImagem: viewerProcedure
      .input(z.object({ id: z.number() }))
      .query(async ({ input }) => {
        const img = await db.getImagemRecebimentoConteudo(input.id);
        if (!img) return null;
        return {
          nomeArquivo: img.nomeArquivo,
          tipoArquivo: img.tipoArquivo,
          conteudoBase64: (img.conteudo as Buffer).toString("base64"),
        };
      }),

    deletarImagem: operatorProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input, ctx }) => {
        return await db.deletarImagemRecebimento(input.id, ctx.user?.name ?? "Sistema");
      }),
  }),

  registrosSaida: router({
    listar: permissaoProcedure("saidas:ver").query(async () => {
      return await db.listRegistrosSaida();
    }),

    criar: permissaoProcedure("saidas:criar")
      .input(z.object({
        tipo: z.string(),
        bitola: z.string(),
        quantidade: z.number(),
        comprimento: z.number(),
        pesoTotal: z.string(),
        aco: z.string(),
        obraNome: z.string().optional(),
        local: z.string().optional(),
        fornecedor: z.string().optional(),
        nf: z.string().optional(),
        numero_certificado: z.string().optional(),
        corrida: z.string().optional(),
      }))
      .mutation(async ({ input }) => {
        return await db.createRegistroSaida(input);
      }),
  }),

  // ============================================================================
  // HISTÓRICO DE ATIVIDADES
  // ============================================================================
  historico: router({
    listar: viewerProcedure.query(async () => {
      return await db.listHistoricoAtividades();
    }),
  }),

  // ============================================================================
  // RELATÓRIOS
  // ============================================================================
  relatorios: router({
    resumoEstoque: permissaoProcedure("relatorios:ver").query(async () => {
      return await db.getResumoEstoque();
    }),

    movimentacoesPorPeriodo: permissaoProcedure("relatorios:ver")
      .input(z.object({
        dataInicio: z.string(),
        dataFim: z.string(),
      }))
      .query(async ({ input }) => {
        return await db.getMovimentacoesPorPeriodo(input.dataInicio, input.dataFim);
      }),

    consumoPorObra: permissaoProcedure("relatorios:ver").query(async () => {
      return await db.getConsumoPorObra();
    }),

    materiaisComBaixoEstoque: permissaoProcedure("relatorios:ver").query(async () => {
      return await db.getMateriaisComBaixoEstoque();
    }),
  }),

  // ============================================================================
  // INVENTÁRIO
  // ============================================================================
  inventarios: router({
    listar: permissaoProcedure("inventario:ver").query(async () => {
      return await db.listInventarios();
    }),

    listarDivergenciasNegativas: permissaoProcedure("inventario:ver").query(async () => {
      return await db.listDivergenciasNegativas();
    }),

    justificarDivergencia: permissaoProcedure("inventario:processar")
      .input(z.object({ itemInventarioId: z.number(), justificativa: z.string().min(1) }))
      .mutation(async ({ input, ctx }) => {
        return await db.justificarDivergencia(input.itemInventarioId, input.justificativa, ctx.user?.name ?? "Sistema");
      }),

    // Botões "Novo Inventário"/"Editar" em Inventario.tsx já escondiam essas
    // ações atrás de PermissionGate permission="inventario:criar" — o backend
    // usava só operatorProcedure, sem checar a chave, então um operador com
    // "inventario:criar" revogado individualmente não via o botão mas ainda
    // conseguia chamar a mutation diretamente.
    criar: permissaoProcedure("inventario:criar")
      .input(z.object({
        numero: z.string(),
        descricao: z.string().optional(),
        observacoes: z.string().optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        const usuario = ctx.user?.name || ctx.user?.email || "Sistema";
        return await db.createInventario({ ...input, usuarioAbertura: usuario });
      }),

    atualizar: permissaoProcedure("inventario:criar")
      .input(z.object({
        id: z.number(),
        numero: z.string().optional(),
        descricao: z.string().optional(),
        observacoes: z.string().optional(),
      }))
      .mutation(async ({ input }) => {
        const { id, ...data } = input;
        return await db.updateInventario(id, data);
      }),

    deletar: permissaoProcedure("inventario:criar")
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input }) => {
        return await db.deleteInventario(input.id);
      }),

    // O botão "Iniciar Contagem" em Inventario.tsx sempre exigiu
    // permission="inventario:contar" no frontend; o backend exigia
    // "inventario:criar" — alinhado aqui para bater com o que a tela promete.
    abrir: permissaoProcedure("inventario:contar")
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input, ctx }) => {
        const usuario = ctx.user?.name || ctx.user?.email || "Sistema";
        return await db.abrirInventario(input.id, usuario);
      }),

    fechar: permissaoProcedure("inventario:processar")
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input, ctx }) => {
        const usuario = ctx.user?.name || ctx.user?.email || "Sistema";
        return await db.fecharInventario(input.id, usuario);
      }),

    processarAjustes: permissaoProcedure("inventario:processar")
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input, ctx }) => {
        return await db.processarAjustesInventario(input.id, ctx.user?.id || 1, ctx.user?.name ?? "Sistema");
      }),

    salvarContagem: permissaoProcedure("inventario:contar")
      .input(z.object({
        inventarioId: z.number(),
        itens: z.array(z.object({
          itemId: z.number(),
          quantidadeContada: z.number(),
          observacoes: z.string().optional(),
        })),
      }))
      .mutation(async ({ input }) => {
        return await db.salvarContagemInventario(input.inventarioId, input.itens);
      }),

    // alias usado pela página de inventário
    listarItens: permissaoProcedure("inventario:ver")
      .input(z.object({ inventarioId: z.number() }))
      .query(async ({ input }) => {
        return await db.listItensInventario(input.inventarioId);
      }),

    // Material encontrado na contagem que não está no cadastro — quem conta
    // registra; fica pendente até alguém com "inventario:processar" analisar.
    cadastrarMaterialForaCadastro: permissaoProcedure("inventario:contar")
      .input(z.object({
        inventarioId: z.number(),
        categoria: z.enum(["PERFIL", "CHAPA"]),
        tipo: z.string().trim().min(1),
        bitola: z.string().trim().min(1),
        aco: z.string().trim().min(1),
        quantidade: z.number().int().min(1),
        comprimento: z.number().int().min(1),
        largura: z.number().int().optional(),
        local: z.string().optional(),
        obraId: z.number().optional(),
        fornecedor: z.string().optional(),
        nf: z.string().optional(),
        numeroCertificado: z.string().optional(),
        corrida: z.string().optional(),
        origem: z.string().trim().min(3, "Descreva onde o material foi encontrado e a possível origem."),
      }))
      .mutation(async ({ input, ctx }) => {
        const usuario = ctx.user?.name || ctx.user?.email || "Sistema";
        return await db.criarMaterialPendenteInventario(input, usuario);
      }),

    listarMateriaisForaCadastro: permissaoProcedure("inventario:ver")
      .input(z.object({
        inventarioId: z.number().optional(),
        status: z.enum(["pendente", "aprovado", "reprovado"]).optional(),
      }).optional())
      .query(async ({ input }) => {
        return await db.listarMateriaisPendentesInventario(input ?? {});
      }),

    cancelarMaterialForaCadastro: permissaoProcedure("inventario:contar")
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input, ctx }) => {
        const usuario = ctx.user?.name || ctx.user?.email || "Sistema";
        return await db.cancelarMaterialPendenteInventario(input.id, usuario);
      }),

    aprovarMaterialForaCadastro: permissaoProcedure("inventario:processar")
      .input(z.object({ id: z.number(), parecer: z.string().optional() }))
      .mutation(async ({ input, ctx }) => {
        const usuario = ctx.user?.name || ctx.user?.email || "Sistema";
        return await db.aprovarMaterialPendenteInventario(input.id, input.parecer, usuario);
      }),

    reprovarMaterialForaCadastro: permissaoProcedure("inventario:processar")
      .input(z.object({ id: z.number(), parecer: z.string().trim().min(3, "Informe o motivo da reprovação.") }))
      .mutation(async ({ input, ctx }) => {
        const usuario = ctx.user?.name || ctx.user?.email || "Sistema";
        return await db.reprovarMaterialPendenteInventario(input.id, input.parecer, usuario);
      }),
  }),

  // ============================================================================
  // USUÁRIOS
  // ============================================================================
  usuarios: router({
    listar: permissaoProcedure("usuarios:ver").query(async () => {
      return await db.listUsers();
    }),

    criar: permissaoProcedure("usuarios:criar")
      .input(z.object({
        name: z.string().min(1),
        email: z.string().email(),
        password: z.string().min(6).optional(),
        senha: z.string().min(6).optional(),
        role: z.enum(["owner", "admin", "supervisor", "operator", "viewer"]),
        cargo: z.string().optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        const password = input.password || input.senha;
        if (!password) throw new Error("Senha é obrigatória");
        return await db.createUser({ name: input.name, email: input.email, password, role: input.role, cargo: input.cargo }, ctx.user?.name ?? "Sistema");
      }),

    atualizar: permissaoProcedure("usuarios:editar")
      .input(z.object({
        id: z.number(),
        name: z.string().min(1).optional(),
        email: z.string().email().optional(),
        role: z.enum(["owner", "admin", "supervisor", "operator", "viewer"]).optional(),
        ativo: z.boolean().optional(),
        novaSenha: z.string().min(6).optional(),
        cargo: z.string().optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        const { id, ...data } = input;
        return await db.updateUser(id, data, ctx.user?.name ?? "Sistema");
      }),

    // alias "editar" → atualizar (usado pela página Usuarios.tsx)
    editar: permissaoProcedure("usuarios:editar")
      .input(z.object({
        id: z.number(),
        name: z.string().min(1).optional(),
        email: z.string().email().optional(),
        role: z.enum(["owner", "admin", "supervisor", "operator", "viewer"]).optional(),
        ativo: z.boolean().optional(),
        novaSenha: z.string().min(6).optional(),
        cargo: z.string().optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        const { id, ...data } = input;
        return await db.updateUser(id, data, ctx.user?.name ?? "Sistema");
      }),

    // O seed padrão (initializeDefaultPermissions, server/_core/auth.ts) já
    // deliberadamente não concede "usuarios:remover" para admin — mas até
    // aqui isso não tinha efeito nenhum porque adminProcedure não consultava
    // a chave. permissaoEstritaProcedure faz admin depender de fato da
    // permissão granular (só owner tem bypass automático), então agora a
    // omissão no seed passa a significar o que sempre pareceu significar:
    // admin não exclui/desativa usuário a menos que ganhe essa permissão.
    deletar: permissaoEstritaProcedure("usuarios:remover")
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input, ctx }) => {
        return await db.deleteUser(input.id, ctx.user?.name ?? "Sistema");
      }),

    desativar: permissaoEstritaProcedure("usuarios:remover")
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input }) => {
        return await db.deactivateUser(input.id);
      }),

    ativar: permissaoProcedure("usuarios:editar")
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input }) => {
        return await db.activateUser(input.id);
      }),

    // Permissões granulares por usuário (armazenadas em JSON no campo permissions ou retornam vazio)
    getPermissoes: permissaoProcedure("usuarios:permissoes")
      .input(z.object({ usuarioId: z.number() }))
      .query(async ({ input }) => {
        // getUserPermissions (auth.ts) = role_permissoes + usuario_permissoes
        // Garante que o modal mostra as permissões efetivas do usuário
        return await getUserPermissions(input.usuarioId);
      }),

    definirPermissoes: permissaoProcedure("usuarios:permissoes")
      .input(z.object({
        usuarioId: z.number(),
        permissoes: z.array(z.string()),
      }))
      .mutation(async ({ input }) => {
        await db.setUserPermissoes(input.usuarioId, input.permissoes);
        return { success: true };
      }),
  }),

  // ============================================================================
  // PERMISSÕES — catálogo e matriz por role (painel de configurações, owner)
  // ============================================================================
  permissoes: router({
    // As 33 chaves do catálogo + se o backend já checa cada uma de verdade.
    listarCatalogo: ownerProcedure.query(async () => {
      const catalogo = await db.getCatalogoPermissoes();
      return catalogo.map((p) => ({
        ...p,
        aplicadaBackend: !CHAVES_SEM_COBERTURA_BACKEND.has(p.chave),
        estrita: CHAVES_ESTRITAS.has(p.chave),
      }));
    }),

    // Estado atual de role_permissoes, agrupado por role.
    listarMatrizRoles: ownerProcedure.query(async () => {
      return await db.getMatrizRolePermissoes();
    }),

    // Liga/desliga uma chave para um role inteiro. Efeito imediato — sem
    // logout/login — porque getUserPermissions() não tem cache entre requisições.
    definirRolePermissao: ownerProcedure
      .input(z.object({
        role: z.enum(["owner", "admin", "supervisor", "operator", "viewer"]),
        chave: z.string(),
        habilitado: z.boolean(),
      }))
      .mutation(async ({ input, ctx }) => {
        return await db.definirRolePermissao(input.role, input.chave, input.habilitado, ctx.user?.name ?? "Sistema");
      }),
  }),

  // ============================================================================
  // AI — chat com assistente
  // ============================================================================
  ai: router({
    chat: protectedProcedure
      .input(z.object({
        message: z.string(),
        context: z.string().optional(),
      }))
      .mutation(async ({ input }) => {
        // Retorna resposta padrão se não houver integração de IA configurada
        return {
          response: `Assistente: Recebi sua mensagem — "${input.message}". A integração com IA não está configurada neste ambiente.`,
        };
      }),
  }),

  // ============================================================================
  // GRD — alias das rotas usadas pelo client
  // ============================================================================
  grd: router({
    gerar: permissaoProcedure("grds:gerar")
      .input(z.object({
        numero: z.string(),
        data: z.string().optional(),   // ISO string vinda do client
        cliente: z.string(),
        obra: z.string(),
        materiais: z.array(z.object({
          id: z.number().optional(), // presente quando o material já existe salvo — usado pra marcar "GRD gerada"
          certificado: z.string(),
          tipo: z.string(),
          bitola: z.string(),
          comprimento: z.number(),
          largura: z.string().optional(),
          quantidade: z.number(),
          unidade: z.string(),
          aco: z.string(),
          nf: z.string(),
        })),
        certificados: z.array(z.object({
          nomeArquivo: z.string(),
          tipoArquivo: z.string(),
          conteudoBase64: z.string(),
        })).default([]),
      }))
      .mutation(async ({ input, ctx }) => {
        // Salva primeiro — é aqui que o número de verdade é atribuído, de
        // forma atômica (ver comentário em salvarGrdGerada). Só depois disso
        // os arquivos são gerados, usando o número REAL, nunca o sugerido
        // que veio do formulário (que pode estar desatualizado ou colidir
        // com outra GRD criada nesse meio tempo).
        const salvo = await db.salvarGrdGerada(
          { numero: input.numero, obra: input.obra, cliente: input.cliente, dataGrd: input.data, materiais: input.materiais },
          input.certificados,
          ctx.user?.name ?? "Sistema"
        );
        if (!salvo?.numero) throw new Error("Falha ao salvar a GRD.");

        const result = await gerarGrd({
          numero: salvo.numero,
          data: input.data ? dataSomenteDiaParaTimestamp(input.data) : new Date(),
          cliente: input.cliente,
          obra: input.obra,
          materiais: input.materiais,
        });

        const buffer = result.buffer;
        return {
          base64: buffer.toString("base64"),
          fileName: result.fileName,
          totalItens: input.materiais.length,
          grdId: salvo?.id,
          numero: salvo.numero,
        };
      }),

    proximoNumero: permissaoProcedure("grds:gerar").query(async () => {
      return await db.obterProximoNumeroGrdDb();
    }),

    listar: permissaoProcedure("grds:ver").query(async () => {
      return await db.listGrdsGeradas();
    }),

    obter: permissaoProcedure("grds:ver")
      .input(z.object({ id: z.number() }))
      .query(async ({ input }) => {
        return await db.getGrdGeradaById(input.id);
      }),

    // Regera o .xlsm a partir dos dados salvos + monta um ZIP com os
    // certificados anexados originalmente. Tudo em base64, mesmo padrão já
    // usado nos outros downloads do sistema.
    baixarZip: permissaoProcedure("grds:ver")
      .input(z.object({ id: z.number() }))
      .query(async ({ input }) => {
        const grd = await db.getGrdGeradaById(input.id);
        if (!grd) throw new Error("GRD não encontrada.");

        const grdInput = {
          numero: grd.numero,
          data: grd.dataGrd ? dataSomenteDiaParaTimestamp(grd.dataGrd) : grd.createdAt,
          cliente: grd.cliente || "",
          obra: grd.obra,
          materiais: grd.dados.materiais,
        };

        const result = await gerarGrd(grdInput);

        const JSZip = (await import("jszip")).default;
        const zip = new JSZip();
        zip.file(result.fileName, result.buffer);

        const certificadosParaPdf = [];
        for (const certMeta of grd.certificados) {
          const cert = await db.getCertificadoConteudo(certMeta.id);
          if (cert) {
            const conteudo = cert.conteudo as Buffer;
            zip.file(cert.nomeArquivo, conteudo);
            certificadosParaPdf.push({
              nomeArquivo: cert.nomeArquivo,
              tipoArquivo: cert.tipoArquivo || "application/pdf",
              conteudo,
            });
          }
        }

        // O PDF é a impressão fiel da aba GRD do template, seguida pelos
        // certificados anexados, na mesma ordem do arquivo de referência.
        const pdf = await gerarGrdPdf(grdInput, certificadosParaPdf);
        zip.file(pdf.fileName, pdf.buffer);

        const zipBuffer = await zip.generateAsync({ type: "nodebuffer" });
        return {
          base64: zipBuffer.toString("base64"),
          fileName: `GRD-${grd.numero}_${grd.obra.replace(/[^a-zA-Z0-9]+/g, "-")}.zip`,
        };
      }),

    // Exclusão é exclusiva do owner — não é uma permissão granular
    // atribuível pelo painel (mesmo padrão de Limpeza de Dados).
    deletar: ownerProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input, ctx }) => {
        return await db.deletarGrd(input.id, ctx.user?.name ?? "Sistema");
      }),

    // Correção manual do número — mesma permissão de gerar GRD.
    editarNumero: permissaoProcedure("grds:gerar")
      .input(z.object({ id: z.number(), numero: z.string().min(1) }))
      .mutation(async ({ input, ctx }) => {
        return await db.editarNumeroGrd(input.id, input.numero, ctx.user?.name ?? "Sistema");
      }),
  }),

  pedidosCompra: router({
    // Fase 1: recebe o PDF em base64, devolve os dados extraídos pra
    // revisão do usuário — ainda NÃO salva nada no banco nessa etapa.
    extrairPdf: permissaoProcedure("materiais:importar")
      .input(z.object({ pdfBase64: z.string() }))
      .mutation(async ({ input }) => {
        return await extrairPedidoCompraDoPdf(input.pdfBase64);
      }),

    criar: permissaoProcedure("materiais:importar")
      .input(z.object({
        numeroPedido: z.string(),
        processoNumero: z.string().optional(),
        obraNome: z.string().optional(),
        fornecedorNome: z.string().optional(),
        fornecedorCnpj: z.string().optional(),
        dataEmissao: z.string().optional(),
        dataEntregaPrevista: z.string().optional(),
        condPagamento: z.string().optional(),
        cotacao: z.string().optional(),
        valorTotalPedido: z.number().optional(),
        forcar: z.boolean().optional(),
        // Item da fila de revisão que está sendo confirmado agora — não conta
        // como duplicidade dele mesmo.
        ignorarFilaId: z.number().optional(),
        itens: z.array(z.object({
          codigo: z.string().optional(),
          descricaoOriginal: z.string().optional(),
          categoria: z.string().optional(),
          tipo: z.string().optional(),
          bitola: z.string().optional(),
          aco: z.string().optional(),
          comprimento: z.number().optional(),
          quantidadePecas: z.number().optional(),
          unidade: z.string().optional(),
          pesoTotal: z.number().optional(),
          valorUnitario: z.number().optional(),
          valorTotalItem: z.number().optional(),
        })),
      }))
      .mutation(async ({ input, ctx }) => {
        const { forcar, ignorarFilaId, ...dados } = input;
        return await db.criarPedidoCompra(dados, ctx.user?.name ?? "Sistema", forcar ?? false, ignorarFilaId);
      }),

    verificarDuplicado: permissaoProcedure("materiais:importar")
      .input(z.object({ numeroPedido: z.string(), ignorarFilaId: z.number().optional() }))
      .query(async ({ input }) => {
        return await db.buscarPedidoDuplicado(input.numeroPedido, input.ignorarFilaId);
      }),

    listar: permissaoProcedure("materiais_a_chegar:ver").query(async () => {
      return await db.listPedidosCompra();
    }),

    cancelar: permissaoProcedure("materiais:importar")
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input, ctx }) => {
        return await db.cancelarPedidoCompra(input.id, ctx.user?.name ?? "Sistema");
      }),

    // Correção de pedido já cadastrado — inclusive desfazer recebimento
    // marcado por engano. Só administrador (e owner).
    editar: adminProcedure
      .input(z.object({
        id: z.number(),
        numeroPedido: z.string().optional(),
        fornecedorNome: z.string().optional(),
        obraNome: z.string().optional(),
        dataEntregaPrevista: z.string().optional(),
        itens: z.array(z.object({
          id: z.number(),
          tipo: z.string().optional(),
          bitola: z.string().optional(),
          aco: z.string().optional(),
          comprimento: z.number().nullable().optional(),
          quantidadePecas: z.number().nullable().optional(),
          pesoTotal: z.number().nullable().optional(),
          valorUnitario: z.number().nullable().optional(),
          quantidadeRecebida: z.number().min(0).optional(),
          reabrir: z.boolean().optional(),
        })).optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        const { id, ...dados } = input;
        return await db.editarPedidoCompra(id, dados, ctx.user?.name ?? "Sistema");
      }),

    reabrir: adminProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input, ctx }) => {
        return await db.reabrirPedidoCompra(input.id, ctx.user?.name ?? "Sistema");
      }),

    encerrarItem: permissaoProcedure("materiais:importar")
      .input(z.object({ itemId: z.number(), justificativa: z.string().optional() }))
      .mutation(async ({ input, ctx }) => {
        return await db.encerrarItemPedidoCompra(input.itemId, input.justificativa, ctx.user?.name ?? "Sistema");
      }),

    // Confirmação manual de recebimento — quando o cruzamento automático por
    // número de pedido + tipo/bitola/aço não encontrou (ou nunca vai
    // encontrar) o material correspondente.
    confirmarRecebimento: permissaoProcedure("materiais:importar")
      .input(z.object({ itemId: z.number(), quantidade: z.number().positive() }))
      .mutation(async ({ input, ctx }) => {
        return await db.confirmarRecebimentoManual(input.itemId, input.quantidade, ctx.user?.name ?? "Sistema");
      }),

    // ── Fornecedores selecionados pra leitura automática (Fase 2) ──────────
    listarFornecedoresEmail: permissaoProcedure("materiais:importar").query(async () => {
      return await db.listFornecedoresPedidosEmail();
    }),
    criarFornecedorEmail: permissaoProcedure("materiais:importar")
      .input(z.object({ nome: z.string(), emails: z.string() }))
      .mutation(async ({ input, ctx }) => {
        return await db.criarFornecedorPedidoEmail(input.nome, input.emails, ctx.user?.name ?? "Sistema");
      }),
    atualizarFornecedorEmail: permissaoProcedure("materiais:importar")
      .input(z.object({ id: z.number(), nome: z.string().optional(), emails: z.string().optional(), ativo: z.boolean().optional() }))
      .mutation(async ({ input }) => {
        const { id, ...dados } = input;
        return await db.atualizarFornecedorPedidoEmail(id, dados);
      }),
    excluirFornecedorEmail: permissaoProcedure("materiais:importar")
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input }) => {
        return await db.excluirFornecedorPedidoEmail(input.id);
      }),

    // ── Fila de revisão (pedidos detectados automaticamente por e-mail) ────
    listarFilaRevisao: permissaoProcedure("materiais:importar").query(async () => {
      return await db.listFilaRevisaoPedidos();
    }),
    rejeitarFilaRevisao: permissaoProcedure("materiais:importar")
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input, ctx }) => {
        return await db.rejeitarFilaRevisaoPedido(input.id, ctx.user?.name ?? "Sistema");
      }),
    confirmarFilaRevisao: permissaoProcedure("materiais:importar")
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input }) => {
        return await db.confirmarFilaRevisaoPedido(input.id);
      }),

    verificarEmailAgora: permissaoProcedure("materiais:importar").mutation(async () => {
      return await db.executarVarreduraEmailPedidos();
    }),
  }),


  // ============================================================================
  // LIMPEZA — exclusivo para owner
  // ============================================================================
  backup: router({
    executarAgora: ownerProcedure.mutation(async () => {
      return await executarBackupCompleto();
    }),
  }),

  limpeza: router({

    preview: ownerProcedure
      .input(z.object({
        filtros: z.array(z.object({
          tabela: z.enum(["solicitacoes", "registros_saida", "registros_entrada", "movimentacoes", "historico_atividades", "materiais"]),
          de:     z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
          ate:    z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        })),
      }))
      .query(async ({ input }) => {
        return await db.previewLimpeza(input.filtros as any);
      }),

    executar: ownerProcedure
      .input(z.object({
        filtros: z.array(z.object({
          tabela: z.enum(["solicitacoes", "registros_saida", "registros_entrada", "movimentacoes", "historico_atividades", "materiais"]),
          de:     z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
          ate:    z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        })),
        confirmacao: z.literal("CONFIRMAR"),
      }))
      .mutation(async ({ input, ctx }) => {
        const ownerNome = ctx.user?.name ?? "Owner";
        return await db.executarLimpeza(input.filtros as any, ownerNome);
      }),

  }),
});

export type AppRouter = typeof appRouter;
