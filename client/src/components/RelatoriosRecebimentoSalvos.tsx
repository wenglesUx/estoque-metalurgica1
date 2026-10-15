import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { RelatorioRecebimentoForm, type FotoExistenteRelatorio } from "@/components/RelatorioRecebimentoForm";
import { trpc } from "@/lib/trpc";
import {
  type DadosRelatorio, type FotoRelatorio,
  comprimirImagemRecebimento, descricaoItem, dimensoesItem, formatKg, gerarPdfRecebimento,
  normalizarDadosRelatorio, numeroDocumentoRelatorio, validarDadosRelatorio,
} from "@/lib/relatorioRecebimento";
import { AlertTriangle, ChevronDown, Download, Edit2, FileDown, Image as ImageIcon, Trash2 } from "lucide-react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { useState } from "react";
import { toast } from "sonner";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  // Editar e excluir são exclusivos de administrador (o servidor também barra).
  podeAdministrar: boolean;
  locais?: { id: number; nome: string }[];
}

interface Edicao {
  id: number;
  dados: DadosRelatorio;
  fotosExistentes: FotoExistenteRelatorio[];
  fotosRemovidas: number[];
  fotosNovas: Record<string, File[]>;
}

/**
 * Modal "Relatórios de Recebimento Salvos": lista os relatórios, mostra os
 * materiais de cada um, baixa o PDF de novo e — pra administrador — permite
 * editar ou excluir o relatório.
 */
