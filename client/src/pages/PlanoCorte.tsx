import { StockDashboardLayout } from "@/components/StockDashboardLayout";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Upload, AlertCircle, CheckCircle, Zap } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

interface ItemCorte {
  id: number;
  comprimento: number;
  quantidade: number;
  status: "pendente" | "alocado" | "parcial";
}

export default function PlanoCorte() {
  const [step, setStep] = useState<"upload" | "items" | "allocation">("upload");
  const [items, setItems] = useState<ItemCorte[]>([]);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const uploadedFile = e.target.files?.[0];
    if (!uploadedFile) return;

    if (!uploadedFile.name.endsWith(".pdf")) {
      toast.error("Apenas arquivos PDF são suportados");
      return;
    }

    toast.success("PDF carregado! Extraindo itens...");

    // Simular extração de itens do PDF
    setTimeout(() => {
      setItems([
        { id: 1, comprimento: 2000, quantidade: 5, status: "pendente" },
        { id: 2, comprimento: 3000, quantidade: 3, status: "pendente" },
        { id: 3, comprimento: 1500, quantidade: 8, status: "pendente" },
      ]);
      setStep("items");
    }, 1000);
  };

  const handleAllocate = () => {
    toast.success("Alocação iniciada com algoritmo de prioridade...");
    setItems(
      items.map((item) => ({
        ...item,
        status: Math.random() > 0.2 ? "alocado" : "parcial",
      }))
    );
    setStep("allocation");
  };

  const allocatedCount = items.filter((i) => i.status === "alocado").length;
  const partialCount = items.filter((i) => i.status === "parcial").length;

  return (
    <StockDashboardLayout>
      <div className="space-y-8">
        <div>
          <h2 className="text-3xl font-bold text-foreground">Plano de Corte</h2>
          <p className="text-muted-foreground mt-1">
            Upload de PDF e alocação automática com algoritmo de prioridade
          </p>
        </div>

        {step === "upload" && (
          <Card className="p-12 border-2 border-dashed border-border hover:border-accent transition-colors">
            <div className="text-center">
              <Upload className="w-16 h-16 mx-auto mb-4 text-muted-foreground" />
              <h3 className="text-lg font-semibold text-foreground mb-2">
                Carregue um Plano de Corte em PDF
              </h3>
              <p className="text-muted-foreground mb-6">
                O sistema extrairá automaticamente os itens necessários
              </p>
              <input
                type="file"
                accept=".pdf"
                onChange={handleFileUpload}
                className="hidden"
                id="pdf-input"
              />
              <Button
                onClick={() => document.getElementById("pdf-input")?.click()}
                className="bg-accent hover:bg-accent/90"
              >
                Selecionar PDF
              </Button>
            </div>
          </Card>
        )}

        {step === "items" && (
          <div className="space-y-6">
            <Card className="p-6 border border-border">
              <h3 className="text-lg font-semibold text-foreground mb-4">Itens Extraídos</h3>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-muted">
                    <tr>
                      <th className="px-4 py-2 text-left">ID</th>
                      <th className="px-4 py-2 text-left">Comprimento</th>
                      <th className="px-4 py-2 text-left">Quantidade</th>
                      <th className="px-4 py-2 text-left">Total (mm)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {items.map((item) => (
                      <tr key={item.id}>
                        <td className="px-4 py-2">#{item.id}</td>
                        <td className="px-4 py-2">{item.comprimento}mm</td>
                        <td className="px-4 py-2">{item.quantidade}</td>
                        <td className="px-4 py-2 font-medium">
                          {item.comprimento * item.quantidade}mm
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>

            <div className="flex gap-2">
              <Button
                onClick={handleAllocate}
                className="gap-2 bg-accent hover:bg-accent/90"
              >
                <Zap className="w-4 h-4" />
                Alocar Automaticamente
              </Button>
              <Button onClick={() => setStep("upload")} variant="outline">
                Voltar
              </Button>
            </div>
          </div>
        )}

        {step === "allocation" && (
          <div className="space-y-6">
            <div className="grid grid-cols-3 gap-4">
              <Card className="p-6 border border-border">
                <div className="flex items-center gap-3">
                  <CheckCircle className="w-8 h-8 text-green-600" />
                  <div>
                    <p className="text-sm text-muted-foreground">Alocados</p>
                    <p className="text-2xl font-bold text-foreground">{allocatedCount}</p>
                  </div>
                </div>
              </Card>
              <Card className="p-6 border border-border">
                <div className="flex items-center gap-3">
                  <AlertCircle className="w-8 h-8 text-yellow-600" />
                  <div>
                    <p className="text-sm text-muted-foreground">Parcial</p>
                    <p className="text-2xl font-bold text-foreground">{partialCount}</p>
                  </div>
                </div>
              </Card>
              <Card className="p-6 border border-border">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center">
                    <span className="text-blue-600 font-bold">%</span>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Taxa</p>
                    <p className="text-2xl font-bold text-foreground">
                      {Math.round((allocatedCount / items.length) * 100)}%
                    </p>
                  </div>
                </div>
              </Card>
            </div>

            <Card className="p-6 border border-border">
              <h3 className="text-lg font-semibold text-foreground mb-4">Detalhes da Alocação</h3>
              <div className="space-y-3">
                {items.map((item) => (
                  <div key={item.id} className="flex items-center justify-between p-3 bg-muted rounded">
                    <div>
                      <p className="font-medium text-foreground">Item #{item.id}</p>
                      <p className="text-sm text-muted-foreground">
                        {item.comprimento}mm × {item.quantidade} unidades
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      {item.status === "alocado" && (
                        <span className="px-3 py-1 bg-green-100 text-green-700 rounded-full text-sm font-medium">
                          ✓ Alocado
                        </span>
                      )}
                      {item.status === "parcial" && (
                        <span className="px-3 py-1 bg-yellow-100 text-yellow-700 rounded-full text-sm font-medium">
                          ⚠ Parcial
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </Card>

            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
              <p className="text-sm text-blue-900">
                <span className="font-semibold">Algoritmo de Prioridade:</span> Retalhos exatos → Barras
                inteiras → Barras de outras obras
              </p>
            </div>

            <div className="flex gap-2">
              <Button className="bg-accent hover:bg-accent/90">Confirmar e Registrar</Button>
              <Button onClick={() => setStep("upload")} variant="outline">
                Novo Plano
              </Button>
            </div>
          </div>
        )}
      </div>
    </StockDashboardLayout>
  );
}
