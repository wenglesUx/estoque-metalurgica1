// /modules/separacao-producao/components/CameraQrScanner.tsx
// Leitura de QR code pela câmera ao vivo (celular/tablet). Exige HTTPS — em
// produção (Railway) já é; em localhost o navegador também libera.
//
// A câmera aberta pelo navegador não ajusta foco/resolução sozinha como o
// app de câmera: aqui pedimos foco contínuo e resolução alta, oferecemos
// toque para focar, zoom (pra não precisar encostar o celular na etiqueta,
// abaixo da distância mínima de foco), lanterna e troca de lente.

import { useCallback, useEffect, useRef, useState } from "react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

import { Flashlight, FlashlightOff, Loader2, Video } from "lucide-react";

import { lerRegiaoComJsQr, obterDetectorNativo } from "../qr-decoder";
import { BotaoFotoQr } from "./BotaoFotoQr";

interface CameraQrScannerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onResult: (texto: string) => void;
}

const STORAGE_CAMERA = "separacaoProducao.cameraId";

// Intervalo entre tentativas de leitura (ms) — poupa bateria/CPU
const INTERVALO_LEITURA = 120;

interface FaixaZoom {
  min: number;
  max: number;
  step: number;
}

const lerCameraSalva = () => {
  try {
    return localStorage.getItem(STORAGE_CAMERA) || "";
  } catch {
    return "";
  }
};

