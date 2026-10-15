// /modules/separacao-producao/components/RequisicaoDetalhe.tsx
// Requisição aberta: leitura de QR, separação item a item (salva na hora)
// e aprovação/rejeição pelo ADM.

import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { format } from "date-fns";

import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";

import {
  AlertTriangle,
  ArrowLeft,
  Camera,
  CheckCircle2,
  CheckCheck,
  Edit2,
  Loader2,
  PackageCheck,
  QrCode,
  Send,
  Trash2,
  Undo2,
  XCircle,
} from "lucide-react";

import { lerCodigoMaterial } from "@/modules/labels/qr-material";

import { CameraQrScanner } from "./CameraQrScanner";
import { BotaoFotoQr } from "./BotaoFotoQr";
import { RequisicaoForm } from "./RequisicaoForm";
import {
  STATUS_REQUISICAO,
  formatarDataRequisicao,
  mensagemErro,
  type StatusRequisicao,
} from "../status";

interface RequisicaoDetalheProps {
  id: number;
  onVoltar: () => void;
}

type Confirmacao = "enviar" | "cancelar" | "aprovar" | "devolver" | "rejeitar" | null;

const LABEL_CLASS = "text-[10px] font-bold uppercase text-muted-foreground";

const descricaoMaterial = (m: any) =>
  `${m.tipo} ${m.bitola}${m.aco ? ` — ${m.aco}` : ""}`;

const dimensaoMaterial = (m: any) =>
  m.categoria === "CHAPA"
    ? `${(m.largura || 0).toLocaleString("pt-BR")}×${(m.comprimento || 0).toLocaleString("pt-BR")} mm`
    : `${(m.comprimento || 0).toLocaleString("pt-BR")} mm`;

