import { StockDashboardLayout } from "@/components/StockDashboardLayout";
import { Card } from "@/components/ui/card";
import { LeitorQrPainel } from "@/modules/leitor-qr/LeitorQr";

// Página do leitor — prática pra deixar aberta no celular do pátio ou no
// computador com leitor USB. A leitura abre a Linha do Tempo do material.
export default function LeitorQr() {
  // No celular a câmera já abre direto; no PC o foco fica no campo do leitor USB
  const celular = typeof window !== "undefined" && window.matchMedia("(pointer: coarse)").matches;

  return (
    <StockDashboardLayout>
      <div className="mx-auto max-w-lg space-y-6">
        <div>
          <h2 className="text-2xl font-bold text-foreground md:text-3xl">Leitor de QR</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Leia a etiqueta de um material para ver as informações dele e do pacote
            na linha do tempo.
          </p>
        </div>

        <Card className="p-4 sm:p-5">
          <LeitorQrPainel abrirCameraAoMontar={celular} />
        </Card>
      </div>
    </StockDashboardLayout>
  );
}
