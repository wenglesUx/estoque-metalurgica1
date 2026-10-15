import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AlertCircle, Save } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { StockDashboardLayout } from "@/components/StockDashboardLayout";
import { PermissionDisable } from "@/components/PermissionGate";
import { z } from "zod";

const ajusteSchema = z.object({
  estoqueId: z.number().positive("Selecione um item de estoque"),
  quantidade: z.string().refine((val) => !isNaN(parseFloat(val)) && parseFloat(val) !== 0, "Quantidade inválida"),
  observacao: z.string().min(10, "Observação deve ter pelo menos 10 caracteres"),
});

type AjusteForm = z.infer<typeof ajusteSchema>;

export default function Ajuste() {
  const { data: estoque } = trpc.estoque.list.useQuery();
  const createMovimentacao = trpc.movimentacoes.create.useMutation();

  const [form, setForm] = useState<Partial<AjusteForm>>({
    estoqueId: undefined,
    quantidade: "",
    observacao: "",
  });

  const [errors, setErrors] = useState<Record<string, string>>({});

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrors({});

    try {
      const validated = ajusteSchema.parse(form);
      const quantidade = parseFloat(validated.quantidade);

      const item = estoque?.find((e: any) => e.id === validated.estoqueId);
      if (!item) {
        toast.error("Item de estoque não encontrado");
        return;
      }

      const saldoAnterior = item.saldoAtual;
      const saldoPosterior = (parseFloat(saldoAnterior) + quantidade).toString();

      await createMovimentacao.mutateAsync({
        tipo: "ajuste",
        estoqueId: validated.estoqueId,
        quantidade: validated.quantidade,
        saldoAnterior: saldoAnterior,
        saldoPosterior: saldoPosterior,
        observacao: validated.observacao,
        referenciaType: "ajuste",
      });

      toast.success("Ajuste registrado com sucesso!");
      setForm({ estoqueId: undefined, quantidade: "", observacao: "" });
    } catch (error) {
      if (error instanceof z.ZodError) {
        const newErrors: Record<string, string> = {};
        error.issues.forEach((issue: any) => {
          newErrors[issue.path[0] as string] = issue.message;
        });
        setErrors(newErrors);
      } else {
        toast.error("Erro ao registrar ajuste");
      }
    }
  };

  return (
    <StockDashboardLayout>
      <div className="space-y-8">
        <div>
          <h2 className="text-3xl font-bold text-foreground">Ajuste de Estoque</h2>
          <p className="text-muted-foreground mt-1">Registre ajustes manuais de saldo, com observação obrigatória.</p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Formulário */}
          <Card className="lg:col-span-2 p-6 border border-border">
            <form onSubmit={handleSubmit} className="space-y-6">
              {/* Item de Estoque */}
              <div>
                <label className="text-sm font-medium text-foreground block mb-2">
                  Item de Estoque *
                </label>
                <select
                  value={form.estoqueId || ""}
                  onChange={(e) =>
                    setForm({ ...form, estoqueId: e.target.value ? parseInt(e.target.value) : undefined })
                  }
                  className={`w-full px-3 py-2 border rounded-lg bg-background text-foreground ${
                    errors.estoqueId ? "border-red-500" : "border-border"
                  }`}
                >
                  <option value="">Selecione um item...</option>
                  {estoque?.map((item: any) => (
                    <option key={item.id} value={item.id}>
                      {item.tipo} {item.bitola} {item.aco ? `(${item.aco})` : ""} — {item.comprimentoBarra}mm | {item.quantidade} barras | {parseFloat(String(item.saldoAtual)).toFixed(1)}kg {item.obraId ? `| ${item.obraNome || "Obra " + item.obraId}` : "| Livre"}
                    </option>
                  ))}
                </select>
                {errors.estoqueId && <p className="text-red-500 text-xs mt-1">{errors.estoqueId}</p>}
              </div>

              {/* Quantidade */}
              <div>
                <label className="text-sm font-medium text-foreground block mb-2">
                  Quantidade (kg) *
                </label>
                <Input
                  type="number"
                  step="0.01"
                  placeholder="Ex: 50.5 ou -25.0"
                  value={form.quantidade}
                  onChange={(e) => setForm({ ...form, quantidade: e.target.value })}
                  className={errors.quantidade ? "border-red-500" : ""}
                />
                {errors.quantidade && <p className="text-red-500 text-xs mt-1">{errors.quantidade}</p>}
                <p className="text-xs text-muted-foreground mt-1">
                  Use valores positivos para adicionar, negativos para remover
                </p>
              </div>

              {/* Observação (Obrigatória) */}
              <div>
                <label className="text-sm font-medium text-foreground block mb-2">
                  Observação (Obrigatória) *
                </label>
                <textarea
                  placeholder="Descreva o motivo do ajuste (mínimo 10 caracteres)"
                  value={form.observacao}
                  onChange={(e) => setForm({ ...form, observacao: e.target.value })}
                  className={`w-full px-3 py-2 border rounded-lg bg-background text-foreground resize-none h-24 ${
                    errors.observacao ? "border-red-500" : "border-border"
                  }`}
                />
                {errors.observacao && <p className="text-red-500 text-xs mt-1">{errors.observacao}</p>}
                <p className="text-xs text-muted-foreground mt-1">
                  {form.observacao?.length || 0}/10 caracteres mínimo
                </p>
              </div>

              {/* Botão */}
              <PermissionDisable permission="materiais:ajustar">
                <Button
                  type="submit"
                  disabled={createMovimentacao.isPending}
                  className="w-full gap-2 bg-accent hover:bg-accent/90"
                >
                  <Save className="w-4 h-4" />
                  {createMovimentacao.isPending ? "Registrando..." : "Registrar Ajuste"}
                </Button>
              </PermissionDisable>
            </form>
          </Card>

          {/* Info Box */}
          <div className="space-y-4">
            <Card className="p-6 border border-border bg-accent/10 dark:bg-accent/15">
              <div className="flex gap-3">
                <AlertCircle className="w-5 h-5 text-accent-foreground dark:text-accent flex-shrink-0 mt-0.5" />
                <div>
                  <h4 className="font-semibold text-primary dark:text-foreground mb-2">
                    Ajustes Obrigatórios
                  </h4>
                  <ul className="text-sm text-primary/90 dark:text-foreground/90 space-y-1">
                    <li>✓ Todos os campos são obrigatórios</li>
                    <li>✓ Observação deve ter mínimo 10 caracteres</li>
                    <li>✓ Ajustes são imutáveis após registro</li>
                    <li>✓ Saldo anterior/posterior são snapshots</li>
                  </ul>
                </div>
              </div>
            </Card>

            <Card className="p-6 border border-border">
              <h4 className="font-semibold text-foreground mb-3">Exemplos de Observação</h4>
              <ul className="text-sm text-muted-foreground space-y-2">
                <li>• "Recontagem física identificou diferença de 5kg"</li>
                <li>• "Perda por oxidação em barra de 6mm"</li>
                <li>• "Correção de erro de entrada anterior"</li>
              </ul>
            </Card>
          </div>
        </div>
      </div>
    </StockDashboardLayout>
  );
}
