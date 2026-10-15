/**
 * pedidoCompra.service.ts
 * Extração de dados de PDF de Pedido de Compra (formato HCM/Mega) — Fase 1
 * da área "Materiais a Chegar" (upload manual; Fase 2 conecta ao e-mail).
 *
 * Mesma estratégia já usada em grd.service.ts: delega a leitura pesada pra
 * um script Python (parse_pedido_compra.py, via pdfplumber), comunicação
 * por JSON no stdout — evita reinventar parsing de PDF em JS.
 */

import { spawn } from "child_process";
import path from "path";
import fs from "fs";
import os from "os";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Mesmo padrão do grd.service.ts: em produção o build (esbuild) gera só o
// dist/index.js, mas o container mantém o checkout completo do repo — o
// .py continua existindo em /app/server/, não em /app/dist/. Por isso o
// caminho sobe uma pasta a partir de __dirname (que em produção aponta pra
// dist/) até a raiz do projeto, e desce de novo em server/.
const ROOT = path.resolve(__dirname, "..");
const PYTHON_SCRIPT = path.join(ROOT, "server", "parse_pedido_compra.py");

export interface PedidoCompraItemExtraido {
  codigo: string | null;
  descricaoOriginal: string;
  categoria: string;
  tipo: string | null;
  bitola: string | null;
  aco: string | null;
  comprimento: number | null;
  quantidadePecas: number | null;
  unidade: string | null;
  pesoTotal: number | null;
  valorUnitario: number | null;
  valorTotalItem: number | null;
}

export interface PedidoCompraExtraido {
  cabecalho: {
    numeroPedido: string | null;
    processoNumero: string | null;
    obraNome: string | null;
    fornecedorNome: string | null;
    fornecedorCnpj: string | null;
    dataEmissao: string | null;
    dataEntregaPrevista: string | null;
    condPagamento: string | null;
    cotacao: string | null;
    valorTotalPedido: number | null;
  };
  itens: PedidoCompraItemExtraido[];
}

export async function extrairPedidoCompraDoPdf(pdfBase64: string): Promise<PedidoCompraExtraido> {
  if (!fs.existsSync(PYTHON_SCRIPT)) {
    throw new Error(
      `Script Python não encontrado em: ${PYTHON_SCRIPT}\n` +
      `Verifique se o arquivo parse_pedido_compra.py está na pasta /server.`
    );
  }

  const tempPath = path.join(os.tmpdir(), `pedido-compra-${Date.now()}-${Math.random().toString(36).slice(2)}.pdf`);
  fs.writeFileSync(tempPath, Buffer.from(pdfBase64, "base64"));

  try {
    return await new Promise((resolve, reject) => {
      const pythonCmd = process.platform === "win32" ? "python" : "python3";
      const child = spawn(pythonCmd, [PYTHON_SCRIPT, tempPath], { stdio: ["pipe", "pipe", "pipe"] });

      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (data: Buffer) => { stdout += data.toString(); });
      child.stderr.on("data", (data: Buffer) => { stderr += data.toString(); });

      child.on("close", (code: number) => {
        if (code !== 0) {
          return reject(new Error(`Erro ao ler o PDF do pedido: ${stderr || `código ${code}`}`));
        }
        try {
          const result = JSON.parse(stdout.trim());
          if (result.erro) return reject(new Error(result.erro));
          resolve(result);
        } catch {
          reject(new Error(`Resposta inesperada do leitor de PDF: ${stdout.slice(0, 500)}`));
        }
      });
    });
  } finally {
    // Arquivo temporário só serve pra essa leitura — sempre limpa, mesmo se der erro.
    try { fs.unlinkSync(tempPath); } catch { /* já pode ter sido removido */ }
  }
}
