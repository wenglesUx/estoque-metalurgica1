// /modules/separacao-producao/components/RequisicaoForm.tsx
// Dados da requisição — todos obrigatórios, exceto observações

import { useEffect, useState } from "react";
import { toast } from "sonner";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

import { trpc } from "@/lib/trpc";
import { Loader2 } from "lucide-react";

import { hojeIso, mensagemErro } from "../status";

export interface DadosRequisicao {
  numero: string;
  dataRequisicao: string;
  obraId: number | null;
  etapa: string;
  observacoes: string;
}

interface RequisicaoFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Sem id = nova requisição */
  requisicao?: (Omit<DadosRequisicao, "observacoes"> & { id: number; observacoes?: string | null }) | null;
  onSalvo: (id: number) => void;
}

const LABEL_CLASS = "text-[10px] font-bold uppercase text-muted-foreground";

const vazio = (): DadosRequisicao => ({
  numero: "",
  dataRequisicao: hojeIso(),
  obraId: null,
  etapa: "",
  observacoes: "",
});

export function RequisicaoForm({
  open,
  onOpenChange,
  requisicao,
  onSalvo,
}: RequisicaoFormProps) {
  const [dados, setDados] = useState<DadosRequisicao>(vazio);
  const [tentouSalvar, setTentouSalvar] = useState(false);

  const { data: obras } = trpc.obras.list.useQuery(undefined, { enabled: open });

  const criar = trpc.requisicoesProducao.criar.useMutation();
  const atualizar = trpc.requisicoesProducao.atualizarCabecalho.useMutation();
  const salvando = criar.isPending || atualizar.isPending;

  useEffect(() => {
    if (!open) return;

    setTentouSalvar(false);
    setDados(
      requisicao
        ? {
            numero: requisicao.numero,
            dataRequisicao: requisicao.dataRequisicao,
            obraId: requisicao.obraId,
            etapa: requisicao.etapa,
            observacoes: requisicao.observacoes ?? "",
          }
        : vazio()
    );
    // Só ao abrir — um refetch da requisição não pode apagar o que está sendo digitado
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, requisicao?.id]);

  const faltando = {
    numero: !dados.numero.trim(),
    dataRequisicao: !dados.dataRequisicao,
    obraId: !dados.obraId,
    etapa: !dados.etapa.trim(),
  };

  const invalido = Object.values(faltando).some(Boolean);

  const erroClass = (campo: keyof typeof faltando) =>
    tentouSalvar && faltando[campo] ? "border-destructive" : "";

  const salvar = async () => {
    setTentouSalvar(true);

    if (invalido || !dados.obraId) {
      toast.error("Preencha todos os campos obrigatórios.");
      return;
    }

    const payload = {
      numero: dados.numero,
      dataRequisicao: dados.dataRequisicao,
      obraId: dados.obraId,
      etapa: dados.etapa,
      observacoes: dados.observacoes,
    };

    try {
      if (requisicao?.id) {
        await atualizar.mutateAsync({ id: requisicao.id, ...payload });
        toast.success("Requisição atualizada.");
        onSalvo(requisicao.id);
      } else {
        const result = await criar.mutateAsync(payload);

        if (!result?.id) throw new Error("Não foi possível criar a requisição.");

        toast.success("Requisição criada — já pode ler os materiais.");
        onSalvo(result.id);
      }

      onOpenChange(false);
    } catch (error) {
      toast.error(mensagemErro(error));
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {requisicao?.id ? "Editar requisição" : "Nova requisição de produção"}
          </DialogTitle>
          <DialogDescription>
            Campos marcados com * são obrigatórios.
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <label className={LABEL_CLASS}>Nº da requisição *</label>
            <Input
              autoFocus
              className={erroClass("numero")}
              value={dados.numero}
              onChange={(e) => setDados({ ...dados, numero: e.target.value })}
            />
          </div>

          <div className="space-y-1">
            <label className={LABEL_CLASS}>Data da requisição *</label>
            <Input
              type="date"
              className={erroClass("dataRequisicao")}
              value={dados.dataRequisicao}
              onChange={(e) => setDados({ ...dados, dataRequisicao: e.target.value })}
            />
          </div>

          <div className="space-y-1 col-span-2">
            <label className={LABEL_CLASS}>Obra *</label>
            <select
              className={`w-full h-9 px-2 text-sm rounded-md border border-input bg-background ${erroClass("obraId")}`}
              value={dados.obraId ?? ""}
              onChange={(e) =>
                setDados({ ...dados, obraId: e.target.value ? Number(e.target.value) : null })
              }
            >
              <option value="">Selecione a obra...</option>
              {(obras ?? []).map((obra: any) => (
                <option key={obra.id} value={obra.id}>
                  {obra.nome}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-1 col-span-2">
            <label className={LABEL_CLASS}>Etapa *</label>
            <Input
              placeholder="Ex: Estrutura metálica — 2º pavimento"
              className={erroClass("etapa")}
              value={dados.etapa}
              onChange={(e) => setDados({ ...dados, etapa: e.target.value })}
            />
          </div>

          <div className="space-y-1 col-span-2">
            <label className={LABEL_CLASS}>Observações</label>
            <textarea
              className="w-full min-h-[60px] px-3 py-2 rounded-md border border-input bg-background text-sm resize-y"
              value={dados.observacoes}
              onChange={(e) => setDados({ ...dados, observacoes: e.target.value })}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button onClick={salvar} disabled={salvando} className="gap-2">
            {salvando && <Loader2 className="w-4 h-4 animate-spin" />}
            {requisicao?.id ? "Salvar" : "Criar e começar a leitura"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