export function CameraQrScanner({
  open,
  onOpenChange,
  onResult,
}: CameraQrScannerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const capacidadesRef = useRef<any>({});

  const [aoVivo, setAoVivo] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [iniciando, setIniciando] = useState(true);
  const [cameras, setCameras] = useState<MediaDeviceInfo[]>([]);
  const [cameraId, setCameraId] = useState(lerCameraSalva);
  const [faixaZoom, setFaixaZoom] = useState<FaixaZoom | null>(null);
  const [zoom, setZoom] = useState(1);
  const [temLanterna, setTemLanterna] = useState(false);
  const [lanterna, setLanterna] = useState(false);
  const [focando, setFocando] = useState(false);

  // onResult muda a cada render do pai; o loop usa sempre a versão atual
  const onResultRef = useRef(onResult);
  onResultRef.current = onResult;

  const pararCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  const trilha = () => streamRef.current?.getVideoTracks()[0];

  const aplicar = async (restricoes: Record<string, unknown>) => {
    try {
      await trilha()?.applyConstraints({ advanced: [restricoes as any] });
      return true;
    } catch {
      return false;
    }
  };

  // Reabre ao vivo sempre que o diálogo abrir
  useEffect(() => {
    if (open) setAoVivo(true);
  }, [open]);

  useEffect(() => {
    if (!open || !aoVivo) return;

    let ativo = true;
    let timer = 0;

    setErro(null);
    setIniciando(true);
    setFaixaZoom(null);
    setTemLanterna(false);
    setLanterna(false);

    const finalizar = (texto: string) => {
      ativo = false;
      onResultRef.current(texto);
      onOpenChange(false);
    };

    const analisar = async (tentativa: number) => {
      const video = videoRef.current;

      if (!ativo) return;

      if (video && video.readyState >= video.HAVE_CURRENT_DATA && video.videoWidth > 0) {
        const nativo = await obterDetectorNativo();

        if (!ativo) return;

        if (nativo) {
          try {
            const resultados = await nativo.detect(video);

            if (resultados?.[0]?.rawValue) return finalizar(resultados[0].rawValue);
          } catch {
            // quadro ainda indisponível — tenta no próximo
          }
        } else {
          // Alterna recorte fechado e mais aberto no centro do quadro, em
          // resolução cheia (o QR pequeno precisa de pixels)
          const fracao = tentativa % 2 === 0 ? 0.5 : 0.8;
          const texto = lerRegiaoComJsQr(video, video.videoWidth, video.videoHeight, fracao, 900);

          if (texto) return finalizar(texto);
        }
      }

      if (ativo) timer = window.setTimeout(() => analisar(tentativa + 1), INTERVALO_LEITURA);
    };

    if (!navigator.mediaDevices?.getUserMedia) {
      setErro("Este navegador não permite acessar a câmera ao vivo (é preciso abrir o sistema por HTTPS). Use o botão Foto.");
      setIniciando(false);
      return;
    }

    const video: MediaTrackConstraints = {
      width: { ideal: 1920 },
      height: { ideal: 1080 },
      ...(cameraId
        ? { deviceId: { exact: cameraId } }
        : { facingMode: { ideal: "environment" } }),
    };

    navigator.mediaDevices
      .getUserMedia({ video, audio: false })
      .catch(() =>
        // Câmera salva pode ter sumido (outro aparelho) — volta pra traseira
        navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 } },
          audio: false,
        })
      )
      .then(async (stream) => {
        if (!ativo) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }

        streamRef.current = stream;

        const track = stream.getVideoTracks()[0];
        const capacidades: any = track.getCapabilities?.() ?? {};
        capacidadesRef.current = capacidades;

        if (capacidades.focusMode?.includes("continuous")) {
          await aplicar({ focusMode: "continuous" });
        }

        if (capacidades.zoom && capacidades.zoom.max > capacidades.zoom.min) {
          const faixa = {
            min: capacidades.zoom.min,
            max: capacidades.zoom.max,
            step: capacidades.zoom.step || 0.1,
          };

          // Começa em 2x: dá pra segurar o celular a uma distância em que
          // a lente consegue focar e o QR ainda fica grande na imagem
          const inicial = Math.min(faixa.max, Math.max(faixa.min, 2));

          setFaixaZoom(faixa);
          setZoom(inicial);
          await aplicar({ zoom: inicial });
        }

        setTemLanterna(!!capacidades.torch);

        const el = videoRef.current;

        if (el) {
          el.srcObject = stream;
          el.play().catch(() => {});
        }

        // Os nomes das câmeras só aparecem depois da permissão
        navigator.mediaDevices
          .enumerateDevices()
          .then((lista) => ativo && setCameras(lista.filter((d) => d.kind === "videoinput")))
          .catch(() => {});

        setIniciando(false);
        analisar(0);
      })
      .catch(() => {
        setErro("Não foi possível abrir a câmera. Verifique a permissão do navegador ou use o botão Foto.");
        setIniciando(false);
      });

    return () => {
      ativo = false;
      window.clearTimeout(timer);
      pararCamera();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, aoVivo, cameraId, onOpenChange, pararCamera]);

  // Toque na imagem: pede um novo foco naquele ponto (quando suportado)
  const focarNoToque = async (e: React.MouseEvent<HTMLVideoElement>) => {
    const capacidades = capacidadesRef.current;
    const modos: string[] = capacidades.focusMode ?? [];

    if (!modos.length) return;

    const area = e.currentTarget.getBoundingClientRect();
    const ponto = {
      x: (e.clientX - area.left) / area.width,
      y: (e.clientY - area.top) / area.height,
    };

    setFocando(true);

    if (capacidades.pointsOfInterest !== undefined) {
      await aplicar({ pointsOfInterest: [ponto] });
    }

    if (modos.includes("single-shot")) {
      await aplicar({ focusMode: "single-shot" });
    }

    window.setTimeout(async () => {
      if (modos.includes("continuous")) await aplicar({ focusMode: "continuous" });
      setFocando(false);
    }, 900);
  };

  const trocarCamera = (id: string) => {
    setCameraId(id);

    try {
      localStorage.setItem(STORAGE_CAMERA, id);
    } catch {
      // só não lembra a escolha
    }
  };

  const alternarLanterna = async () => {
    if (await aplicar({ torch: !lanterna })) setLanterna(!lanterna);
  };

  const fecharComResultado = (texto: string) => {
    onResult(texto);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Ler QR code</DialogTitle>
          <DialogDescription>
            Segure a uns 15–20 cm da etiqueta, com o QR dentro do quadro.
            Toque na imagem para focar.
          </DialogDescription>
        </DialogHeader>

        {aoVivo ? (
          <div className="relative aspect-square w-full overflow-hidden rounded-lg bg-black">
            <video
              ref={videoRef}
              className="h-full w-full object-cover"
              muted
              playsInline
              onClick={focarNoToque}
            />

            {iniciando && !erro && (
              <div className="absolute inset-0 flex items-center justify-center text-white">
                <Loader2 className="h-6 w-6 animate-spin" />
              </div>
            )}

            {!iniciando && !erro && (
              <div className={`pointer-events-none absolute inset-[25%] rounded-lg border-2 transition-colors ${focando ? "border-amber-400" : "border-white/80"}`} />
            )}

            {erro && (
              <div className="absolute inset-0 flex items-center justify-center p-6 text-center text-sm text-white">
                {erro}
              </div>
            )}
          </div>
        ) : (
          <div className="flex aspect-square w-full flex-col items-center justify-center gap-3 rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
            Câmera ao vivo pausada para usar a câmera do celular.
            <Button variant="outline" className="gap-2" onClick={() => setAoVivo(true)}>
              <Video className="w-4 h-4" /> Voltar à câmera ao vivo
            </Button>
          </div>
        )}

        {aoVivo && faixaZoom && (
          <div className="flex items-center gap-3">
            <span className="text-[10px] font-bold uppercase text-muted-foreground">Zoom</span>
            <input
              type="range"
              className="flex-1"
              min={faixaZoom.min}
              max={faixaZoom.max}
              step={faixaZoom.step}
              value={zoom}
              onChange={(e) => {
                const valor = Number(e.target.value);
                setZoom(valor);
                aplicar({ zoom: valor });
              }}
            />
            <span className="w-10 text-right text-xs font-medium">{zoom.toFixed(1)}x</span>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2">
          {aoVivo && cameras.length > 1 && (
            <select
              className="h-9 min-w-0 flex-1 rounded-md border border-input bg-background px-2 text-xs"
              value={cameraId || trilha()?.getSettings().deviceId || ""}
              onChange={(e) => trocarCamera(e.target.value)}
            >
              {cameras.map((camera, i) => (
                <option key={camera.deviceId} value={camera.deviceId}>
                  {camera.label || `Câmera ${i + 1}`}
                </option>
              ))}
            </select>
          )}

          {aoVivo && temLanterna && (
            <Button variant="outline" size="icon" onClick={alternarLanterna} title="Lanterna">
              {lanterna ? <FlashlightOff className="w-4 h-4" /> : <Flashlight className="w-4 h-4" />}
            </Button>
          )}

          <BotaoFotoQr
            className="ml-auto"
            onAntesDeAbrir={() => {
              // Alguns celulares não abrem a câmera nativa com a ao vivo ligada
              pararCamera();
              setAoVivo(false);
            }}
            onResult={fecharComResultado}
          />
        </div>

        {aoVivo && cameras.length > 1 && (
          <p className="text-[10px] text-muted-foreground">
            Se a imagem não focar de perto, troque a lente — celulares com várias
            câmeras às vezes abrem a grande-angular, que não foca a curta distância.
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}
