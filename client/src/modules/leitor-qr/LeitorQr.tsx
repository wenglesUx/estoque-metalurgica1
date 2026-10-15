// /modules/leitor-qr/LeitorQr.tsx
// Leitor de QR geral do sistema: lê a etiqueta (leitor USB/Bluetooth, câmera
// ou foto) e abre a Linha do Tempo do material.

import { useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import { toast } from "sonner";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

import { Camera, QrCode } from "lucide-react";

import { lerCodigoMaterial } from "@/modules/labels/qr-material";
import { CameraQrScanner } from "@/modules/separacao-producao/components/CameraQrScanner";
import { BotaoFotoQr } from "@/modules/separacao-producao/components/BotaoFotoQr";

/** Converte a leitura em id e navega; devolve false se o código não é do sistema */
function useAbrirMaterialLido(onAbriu?: () => void) {
  const [, navigate] = useLocation();

  return (texto: string) => {
    const materialId = lerCodigoMaterial(texto);

    if (materialId === null) {
      toast.error("Código não reconhecido. Leia o QR code de uma etiqueta do sistema.");
      return false;
    }

    onAbriu?.();
    navigate(`/linha-do-tempo/${materialId}`);
    return true;
  };
}

interface LeitorQrPainelProps {
  onAbriu?: () => void;
  /** Abre a câmera assim que o painel aparece (página do leitor no celular) */
  abrirCameraAoMontar?: boolean;
}

export function LeitorQrPainel({ onAbriu, abrirCameraAoMontar = false }: LeitorQrPainelProps) {
  const [codigo, setCodigo] = useState("");
  const [cameraAberta, setCameraAberta] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const abrir = useAbrirMaterialLido(onAbriu);

  useEffect(() => {
    // No PC o foco fica no campo, pronto pro leitor USB "digitar"
    inputRef.current?.focus();

    if (abrirCameraAoMontar) setCameraAberta(true);
  }, [abrirCameraAoMontar]);

  const lerDigitado = () => {
    if (!codigo.trim()) return;

    if (!abrir(codigo)) setCodigo("");
  };

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <div className="relative flex-1 min-w-0">
          <QrCode className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            ref={inputRef}
            className="pl-9"
            placeholder="Leitor USB ou código do material"
            value={codigo}
            onChange={(e) => setCodigo(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                lerDigitado();
              }
            }}
          />
        </div>
        <Button variant="outline" className="shrink-0" onClick={lerDigitado}>
          Abrir
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <Button className="h-11 gap-2" onClick={() => setCameraAberta(true)}>
          <Camera className="w-4 h-4" /> Câmera
        </Button>
        <BotaoFotoQr className="h-11" onResult={abrir} />
      </div>

      <CameraQrScanner
        open={cameraAberta}
        onOpenChange={setCameraAberta}
        onResult={abrir}
      />
    </div>
  );
}

interface LeitorQrDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function LeitorQrDialog({ open, onOpenChange }: LeitorQrDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <QrCode className="w-5 h-5" /> Ler etiqueta
          </DialogTitle>
          <DialogDescription>
            Leia o QR code da etiqueta para abrir a linha do tempo do material.
          </DialogDescription>
        </DialogHeader>

        {open && <LeitorQrPainel onAbriu={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  );
}

/** Botão do cabeçalho — leitor acessível de qualquer página */
export function BotaoLeitorQr() {
  const [aberto, setAberto] = useState(false);

  return (
    <>
      <button
        type="button"
        aria-label="Ler QR code da etiqueta"
        title="Ler QR code da etiqueta"
        onClick={() => setAberto(true)}
        className="flex shrink-0 items-center gap-2 rounded-xl p-2.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      >
        <QrCode className="w-5 h-5" />
        <span className="hidden text-sm font-medium xl:inline">Ler QR</span>
      </button>

      <LeitorQrDialog open={aberto} onOpenChange={setAberto} />
    </>
  );
}
