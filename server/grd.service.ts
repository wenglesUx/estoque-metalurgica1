/**
 * grd.service.ts
 * Serviço de geração de GRD (Guia de Remessa de Documentos)
 *
 * Estratégia:
 *  - Delega a geração do .xlsm para um script Python (grd_generator.py) via child_process.
 *  - O Python usa openpyxl com keep_vba=True, que preserva corretamente o vbaProject.bin
 *    e o Content_Types.xml com o tipo "macroEnabled" — resolvendo o erro de arquivo corrompido
 *    que ocorria ao usar ExcelJS diretamente (que não preserva o flag macroEnabled).
 *  - Comunicação: payload JSON via stdin → resultado JSON via stdout.
 *
 * Mapeamento confirmado pela inspeção do template:
 *   Aba "Dados":
 *     Linha 1: título "GRD"   (não tocar)
 *     Linha 2: cabeçalhos     (não tocar)
 *     Linha 3+: dados dos materiais
 *       A = Certif N°   B = TIPO   C = BITOLA   D = COMP (mm)
 *       E = largura (vazio)   F = qntd   G = Unid   H = aço   I = NF
 *
 *   Aba "GRD " (nome com espaço):
 *     I1  = "RELATÓRIO: <numero>"
 *     J2  = data (Date object)
 *     A7  = "CLIENTE: <cliente>"
 *     F7  = "OBRA:  <obra>"
 */

import { spawn } from "child_process";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

const TEMPLATE_PATH = path.join(ROOT, "templates", "grd-modelo.xlsm");
const GENERATED_DIR = path.join(ROOT, "generated");
const PYTHON_SCRIPT = path.join(ROOT, "server", "grd_generator.py");

// Garante que o diretório de saída existe
if (!fs.existsSync(GENERATED_DIR)) {
  fs.mkdirSync(GENERATED_DIR, { recursive: true });
}

// ─── Tipos ────────────────────────────────────────────────────────────────────

export interface GrdMaterialItem {
  certificado: string;
  tipo: string;
  bitola: string;
  comprimento: number;
  largura?: string;
  quantidade: number;
  unidade: string;
  aco: string;
  nf: string;
}

export interface GrdInput {
  numero: string;
  data: Date;
  cliente: string;
  obra: string;
  materiais: GrdMaterialItem[];
}

export interface GrdOutput {
  filePath: string;
  fileName: string;
  buffer: Buffer;
}

// ─── Geração do arquivo via Python ───────────────────────────────────────────

function runPythonGenerator(payload: object): Promise<{ outputPath: string }> {
  return new Promise((resolve, reject) => {
    const pythonCmd = process.platform === "win32" ? "python" : "python3";

    const child = spawn(pythonCmd, [PYTHON_SCRIPT], {
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (data: Buffer) => { stdout += data.toString(); });
    child.stderr.on("data", (data: Buffer) => { stderr += data.toString(); });

    child.on("close", (code: number) => {
      if (code !== 0) {
        return reject(new Error(`Erro ao gerar GRD: ${stderr || `código ${code}`}`));
      }
      try {
        const result = JSON.parse(stdout.trim());
        if (result.error) return reject(new Error(result.error));
        resolve(result);
      } catch {
        reject(new Error(`Resposta inesperada do gerador Python: ${stdout}`));
      }
    });

    child.on("error", (err: Error) => {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        reject(new Error(
          `Python não encontrado. Instale Python 3 e o pacote openpyxl:\n  pip install openpyxl`
        ));
      } else {
        reject(err);
      }
    });

    child.stdin.write(JSON.stringify(payload));
    child.stdin.end();
  });
}

export async function gerarGrd(input: GrdInput): Promise<GrdOutput> {
  if (!fs.existsSync(TEMPLATE_PATH)) {
    throw new Error(
      `Template não encontrado em: ${TEMPLATE_PATH}\n` +
      `Coloque o arquivo grd-modelo.xlsm na pasta /templates do projeto.`
    );
  }

  if (!fs.existsSync(PYTHON_SCRIPT)) {
    throw new Error(
      `Script Python não encontrado em: ${PYTHON_SCRIPT}\n` +
      `Verifique se o arquivo grd_generator.py está na pasta /server.`
    );
  }

  const fileName = `GRD-${input.numero.padStart(4, "0")}.xlsm`;
  const filePath = path.join(GENERATED_DIR, fileName);

  const dataISO = input.data instanceof Date
    ? input.data.toISOString().split("T")[0]
    : String(input.data).split("T")[0];

  const payload = {
    templatePath: TEMPLATE_PATH,
    outputPath: filePath,
    numero: input.numero.padStart(4, "0"),
    data: dataISO,
    cliente: input.cliente,
    obra: input.obra,
    materiais: input.materiais.map((m) => ({
      certificado: m.certificado ?? "",
      tipo: m.tipo,
      bitola: m.bitola,
      comprimento: m.comprimento,
      largura: m.largura ?? "",
      quantidade: m.quantidade,
      unidade: m.unidade ?? "PÇ",
      aco: m.aco,
      nf: m.nf ?? "",
    })),
  };

  await runPythonGenerator(payload);

  const buffer = fs.readFileSync(filePath);
  return { filePath, fileName, buffer };
}

// ─── Histórico de GRDs geradas ────────────────────────────────────────────────
// Nota: o próximo número da GRD agora é calculado a partir do banco de dados
// (tabela grds_geradas, via db.obterProximoNumeroGrdDb) — a versão antiga
// lia a pasta local /generated, que é apagada a cada deploy da Railway,
// o que podia fazer a numeração reiniciar ou repetir sem aviso.