export function RelatoriosRecebimentoSalvos({ open, onOpenChange, podeAdministrar, locais }: Props) {
  const utils = trpc.useUtils();
  const { data: relatorios, isLoading } = trpc.relatoriosRecebimento.listar.useQuery(undefined, { enabled: open });
  const atualizarMutation = trpc.relatoriosRecebimento.atualizar.useMutation();
  const excluirMutation = trpc.relatoriosRecebimento.excluir.useMutation();
  const uploadImagemMutation = trpc.relatoriosRecebimento.uploadImagem.useMutation();
  const deletarImagemMutation = trpc.relatoriosRecebimento.deletarImagem.useMutation();

  const [expandidos, setExpandidos] = useState<Set<number>>(new Set());
  const [baixandoId, setBaixandoId] = useState<number | null>(null);
  const [confirmandoExclusaoId, setConfirmandoExclusaoId] = useState<number | null>(null);
  const [abrindoEdicaoId, setAbrindoEdicaoId] = useState<number | null>(null);
  const [edicao, setEdicao] = useState<Edicao | null>(null);
  const [salvando, setSalvando] = useState(false);

  const alternarExpandido = (id: number) =>
    setExpandidos(prev => { const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s; });

  // Busca o relatório completo + as fotos, já sabendo a qual carga cada foto pertence.
  const carregarRelatorio = async (id: number) => {
    const relatorio = await utils.client.relatoriosRecebimento.obter.query({ id });
    if (!relatorio) return null;
    const dados = normalizarDadosRelatorio(relatorio.dados);
    const cargaDaFoto = new Map<number, string>();
    dados.cargas.forEach(carga => carga.fotoIds.forEach(fotoId => cargaDaFoto.set(fotoId, carga.id)));
    const imagens = await utils.client.relatoriosRecebimento.listarImagens.query({ relatorioId: id });
    // Mais antigas primeiro, pra ordem das fotos no PDF seguir a ordem em que foram anexadas.
    const ordenadas = [...(imagens || [])].sort((a: any, b: any) => a.id - b.id);
    const fotos = (await Promise.all(ordenadas.map(async (img: any) => {
      const completa = await utils.client.relatoriosRecebimento.obterImagem.query({ id: img.id });
      if (!completa) return null;
      return { id: img.id as number, base64: completa.conteudoBase64, tipo: completa.tipoArquivo || "image/jpeg", cargaId: cargaDaFoto.get(img.id) ?? null };
    }))).filter(Boolean) as (FotoRelatorio & { id: number })[];
    return { dados, fotos, criadoEm: new Date(relatorio.createdAt) };
  };

  const baixar = async (id: number) => {
    setBaixandoId(id);
    try {
      const relatorio = await carregarRelatorio(id);
      if (!relatorio) { toast.error("Relatório não encontrado."); return; }
      const nomeArquivo = await gerarPdfRecebimento(relatorio.dados, numeroDocumentoRelatorio(id), relatorio.fotos, relatorio.criadoEm);
      toast.success(`PDF gerado: ${nomeArquivo}`);
    } catch {
      toast.error("Erro ao gerar o PDF do relatório.");
    } finally {
      setBaixandoId(null);
    }
  };

  const abrirEdicao = async (id: number) => {
    setAbrindoEdicaoId(id);
    try {
      const relatorio = await carregarRelatorio(id);
      if (!relatorio) { toast.error("Relatório não encontrado."); return; }
      setEdicao({
        id,
        dados: relatorio.dados,
        fotosExistentes: relatorio.fotos.map(f => ({ id: f.id, cargaId: f.cargaId, url: `data:${f.tipo};base64,${f.base64}` })),
        fotosRemovidas: [],
        fotosNovas: {},
      });
    } catch {
      toast.error("Erro ao abrir o relatório para edição.");
    } finally {
      setAbrindoEdicaoId(null);
    }
  };

  const salvarEdicao = async () => {
    if (!edicao) return;
    const erro = validarDadosRelatorio(edicao.dados);
    if (erro) { toast.error(erro); return; }
    setSalvando(true);
    try {
      for (const fotoId of edicao.fotosRemovidas) {
        await deletarImagemMutation.mutateAsync({ id: fotoId });
      }
      const removidas = new Set(edicao.fotosRemovidas);
      // Foto antiga que estava "solta" (sem carga) passa a pertencer à carga em que ela aparece na tela.
      const idsCargas = new Set(edicao.dados.cargas.map(c => c.id));
      const dados: DadosRelatorio = {
        ...edicao.dados,
        cargas: edicao.dados.cargas.map((carga, indice) => ({
          ...carga,
          fotoIds: edicao.fotosExistentes
            .filter(f => !removidas.has(f.id))
            .filter(f => (f.cargaId && idsCargas.has(f.cargaId) ? f.cargaId === carga.id : indice === 0))
            .map(f => f.id),
        })),
      };
      await atualizarMutation.mutateAsync({ id: edicao.id, dados });
      for (const carga of dados.cargas) {
        for (const arquivo of edicao.fotosNovas[carga.id] || []) {
          const comprimida = await comprimirImagemRecebimento(arquivo);
          await uploadImagemMutation.mutateAsync({
            relatorioId: edicao.id,
            nomeArquivo: arquivo.name,
            tipoArquivo: comprimida.tipo,
            conteudoBase64: comprimida.base64,
            cargaId: carga.id,
          });
        }
      }
      await utils.relatoriosRecebimento.listar.invalidate();
      toast.success(`${numeroDocumentoRelatorio(edicao.id)} atualizado.`);
      setEdicao(null);
    } catch (e: any) {
      toast.error(e?.message || "Erro ao salvar as alterações do relatório.");
    } finally {
      setSalvando(false);
    }
  };

  const excluir = async (id: number) => {
    try {
      await excluirMutation.mutateAsync({ id });
      await utils.relatoriosRecebimento.listar.invalidate();
      toast.success(`${numeroDocumentoRelatorio(id)} excluído.`);
    } catch (e: any) {
      toast.error(e?.message || "Erro ao excluir o relatório.");
    } finally {
      setConfirmandoExclusaoId(null);
    }
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="w-[96vw] max-w-3xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><FileDown className="w-5 h-5 text-emerald-600" /> Relatórios de Recebimento Salvos</DialogTitle>
            <DialogDescription>
              Todo relatório gerado fica salvo aqui. Abra a seta pra ver os materiais de cada um
              {podeAdministrar ? " — como administrador, você também pode editar ou excluir." : "."}
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-[62vh] overflow-y-auto divide-y divide-border border rounded-lg">
            {isLoading ? (
              <div className="p-6 text-center text-sm text-muted-foreground">Carregando...</div>
            ) : !relatorios || relatorios.length === 0 ? (
              <div className="p-6 text-center text-sm text-muted-foreground">Nenhum relatório salvo ainda.</div>
            ) : (
              relatorios.map((r: any) => {
                const aberto = expandidos.has(r.id);
                return (
                  <div key={r.id}>
                    <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 px-4 py-3">
                      <button type="button" onClick={() => alternarExpandido(r.id)} className="flex min-w-0 flex-1 items-start gap-2 text-left" title="Ver os materiais deste relatório">
                        <ChevronDown className={`mt-0.5 h-4 w-4 shrink-0 text-muted-foreground transition-transform ${aberto ? "rotate-180" : ""}`} />
                        <span className="min-w-0">
                          <span className="block truncate font-medium text-sm">{numeroDocumentoRelatorio(r.id)} — {r.fornecedor || "Sem fornecedor"}</span>
                          <span className="block text-xs text-muted-foreground">
                            NF: {r.nf || "-"} · {r.totalCargas > 1 ? `${r.totalCargas} cargas · ` : ""}{r.totalItens} {r.totalItens === 1 ? "item" : "itens"} · {format(new Date(r.createdAt), "dd/MM/yyyy HH:mm", { locale: ptBR })} · por {r.usuarioNome || "Sistema"}
                          </span>
                          <span className={`mt-0.5 flex items-center gap-1 text-xs ${r.totalFotos === 0 ? "font-semibold text-amber-700" : "text-muted-foreground"}`}>
                            <ImageIcon className="h-3 w-3" /> {r.totalFotos === 0 ? "Sem fotos anexadas" : `${r.totalFotos} ${r.totalFotos === 1 ? "foto" : "fotos"}`}
                          </span>
                        </span>
                      </button>
                      <div className="flex shrink-0 items-center gap-1.5">
                        <Button size="sm" variant="outline" disabled={baixandoId === r.id} onClick={() => baixar(r.id)} className="gap-1.5">
                          <Download className="w-3.5 h-3.5" /> {baixandoId === r.id ? "Gerando..." : "Baixar"}
                        </Button>
                        {podeAdministrar && (
                          <>
                            <Button size="sm" variant="outline" disabled={abrindoEdicaoId === r.id} onClick={() => abrirEdicao(r.id)} className="gap-1.5">
                              <Edit2 className="w-3.5 h-3.5" /> {abrindoEdicaoId === r.id ? "Abrindo..." : "Editar"}
                            </Button>
                            <Button size="sm" variant="outline" onClick={() => setConfirmandoExclusaoId(r.id)} className="gap-1.5 border-red-200 text-red-700 hover:bg-red-50" title="Excluir relatório">
                              <Trash2 className="w-3.5 h-3.5" />
                            </Button>
                          </>
                        )}
                      </div>
                    </div>

                    {confirmandoExclusaoId === r.id && (
                      <div className="mx-4 mb-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">
                        <span className="flex items-center gap-1.5"><AlertTriangle className="h-4 w-4 shrink-0" /> Excluir {numeroDocumentoRelatorio(r.id)} e as fotos dele? Não dá pra desfazer. Os materiais continuam no estoque.</span>
                        <span className="flex gap-2">
                          <Button size="sm" variant="ghost" onClick={() => setConfirmandoExclusaoId(null)}>Cancelar</Button>
                          <Button size="sm" disabled={excluirMutation.isPending} onClick={() => excluir(r.id)} className="bg-red-600 text-white hover:bg-red-700">
                            {excluirMutation.isPending ? "Excluindo..." : "Excluir"}
                          </Button>
                        </span>
                      </div>
                    )}

                    {aberto && (
                      <div className="space-y-2 bg-muted/20 px-4 pb-3 pt-1">
                        {r.cargas.map((carga: any, indice: number) => (
                          <div key={indice} className="overflow-hidden rounded-md border bg-background">
                            {r.cargas.length > 1 && (
                              <div className="flex items-center gap-2 bg-[#1a2332] px-3 py-1.5 text-xs text-white">
                                <span className="font-bold text-[#d6a21b]">CARGA {String(indice + 1).padStart(2, "0")}</span>
                                <span className="min-w-0 flex-1 truncate">{carga.fornecedor || "Sem fornecedor"}</span>
                                <span className="shrink-0">NF {carga.nf || "-"}</span>
                              </div>
                            )}
                            {carga.itens.length === 0 ? (
                              <div className="px-3 py-2 text-xs text-muted-foreground">Nenhum material registrado.</div>
                            ) : (
                              <table className="w-full text-xs">
                                <thead>
                                  <tr className="border-b text-left text-[10px] uppercase tracking-wide text-muted-foreground">
                                    <th className="px-3 py-1.5">Material</th><th className="px-2 py-1.5">Aço</th><th className="px-2 py-1.5 text-center">Qtd</th>
                                    <th className="hidden px-2 py-1.5 text-center sm:table-cell">Dimensões (mm)</th><th className="px-2 py-1.5 text-right">Peso (kg)</th>
                                    <th className="hidden px-3 py-1.5 sm:table-cell">Obra</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {carga.itens.map((item: any, posicao: number) => (
                                    <tr key={posicao} className="border-b last:border-0">
                                      <td className="px-3 py-1.5 font-medium">{descricaoItem(item)}</td>
                                      <td className="px-2 py-1.5">{item.aco || "-"}</td>
                                      <td className="px-2 py-1.5 text-center">{item.quantidade || 0}</td>
                                      <td className="hidden px-2 py-1.5 text-center sm:table-cell">{dimensoesItem(item)}</td>
                                      <td className="px-2 py-1.5 text-right">{formatKg(parseFloat(String(item.pesoTotal || 0)) || 0)}</td>
                                      <td className="hidden px-3 py-1.5 sm:table-cell">{item.obraNome || "LIVRE"}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => onOpenChange(false)}>Fechar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ─── Edição de um relatório salvo (administrador) ─────────────────────── */}
      <Dialog open={!!edicao} onOpenChange={(v) => { if (!v && !salvando) setEdicao(null); }}>
        <DialogContent className="w-[94vw] max-w-4xl max-h-[92vh] overflow-y-auto p-0">
          <div className="h-1.5 bg-[#d6a21b]" />
          <DialogHeader className="px-6 pt-5 pb-4 border-b bg-[#f8f6f1]/70">
            <DialogTitle className="flex items-center gap-3 text-[#1a2332]">
              <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#1a2332] text-[#d6a21b]"><Edit2 className="h-5 w-5" /></span>
              <span>
                <span className="block text-lg">Editar {edicao ? numeroDocumentoRelatorio(edicao.id) : "relatório"}</span>
                <span className="mt-1 block text-xs font-normal text-muted-foreground">Corrija referências, observações, materiais e fotos. O número do relatório continua o mesmo; o PDF passa a sair com os dados corrigidos.</span>
              </span>
            </DialogTitle>
            <DialogDescription className="sr-only">Edição de um relatório de recebimento salvo.</DialogDescription>
          </DialogHeader>
          {edicao && (
            <div className="p-6">
              <RelatorioRecebimentoForm
                dados={edicao.dados}
                onChange={(dados) => setEdicao(prev => (prev ? { ...prev, dados } : prev))}
                locais={locais}
                fotosNovas={edicao.fotosNovas}
                onFotosNovasChange={(fotosNovas) => setEdicao(prev => (prev ? { ...prev, fotosNovas } : prev))}
                fotosExistentes={edicao.fotosExistentes.filter(f => !edicao.fotosRemovidas.includes(f.id))}
                onRemoverFotoExistente={(fotoId) => setEdicao(prev => (prev ? { ...prev, fotosRemovidas: [...prev.fotosRemovidas, fotoId] } : prev))}
                permitirRemoverItens
              />
            </div>
          )}
          <DialogFooter className="border-t bg-muted/20 px-6 py-4">
            <Button variant="outline" disabled={salvando} onClick={() => setEdicao(null)}>Cancelar</Button>
            <Button onClick={salvarEdicao} disabled={salvando} className="gap-2 bg-[#1a2332] text-white hover:bg-[#253249]">
              {salvando ? "Salvando..." : "Salvar alterações"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