export function RequisicaoDetalhe({ id, onVoltar }: RequisicaoDetalheProps) {
  const utils = trpc.useUtils();
  const { isAdmin } = useAuth();

  const { data: req, isLoading } = trpc.requisicoesProducao.obter.useQuery({ id });

  const [codigo, setCodigo] = useState("");
  const [materialLidoId, setMaterialLidoId] = useState<number | null>(null);
  const [quantidade, setQuantidade] = useState("");
  const [cameraAberta, setCameraAberta] = useState(false);
  const [editarAberto, setEditarAberto] = useState(false);
  const [confirmacao, setConfirmacao] = useState<Confirmacao>(null);
  const [motivo, setMotivo] = useState("");
  const [ultimoSalvamento, setUltimoSalvamento] = useState<Date | null>(null);

  const leituraRef = useRef<HTMLInputElement>(null);
  const quantidadeRef = useRef<HTMLInputElement>(null);

  const leitura = trpc.requisicoesProducao.lerMaterial.useQuery(
    { materialId: materialLidoId ?? 0, requisicaoId: id },
    { enabled: materialLidoId !== null, retry: false }
  );

  const adicionarItem = trpc.requisicoesProducao.adicionarItem.useMutation();
  const definirQuantidade = trpc.requisicoesProducao.definirQuantidadeItem.useMutation();
  const enviar = trpc.requisicoesProducao.enviarParaAprovacao.useMutation();
  const cancelar = trpc.requisicoesProducao.cancelar.useMutation();
  const aprovar = trpc.requisicoesProducao.aprovar.useMutation();
  const devolver = trpc.requisicoesProducao.devolver.useMutation();
  const rejeitar = trpc.requisicoesProducao.rejeitar.useMutation();

  const status = req?.status as StatusRequisicao | undefined;
  const emSeparacao = status === "em_separacao";

  const totalPecas = useMemo(
    () => (req?.itens ?? []).reduce((soma: number, it: any) => soma + it.quantidade, 0),
    [req?.itens]
  );

  // Hora do último item salvo, até haver um salvamento nesta sessão
  const salvoEm = useMemo(() => {
    if (ultimoSalvamento) return ultimoSalvamento;

    const datas = (req?.itens ?? []).map((it: any) => new Date(it.updatedAt).getTime());

    return datas.length ? new Date(Math.max(...datas)) : null;
  }, [ultimoSalvamento, req?.itens]);

  // Leitor pronto pra próxima etiqueta assim que a tela abre
  useEffect(() => {
    if (emSeparacao) leituraRef.current?.focus();
  }, [emSeparacao]);

  // Material lido: foco na quantidade
  useEffect(() => {
    if (leitura.data) {
      setQuantidade("");
      setTimeout(() => quantidadeRef.current?.focus(), 0);
    }
  }, [leitura.data]);

  const atualizarDados = async () => {
    await Promise.all([
      utils.requisicoesProducao.obter.invalidate({ id }),
      utils.requisicoesProducao.listar.invalidate(),
      utils.requisicoesProducao.reservas.invalidate(),
      utils.requisicoesProducao.lerMaterial.invalidate(),
    ]);
  };

  const processarLeitura = (texto: string) => {
    const materialId = lerCodigoMaterial(texto);

    if (materialId === null) {
      toast.error("Código não reconhecido. Leia o QR code de uma etiqueta do sistema.");
      setCodigo("");
      return;
    }

    setCodigo("");
    setMaterialLidoId(materialId);
  };

  const limparLeitura = () => {
    setMaterialLidoId(null);
    setQuantidade("");
    setTimeout(() => leituraRef.current?.focus(), 0);
  };

  const separar = async () => {
    const qtd = Number(quantidade);

    if (!materialLidoId || !Number.isInteger(qtd) || qtd <= 0) {
      toast.error("Informe quantas peças está separando.");
      return;
    }

    try {
      await adicionarItem.mutateAsync({ requisicaoId: id, materialId: materialLidoId, quantidade: qtd });

      setUltimoSalvamento(new Date());
      toast.success(
        `${qtd} pç de ${leitura.data ? descricaoMaterial(leitura.data.material) : "material"} separada(s) — salvo.`
      );

      await atualizarDados();
      limparLeitura();
    } catch (error) {
      toast.error(mensagemErro(error));
    }
  };

  const alterarQuantidadeItem = async (itemId: number, novaQuantidade: number) => {
    try {
      await definirQuantidade.mutateAsync({ itemId, quantidade: novaQuantidade });
      setUltimoSalvamento(new Date());
      await atualizarDados();
      toast.success(novaQuantidade === 0 ? "Item removido." : "Quantidade atualizada.");
    } catch (error) {
      toast.error(mensagemErro(error));
      await atualizarDados();
    }
  };

  const executarConfirmacao = async () => {
    try {
      if (confirmacao === "enviar") {
        await enviar.mutateAsync({ id });
        toast.success("Requisição enviada para aprovação do ADM.");
      } else if (confirmacao === "cancelar") {
        await cancelar.mutateAsync({ id });
        toast.success("Requisição cancelada — materiais liberados.");
      } else if (confirmacao === "aprovar") {
        await aprovar.mutateAsync({ id });
        toast.success("Requisição aprovada — baixa realizada no estoque.");
        await utils.materiais.list.invalidate();
      } else if (confirmacao === "devolver") {
        await devolver.mutateAsync({ id, motivo });
        toast.success("Requisição devolvida para separação.");
      } else if (confirmacao === "rejeitar") {
        if (!motivo.trim()) {
          toast.error("Informe o motivo da rejeição.");
          return;
        }

        await rejeitar.mutateAsync({ id, motivo });
        toast.success("Requisição rejeitada — materiais liberados.");
      }

      setConfirmacao(null);
      setMotivo("");
      await atualizarDados();
    } catch (error) {
      toast.error(mensagemErro(error));
    }
  };

  const executando =
    enviar.isPending || cancelar.isPending || aprovar.isPending || devolver.isPending || rejeitar.isPending;

  if (isLoading) {
    return (
      <Card className="flex items-center justify-center gap-2 p-8 text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Carregando requisição...
      </Card>
    );
  }

  if (!req || !status) {
    return (
      <Card className="p-8 text-center text-muted-foreground space-y-3">
        <p>Requisição não encontrada.</p>
        <Button variant="outline" onClick={onVoltar}>Voltar</Button>
      </Card>
    );
  }

  const lido = leitura.data;

  return (
    <div className="space-y-4">
      {/* CABEÇALHO */}
      <Card className="p-3 sm:p-4 md:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-start gap-2 min-w-0 break-words">
            <Button variant="ghost" size="icon" className="shrink-0" onClick={onVoltar} aria-label="Voltar">
              <ArrowLeft className="w-4 h-4" />
            </Button>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-lg font-bold">Requisição {req.numero}</h3>
                <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold uppercase ${STATUS_REQUISICAO[status].className}`}>
                  {STATUS_REQUISICAO[status].label}
                </span>
              </div>
              <div className="mt-1 text-xs text-muted-foreground flex flex-wrap gap-x-4 gap-y-1">
                <span>Data: <strong className="text-foreground">{formatarDataRequisicao(req.dataRequisicao)}</strong></span>
                <span>Obra: <strong className="text-foreground">{req.obraNome}</strong></span>
                <span>Etapa: <strong className="text-foreground">{req.etapa}</strong></span>
                <span>Criada por {req.usuarioCriacao}</span>
              </div>
              {req.observacoes && (
                <p className="mt-1 text-xs italic text-muted-foreground">{req.observacoes}</p>
              )}
            </div>
          </div>

          {emSeparacao && (
            <Button variant="outline" size="sm" className="gap-1.5 w-full sm:w-auto" onClick={() => setEditarAberto(true)}>
              <Edit2 className="w-3.5 h-3.5" /> Editar dados
            </Button>
          )}
        </div>

        {emSeparacao && req.motivoRejeicao && (
          <div className="mt-3 flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span>Devolvida pelo ADM para correção: {req.motivoRejeicao}</span>
          </div>
        )}

        {status === "rejeitada" && (
          <div className="mt-3 flex items-start gap-2 rounded-md border border-red-200 bg-red-50 p-3 text-xs text-red-800">
            <XCircle className="w-4 h-4 shrink-0" />
            <span>
              Rejeitada por {req.usuarioAprovacao}
              {req.dataAprovacao ? ` em ${format(new Date(req.dataAprovacao), "dd/MM/yyyy HH:mm")}` : ""}.
              {" "}Motivo: {req.motivoRejeicao}
            </span>
          </div>
        )}

        {status === "aprovada" && (
          <div className="mt-3 flex items-start gap-2 rounded-md border border-green-200 bg-green-50 p-3 text-xs text-green-800">
            <CheckCircle2 className="w-4 h-4 shrink-0" />
            <span>
              Aprovada por {req.usuarioAprovacao}
              {req.dataAprovacao ? ` em ${format(new Date(req.dataAprovacao), "dd/MM/yyyy HH:mm")}` : ""}
              {" "}— baixa feita no estoque (veja em Registros de Saída e na Linha do Tempo de cada material).
            </span>
          </div>
        )}
      </Card>

      {/* LEITURA */}
      {emSeparacao && (
        <Card className="p-3 sm:p-4 md:p-5 space-y-4">
          <div className="space-y-1">
            <label className={LABEL_CLASS}>Ler QR code da etiqueta</label>

            <div className="flex flex-col sm:flex-row gap-2">
              <div className="flex gap-2 flex-1 min-w-0">
                <div className="relative flex-1 min-w-0">
                  <QrCode className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input
                    ref={leituraRef}
                    className="pl-9"
                    placeholder="Leitor, câmera ou código do material"
                    value={codigo}
                    onChange={(e) => setCodigo(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && codigo.trim()) {
                        e.preventDefault();
                        processarLeitura(codigo);
                      }
                    }}
                  />
                </div>
                <Button variant="outline" className="shrink-0" onClick={() => codigo.trim() && processarLeitura(codigo)}>
                  Buscar
                </Button>
              </div>

              <div className="grid grid-cols-2 gap-2 sm:flex">
                <Button className="gap-2" onClick={() => setCameraAberta(true)}>
                  <Camera className="w-4 h-4" /> Câmera
                </Button>
                <BotaoFotoQr onResult={processarLeitura} />
              </div>
            </div>
          </div>

          {materialLidoId !== null && (
            <div className="rounded-lg border bg-muted/20 p-3 sm:p-4 break-words">
              {leitura.isLoading ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="w-4 h-4 animate-spin" /> Buscando material...
                </div>
              ) : leitura.error ? (
                <div className="flex items-center justify-between gap-3 text-sm text-destructive">
                  <span>{mensagemErro(leitura.error)}</span>
                  <Button variant="ghost" size="sm" onClick={limparLeitura}>Ler outro</Button>
                </div>
              ) : lido ? (
                <div className="space-y-4">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <div className="font-bold">{descricaoMaterial(lido.material)}</div>
                      <div className="text-xs text-muted-foreground">
                        Código {lido.material.id} · {dimensaoMaterial(lido.material)}
                      </div>
                    </div>
                    {!lido.material.ativo && (
                      <span className="rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-bold uppercase text-red-700">
                        Fora do estoque
                      </span>
                    )}
                  </div>

                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
                    <Info label="Corrida" valor={lido.material.corrida} />
                    <Info label="Nota fiscal" valor={lido.material.nf} />
                    <Info label="GRD" valor={lido.grds.length ? lido.grds.join(", ") : null} />
                    <Info label="Entrada" valor={format(new Date(lido.material.createdAt), "dd/MM/yyyy")} />
                    <Info label="Obra direcionada" valor={lido.material.obraNome || "LIVRE"} />
                    <Info label="Obra da compra" valor={lido.material.obraCompraNome} />
                    <Info label="Local" valor={lido.material.local} />
                    <Info
                      label="Mesmo perfil/corrida/NF"
                      valor={`${lido.mesmoLote.pecas} pç em estoque${lido.mesmoLote.registros > 1 ? ` (${lido.mesmoLote.registros} cadastros)` : ""}`}
                    />
                  </div>

                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3 rounded-md border bg-background p-3 text-center">
                    <Numero label="Neste pacote" valor={lido.material.ativo ? lido.material.quantidade : 0} />
                    <Numero label="Reservado em outras" valor={lido.reservadoOutras} />
                    <Numero label="Já nesta requisição" valor={lido.nestaRequisicao} />
                    <Numero label="Disponível" valor={lido.disponivel} destaque />
                  </div>

                  {lido.disponivel > 0 ? (
                    <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-end">
                      <div className="col-span-2 space-y-1">
                        <label className={LABEL_CLASS}>Peças separadas</label>
                        <Input
                          ref={quantidadeRef}
                          type="number"
                          min={1}
                          max={lido.disponivel}
                          className="w-full sm:w-32"
                          value={quantidade}
                          onChange={(e) => setQuantidade(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              e.preventDefault();
                              separar();
                            }
                          }}
                        />
                      </div>
                      <Button variant="outline" onClick={() => setQuantidade(String(lido.disponivel))}>
                        Todas ({lido.disponivel})
                      </Button>
                      <Button variant="ghost" className="sm:order-last" onClick={limparLeitura}>
                        Cancelar leitura
                      </Button>
                      <Button
                        className="col-span-2 gap-2 bg-green-600 hover:bg-green-700"
                        onClick={separar}
                        disabled={adicionarItem.isPending}
                      >
                        {adicionarItem.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <PackageCheck className="w-4 h-4" />}
                        Separar
                      </Button>
                    </div>
                  ) : (
                    <div className="flex items-center justify-between gap-3 text-sm text-amber-700">
                      <span>Não há peças disponíveis deste material para separar.</span>
                      <Button variant="ghost" size="sm" onClick={limparLeitura}>Ler outro</Button>
                    </div>
                  )}
                </div>
              ) : null}
            </div>
          )}
        </Card>
      )}

      {/* ITENS */}
      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3">
          <div>
            <h4 className="text-sm font-bold">Materiais separados</h4>
            <span className="text-xs text-muted-foreground">
              {req.itens.length} materiais · {totalPecas} peças
            </span>
          </div>
          {emSeparacao && salvoEm && (
            <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <CheckCheck className="w-4 h-4 text-green-600" />
              Salvo automaticamente às {format(salvoEm, "HH:mm:ss")}
            </span>
          )}
        </div>

        {req.itens.length === 0 ? (
          <div className="p-8 text-center text-sm text-muted-foreground">
            Nenhum material lido ainda.
          </div>
        ) : (
          <>
          {/* Celular: um cartão por material */}
          <div className="divide-y md:hidden">
            {req.itens.map((item: any) => (
              <div key={item.id} className="flex items-start justify-between gap-3 p-3 break-words">
                <div className="min-w-0 text-xs">
                  <div className="text-sm font-medium">{descricaoMaterial(item.material)}</div>
                  <div className="text-muted-foreground">
                    Código {item.materialId} · {dimensaoMaterial(item.material)}
                  </div>
                  <div className="text-muted-foreground">
                    Corr: {item.material.corrida || "-"} · NF: {item.material.nf || "-"}
                  </div>
                  <div className="text-muted-foreground">Obra: {item.material.obraNome || "LIVRE"}</div>
                </div>

                <div className="flex shrink-0 items-center gap-1">
                  {emSeparacao ? (
                    <>
                      <QuantidadeEditavel
                        valor={item.quantidade}
                        onSalvar={(v) => alterarQuantidadeItem(item.id, v)}
                      />
                      <Button
                        variant="ghost"
                        size="icon"
                        className="text-destructive"
                        title="Remover da requisição"
                        onClick={() => alterarQuantidadeItem(item.id, 0)}
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </>
                  ) : (
                    <strong className="text-sm">{item.quantidade} PÇ</strong>
                  )}
                </div>
              </div>
            ))}
          </div>

          <div className="hidden md:block overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-[10px] font-bold uppercase">
                <tr>
                  <th className="px-3 py-2 text-left">Material</th>
                  <th className="px-3 py-2 text-left">Corrida / NF</th>
                  <th className="px-3 py-2 text-left">Obra atual</th>
                  <th className="px-3 py-2 text-right">Peças</th>
                  {emSeparacao && <th className="px-3 py-2" />}
                </tr>
              </thead>
              <tbody className="divide-y">
                {req.itens.map((item: any) => (
                  <tr key={item.id}>
                    <td className="px-3 py-2">
                      <div className="font-medium">{descricaoMaterial(item.material)}</div>
                      <div className="text-[10px] text-muted-foreground">
                        Código {item.materialId} · {dimensaoMaterial(item.material)} · lido por {item.usuarioNome || "-"}
                      </div>
                    </td>
                    <td className="px-3 py-2 text-xs">
                      <div>Corr: {item.material.corrida || "-"}</div>
                      <div className="text-muted-foreground">NF: {item.material.nf || "-"}</div>
                    </td>
                    <td className="px-3 py-2 text-xs">{item.material.obraNome || "LIVRE"}</td>
                    <td className="px-3 py-2 text-right">
                      {emSeparacao ? (
                        <QuantidadeEditavel
                          valor={item.quantidade}
                          onSalvar={(v) => alterarQuantidadeItem(item.id, v)}
                        />
                      ) : (
                        <strong>{item.quantidade} PÇ</strong>
                      )}
                    </td>
                    {emSeparacao && (
                      <td className="px-3 py-2 text-right">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="text-destructive"
                          title="Remover da requisição"
                          onClick={() => alterarQuantidadeItem(item.id, 0)}
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          </>
        )}
      </Card>

      {/* AÇÕES */}
      {emSeparacao && (
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="outline" className="gap-2 text-destructive" onClick={() => setConfirmacao("cancelar")}>
            <XCircle className="w-4 h-4" /> Cancelar requisição
          </Button>
          <Button
            className="gap-2"
            disabled={req.itens.length === 0}
            onClick={() => setConfirmacao("enviar")}
          >
            <Send className="w-4 h-4" /> Finalizar e enviar para aprovação
          </Button>
        </div>
      )}

      {status === "aguardando_aprovacao" && (
        isAdmin ? (
          // Conferência do ADM: centralizado, aprovar ocupando a largura toda
          <div className="mx-auto w-full max-w-xl space-y-2">
            <div className="grid grid-cols-2 gap-2">
              <Button variant="outline" className="gap-2" onClick={() => setConfirmacao("devolver")}>
                <Undo2 className="w-4 h-4" /> Devolver
              </Button>
              <Button variant="outline" className="gap-2 text-destructive" onClick={() => setConfirmacao("rejeitar")}>
                <XCircle className="w-4 h-4" /> Rejeitar
              </Button>
            </div>
            <Button className="w-full h-11 gap-2 bg-green-600 hover:bg-green-700" onClick={() => setConfirmacao("aprovar")}>
              <CheckCircle2 className="w-4 h-4" /> Aprovar e dar baixa
            </Button>
          </div>
        ) : (
          <p className="text-center text-sm text-muted-foreground">
            Aguardando aprovação de um ADM. Os materiais continuam reservados até lá.
          </p>
        )
      )}

      <CameraQrScanner
        open={cameraAberta}
        onOpenChange={setCameraAberta}
        onResult={processarLeitura}
      />

      <RequisicaoForm
        open={editarAberto}
        onOpenChange={setEditarAberto}
        requisicao={req}
        onSalvo={() => atualizarDados()}
      />

      <Dialog open={confirmacao !== null} onOpenChange={(open) => { if (!open) { setConfirmacao(null); setMotivo(""); } }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              {confirmacao === "enviar" && "Enviar para aprovação?"}
              {confirmacao === "cancelar" && "Cancelar requisição?"}
              {confirmacao === "aprovar" && "Aprovar e dar baixa?"}
              {confirmacao === "devolver" && "Devolver para separação?"}
              {confirmacao === "rejeitar" && "Rejeitar requisição?"}
            </DialogTitle>
            <DialogDescription>
              {confirmacao === "enviar" && `${req.itens.length} materiais (${totalPecas} peças) seguem para o ADM aprovar. Depois de enviada, a requisição não pode mais ser alterada.`}
              {confirmacao === "cancelar" && "Os materiais lidos deixam de ficar reservados. A requisição continua na lista como cancelada."}
              {confirmacao === "aprovar" && `Será feita a baixa de ${totalPecas} peças do estoque, com destino ${req.obraNome}, pelo fluxo normal de saída.`}
              {confirmacao === "devolver" && "A requisição volta para em separação, para corrigir os itens."}
              {confirmacao === "rejeitar" && "Os materiais deixam de ficar reservados e nada é baixado do estoque."}
            </DialogDescription>
          </DialogHeader>

          {(confirmacao === "devolver" || confirmacao === "rejeitar") && (
            <div className="space-y-1">
              <label className={LABEL_CLASS}>
                Motivo{confirmacao === "rejeitar" ? " *" : ""}
              </label>
              <textarea
                className="w-full min-h-[70px] px-3 py-2 rounded-md border border-input bg-background text-sm resize-y"
                value={motivo}
                onChange={(e) => setMotivo(e.target.value)}
              />
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => { setConfirmacao(null); setMotivo(""); }}>
              Voltar
            </Button>
            <Button
              onClick={executarConfirmacao}
              disabled={executando}
              className={`gap-2 ${confirmacao === "aprovar" ? "bg-green-600 hover:bg-green-700" : ""}`}
              variant={confirmacao === "cancelar" || confirmacao === "rejeitar" ? "destructive" : "default"}
            >
              {executando && <Loader2 className="w-4 h-4 animate-spin" />}
              Confirmar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Info({ label, valor }: { label: string; valor: string | null | undefined }) {
  return (
    <div>
      <div className={LABEL_CLASS}>{label}</div>
      <div className="font-medium">{valor || "-"}</div>
    </div>
  );
}

function Numero({ label, valor, destaque }: { label: string; valor: number; destaque?: boolean }) {
  return (
    <div>
      <div className={LABEL_CLASS}>{label}</div>
      <div className={`text-lg font-bold ${destaque ? "text-green-700" : ""}`}>{valor} pç</div>
    </div>
  );
}

// Quantidade editável na tabela — salva ao sair do campo ou com Enter
function QuantidadeEditavel({ valor, onSalvar }: { valor: number; onSalvar: (valor: number) => void }) {
  const [texto, setTexto] = useState(String(valor));

  useEffect(() => setTexto(String(valor)), [valor]);

  const salvar = () => {
    const novo = Number(texto);

    if (!Number.isInteger(novo) || novo < 0) {
      setTexto(String(valor));
      return;
    }

    if (novo !== valor) onSalvar(novo);
  };

  return (
    <Input
      type="number"
      min={0}
      className="ml-auto h-8 w-20 text-right"
      value={texto}
      onChange={(e) => setTexto(e.target.value)}
      onBlur={salvar}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
      }}
    />
  );
}
