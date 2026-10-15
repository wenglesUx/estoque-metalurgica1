// /modules/separacao-producao/components/BotaoFotoQr.tsx
// Abre a câmera normal do celular (com o foco automático dela), tira a foto
// e lê o QR da imagem.

import { useRef, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { ImagePlus, Loader2 } from "lucide-react";

import { lerQrDeFoto } from "../qr-decoder";

interface BotaoFotoQrProps {
  onResult: (texto: string) => void;
  /** Chamado antes de abrir a câmera — ex: liberar a câmera ao vivo */
  onAntesDeAbrir?: () => void;
  variant?: "default" | "outline";
  className?: string;
}

export function BotaoFotoQr({
  onResult,
  onAntesDeAbrir,
  variant = "outline",
  className,
}: BotaoFotoQrProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [lendo, setLendo] = useState(false);

  const lerArquivo = async (arquivo: File | undefined) => {
    if (!arquivo) return;

    setLendo(true);

    try {
      const texto = await lerQrDeFoto(arquivo);

      if (texto) onResult(texto);
      else toast.error("QR code não encontrado na foto. Tire de novo, mais perto e com o QR no centro.");
    } catch {
      toast.error("Não foi possível abrir a foto.");
    } finally {
      setLendo(false);
    }
  };

  return (
    <>
      <Button
        type="button"
        variant={variant}
        className={`gap-2 ${className ?? ""}`}
        disabled={lendo}
        onClick={() => {
          onAntesDeAbrir?.();
          inputRef.current?.click();
        }}
      >
        {lendo ? <Loader2 className="w-4 h-4 animate-spin" /> : <ImagePlus className="w-4 h-4" />}
        {lendo ? "Lendo foto..." : "Foto"}
      </Button>

      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => {
          lerArquivo(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
    </>
  );
}
