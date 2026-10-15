import { Input } from "@/components/ui/input";
import { AlertCircle, ChevronDown, Image as ImageIcon, Plus, Trash2, X } from "lucide-react";
import { useEffect, useMemo } from "react";
import {
  type CargaRelatorio, type Conferencia, type DadosRelatorio,
  descricaoItem, dimensoesItem, formatKg, parsePtBrNumber, pesoDosItens,
} from "@/lib/relatorioRecebimento";

export interface FotoExistenteRelatorio {
  id: number;
  cargaId: string | null;
  url: string;
}

interface Props {
  dados: DadosRelatorio;
  onChange: (dados: DadosRelatorio) => void;
  locais?: { id: number; nome: string }[];
  // Fotos escolhidas agora, ainda não enviadas — separadas por carga.
  fotosNovas: Record<string, File[]>;
  onFotosNovasChange: (fotos: Record<string, File[]>) => void;
  // Só na edição: fotos que já estavam salvas no relatório.
  fotosExistentes?: FotoExistenteRelatorio[];
  onRemoverFotoExistente?: (id: number) => void;
  // Só na edição: permite tirar um material do relatório.
  permitirRemoverItens?: boolean;
}

const classeSelect = "flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none transition-colors focus:border-[#d6a21b] focus:ring-2 focus:ring-[#d6a21b]/20";
const classeRotulo = "text-xs font-semibold text-muted-foreground";

function MiniaturaNova({ file, onRemover }: { file: File; onRemover: () => void }) {
  const url = useMemo(() => URL.createObjectURL(file), [file]);
  useEffect(() => () => URL.revokeObjectURL(url), [url]);
  return <Miniatura url={url} titulo={file.name} onRemover={onRemover} nova />;
}

function Miniatura({ url, titulo, onRemover, nova }: { url: string; titulo: string; onRemover?: () => void; nova?: boolean }) {
  return (
    <div className="relative group aspect-square rounded-md overflow-hidden border bg-muted/30">
      <img src={url} alt={titulo} className="w-full h-full object-cover" />
      {nova && <span className="absolute bottom-1 left-1 rounded bg-[#d6a21b] px-1 text-[9px] font-bold uppercase text-[#1a2332]">nova</span>}
      {onRemover && (
        <button
          type="button"
          onClick={onRemover}
          className="absolute top-1 right-1 bg-black/60 hover:bg-destructive text-white rounded-full p-0.5 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity"
          title="Remover foto"
        >
          <X className="w-3 h-3" />
        </button>
      )}
    </div>
  );
}

/**
 * Formulário do Relatório de Recebimento — um cartão por carga (NF/fornecedor),
 * cada um com as próprias referências, materiais, observações e fotos. Usado
 * tanto na criação quanto na edição de um relatório salvo.
 */
export function RelatorioRecebimentoForm({
  dados, onChange, locais, fotosNovas, onFotosNovasChange,
  fotosExistentes = [], onRemoverFotoExistente, permitirRemoverItens = false,
}: Props) {
  const atualizarCarga = (id: string, mudanca: Partial<CargaRelatorio>) =>
    onChange({ ...dados, cargas: dados.cargas.map(c => (c.id === id ? { ...c, ...mudanca } : c)) });

  const idsCargas = new Set(dados.cargas.map(c => c.id));
  // Foto antiga sem carga definida aparece na primeira carga (mesma regra do PDF).
  const fotosExistentesDaCarga = (carga: CargaRelatorio, indice: number) =>
    fotosExistentes.filter(f => (f.cargaId && idsCargas.has(f.cargaId) ? f.cargaId === carga.id : indice === 0));

  return (
    <div className="space-y-5">
      {dados.cargas.length > 1 && (
        <div className="rounded-lg border border-[#ecd79a] bg-[#fff8e2] px-4 py-3 text-xs text-[#1a2332]">
          Os materiais foram separados em <strong>{dados.cargas.length} cargas</strong> (uma por nota fiscal/fornecedor).
          Preencha as referências, observações e fotos de cada uma — no PDF cada carga sai no próprio bloco.
        </div>
      )}

      {dados.cargas.map((carga, indice) => {
        const pesoItens = pesoDosItens(carga.itens);
        const pesoNota = parsePtBrNumber(carga.pesoNota);
        const existentes = fotosExistentesDaCarga(carga, indice);
        const novas = fotosNovas[carga.id] || [];
        const localForaDaLista = carga.localDescarga && !locais?.some(l => l.nome === carga.localDescarga);
        return (
          <section key={carga.id} className="overflow-hidden rounded-xl border border-border/80 bg-card shadow-sm">
            <div className="flex items-center gap-3 bg-[#1a2332] text-white">
              <span className="bg-[#d6a21b] px-3 py-2.5 text-xs font-bold tracking-wide text-[#1a2332]">CARGA {String(indice + 1).padStart(2, "0")}</span>
              <span className="min-w-0 flex-1 truncate text-sm font-semibold">{carga.fornecedor || "Fornecedor não informado"}</span>
              <span className="shrink-0 pr-4 text-xs font-semibold">NF {carga.nf || "—"}</span>
            </div>

            <div className="space-y-4 p-4">
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-1.5">
                  <label className={classeRotulo}>Fornecedor <span className="text-destructive">*</span></label>
                  <Input value={carga.fornecedor} onChange={e => atualizarCarga(carga.id, { fornecedor: e.target.value })} placeholder="Nome do fornecedor" />
                </div>
                <div className="space-y-1.5">
                  <label className={classeRotulo}>Nota Fiscal <span className="text-destructive">*</span></label>
                  <Input value={carga.nf} onChange={e => atualizarCarga(carga.id, { nf: e.target.value })} placeholder="Número da NF" />
                </div>
                <div className="space-y-1.5">
                  <label className={classeRotulo}>Nº do Pedido de Compra</label>
                  <Input value={carga.numeroPedido} onChange={e => atualizarCarga(carga.id, { numeroPedido: e.target.value })} placeholder="Número do pedido" />
                </div>
                <div className="space-y-1.5">
                  <label className={classeRotulo}>Peso total da nota (kg) <span className="text-destructive">*</span></label>
                  <Input inputMode="decimal" value={carga.pesoNota} onChange={e => atualizarCarga(carga.id, { pesoNota: e.target.value })} placeholder="Ex.: 10.722,600" />
                </div>
                <div className="space-y-1.5 md:col-span-2">
                  <label className={classeRotulo}>Local físico de descarga <span className="text-destructive">*</span></label>
                  <select className={classeSelect} value={carga.localDescarga} onChange={e => atualizarCarga(carga.id, { localDescarga: e.target.value })}>
                    <option value="">Selecione um local...</option>
                    {localForaDaLista && <option value={carga.localDescarga}>{carga.localDescarga}</option>}
                    {locais?.map(l => <option key={l.id} value={l.nome}>{l.nome}</option>)}
                  </select>
                  {locais?.length === 0 && <p className="text-xs text-muted-foreground">Nenhum local cadastrado ainda. Cadastre em "Locais" no menu.</p>}
                </div>
                <div className="space-y-1.5">
                  <label className={classeRotulo}>Conferência nota × material físico</label>
                  <select className={classeSelect} value={carga.conferenciaNota} onChange={e => atualizarCarga(carga.id, { conferenciaNota: e.target.value as Conferencia })}>
                    <option value="100%">100%</option>
                    <option value="Parcial">Parcial</option>
                  </select>
                </div>
                <div className="space-y-1.5">
                  <label className={classeRotulo}>Conferência nota × pedido</label>
                  <select className={classeSelect} value={carga.conferenciaPedido} onChange={e => atualizarCarga(carga.id, { conferenciaPedido: e.target.value as Conferencia })}>
                    <option value="100%">100%</option>
                    <option value="Parcial">Parcial</option>
                  </select>
                </div>
              </div>

              <details className="group rounded-lg border border-border/80 bg-[#fbfcfd]">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-3 py-2.5 text-xs">
                  <span className="font-bold text-[#1a2332]">
                    Materiais desta carga
                    <span className="ml-2 font-normal text-muted-foreground">
                      {carga.itens.length} {carga.itens.length === 1 ? "item" : "itens"} · {formatKg(pesoItens)} kg
                      {pesoNota !== null && <> · nota: {formatKg(pesoNota, 3)} kg</>}
                    </span>
                  </span>
                  <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" />
                </summary>
                <div className="divide-y divide-border/70 border-t border-border/70">
                  {carga.itens.length === 0 && <div className="px-3 py-3 text-xs text-destructive">Nenhum material nesta carga.</div>}
                  {carga.itens.map((item, posicao) => (
                    <div key={item.id ?? posicao} className="flex items-center justify-between gap-3 px-3 py-2 text-xs">
                      <div className="min-w-0">
                        <div className="truncate font-semibold text-[#1a2332]">{descricaoItem(item)} <span className="font-normal text-muted-foreground">· {item.aco || "-"}</span></div>
                        <div className="truncate text-muted-foreground">
                          {item.quantidade || 0} pç · {dimensoesItem(item)} mm · {formatKg(parseFloat(String(item.pesoTotal || 0)) || 0)} kg · {item.obraNome || "LIVRE"}
                        </div>
                      </div>
                      {permitirRemoverItens && (
                        <button
                          type="button"
                          title="Tirar este material do relatório"
                          onClick={() => atualizarCarga(carga.id, { itens: carga.itens.filter((_, i) => i !== posicao) })}
                          className="shrink-0 rounded p-1 text-muted-foreground hover:bg-red-50 hover:text-destructive"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </details>

              <div className="rounded-lg border border-[#ecd79a] bg-[#fff8e2] p-3">
                <div className="flex items-center gap-2 text-xs font-bold text-[#1a2332]"><AlertCircle className="h-4 w-4 text-[#b07a12]" /> Observações e divergências desta carga</div>
                <textarea
                  className="mt-2 min-h-[70px] w-full resize-y rounded-md border border-[#ead9a2] bg-white px-3 py-2 text-sm outline-none focus:border-[#d6a21b] focus:ring-2 focus:ring-[#d6a21b]/20"
                  value={carga.observacoes}
                  onChange={e => atualizarCarga(carga.id, { observacoes: e.target.value })}
                  placeholder="Ex.: divergência de peso, quantidade, NF ou pedido encontrada na conferência..."
                />
              </div>

              <div className="rounded-lg border border-border/80 p-3">
                <div className="mb-2 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-1.5 text-xs font-bold text-[#1a2332]">
                    <ImageIcon className="h-4 w-4" /> Fotos desta carga
                    <span className="font-normal text-muted-foreground">({existentes.length + novas.length})</span>
                  </div>
                  <label className="flex shrink-0 cursor-pointer items-center gap-1 text-xs font-semibold text-[#9b7412] hover:text-[#7a5b0e]">
                    <Plus className="h-3.5 w-3.5" /> Anexar fotos
                    <input
                      type="file"
                      accept="image/*"
                      multiple
                      className="hidden"
                      onChange={(e) => {
                        const escolhidas = Array.from(e.target.files || []);
                        onFotosNovasChange({ ...fotosNovas, [carga.id]: [...novas, ...escolhidas] });
                        e.target.value = "";
                      }}
                    />
                  </label>
                </div>
                {existentes.length + novas.length === 0 ? (
                  <p className="text-xs text-muted-foreground">Nenhuma foto anexada a esta carga.</p>
                ) : (
                  <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
                    {existentes.map(foto => (
                      <Miniatura key={foto.id} url={foto.url} titulo={`Foto ${foto.id}`} onRemover={onRemoverFotoExistente ? () => onRemoverFotoExistente(foto.id) : undefined} />
                    ))}
                    {novas.map((file, posicao) => (
                      <MiniaturaNova
                        key={`${file.name}-${file.lastModified}-${posicao}`}
                        file={file}
                        onRemover={() => onFotosNovasChange({ ...fotosNovas, [carga.id]: novas.filter((_, i) => i !== posicao) })}
                      />
                    ))}
                  </div>
                )}
              </div>
            </div>
          </section>
        );
      })}

      <section className="rounded-xl border border-border/80 bg-card p-4 shadow-sm">
        <div className="mb-4">
          <h3 className="text-sm font-bold uppercase tracking-[0.08em] text-[#1a2332]">Responsáveis pelo recebimento</h3>
          <p className="mt-1 text-xs text-muted-foreground">Valem para o relatório inteiro — os nomes saem junto às linhas de assinatura no fim do documento.</p>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-1.5">
            <label className={classeRotulo}>Conferido por</label>
            <Input value={dados.conferidoPor} onChange={e => onChange({ ...dados, conferidoPor: e.target.value })} placeholder="Nome, cargo e data" />
          </div>
          <div className="space-y-1.5">
            <label className={classeRotulo}>Visto da Qualidade / Almoxarifado</label>
            <Input value={dados.vistoQualidade} onChange={e => onChange({ ...dados, vistoQualidade: e.target.value })} placeholder="Nome, cargo e data" />
          </div>
        </div>
      </section>
    </div>
  );
}
