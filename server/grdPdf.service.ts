/**
 * Geração do PDF final da GRD.
 *
 * A primeira página é produzida a partir do próprio template XLSM por meio do
 * LibreOffice headless. Isso preserva o layout impresso do modelo: logotipo,
 * bordas, fontes, fórmulas, espaçamentos e bloco de assinatura.
 *
 * Os certificados anexados são adicionados depois da primeira página, na mesma
 * ordem em que foram enviados/salvos, reproduzindo o PDF operacional usado
 * como referência.
 */

import { spawn } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import { PDFDocument } from "pdf-lib";
import type { GrdInput, GrdMaterialItem } from "./grd.service";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const TEMPLATE_PATH = path.join(ROOT, "templates", "grd-modelo.xlsm");
const GENERATED_DIR = path.join(ROOT, "generated");
const PYTHON_SCRIPT = path.join(ROOT, "server", "grd_generator.py");

export interface GrdPdfAttachment {
  nomeArquivo: string;
  tipoArquivo: string;
  conteudo: Buffer;
}

export interface GrdPdfOutput {
  buffer: Buffer;
  fileName: string;
}

interface PythonResult {
  outputPath: string;
}

function runProcess(command: string, args: string[], stdin?: string): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (data: Buffer) => { stdout += data.toString(); });
    child.stderr.on("data", (data: Buffer) => { stderr += data.toString(); });
    child.on("error", (error) => reject(error));
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`${command} terminou com código ${code}: ${stderr || stdout}`));
      } else {
        resolve({ stdout, stderr });
      }
    });
    if (stdin !== undefined) {
      child.stdin.write(stdin);
      child.stdin.end();
    } else {
      child.stdin.end();
    }
  });
}

async function gerarXlsmParaPdf(input: GrdInput, workDir: string): Promise<string> {
  const xlsmPath = path.join(workDir, `GRD-${input.numero.padStart(4, "0")}.xlsm`);
  const dataISO = input.data instanceof Date
    ? input.data.toISOString().split("T")[0]
    : String(input.data).split("T")[0];

  const payload = {
    templatePath: TEMPLATE_PATH,
    outputPath: xlsmPath,
    numero: input.numero.padStart(4, "0"),
    data: dataISO,
    cliente: input.cliente,
    obra: input.obra,
    hideDataSheet: true,
    preservePrintLayout: true,
    pdfMode: true,
    materiais: input.materiais.map((m: GrdMaterialItem) => ({
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

  const python = process.platform === "win32" ? "python" : "python3";
  const result = await runProcess(python, [PYTHON_SCRIPT], JSON.stringify(payload));
  let parsed: PythonResult & { error?: string };
  try {
    parsed = JSON.parse(result.stdout.trim());
  } catch {
    throw new Error(`Resposta inesperada do gerador Python: ${result.stdout}`);
  }
  if (parsed.error) throw new Error(parsed.error);

  const pdfDir = path.join(workDir, "pdf");
  fs.mkdirSync(pdfDir, { recursive: true });
  const profileDir = path.join(workDir, "libreoffice-profile");
  fs.mkdirSync(profileDir, { recursive: true });
  const profileUrl = `file://${profileDir.replace(/\\/g, "/")}`;

  try {
    await runProcess("libreoffice", [
      "--headless",
      "--norestore",
      "--nodefault",
      "--nolockcheck",
      "--nofirststartwizard",
      `-env:UserInstallation=${profileUrl}`,
      "--convert-to", "pdf:calc_pdf_Export",
      "--outdir", pdfDir,
      xlsmPath,
    ]);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error("LibreOffice não está instalado no servidor; ele é necessário para imprimir a GRD fielmente ao template XLSM.");
    }
    throw error;
  }

  const pdfPath = path.join(pdfDir, `${path.basename(xlsmPath, ".xlsm")}.pdf`);
  if (!fs.existsSync(pdfPath)) {
    throw new Error(`LibreOffice não gerou o PDF esperado: ${pdfPath}`);
  }
  return pdfPath;
}

async function adicionarAnexo(documento: PDFDocument, attachment: GrdPdfAttachment): Promise<void> {
  const bytes = attachment.conteudo;
  const mime = (attachment.tipoArquivo || "").toLowerCase();

  if (mime === "application/pdf" || bytes.subarray(0, 5).toString("ascii") === "%PDF-") {
    const anexo = await PDFDocument.load(bytes);
    const pages = await documento.copyPages(anexo, anexo.getPageIndices());
    for (const page of pages) documento.addPage(page);
    return;
  }

  if (mime === "image/jpeg" || mime === "image/jpg" || bytes.subarray(0, 3).toString("hex") === "ffd8ff") {
    const image = await documento.embedJpg(bytes);
    const page = documento.addPage([image.width, image.height]);
    page.drawImage(image, { x: 0, y: 0, width: image.width, height: image.height });
    return;
  }

  if (mime === "image/png" || bytes.subarray(0, 8).toString("hex") === "89504e470d0a1a0a") {
    const image = await documento.embedPng(bytes);
    const page = documento.addPage([image.width, image.height]);
    page.drawImage(image, { x: 0, y: 0, width: image.width, height: image.height });
    return;
  }

  throw new Error(`O anexo ${attachment.nomeArquivo} não é um PDF ou imagem compatível.`);
}

export async function gerarGrdPdf(
  input: GrdInput,
  anexos: GrdPdfAttachment[] = [],
): Promise<GrdPdfOutput> {
  if (!fs.existsSync(TEMPLATE_PATH)) {
    throw new Error(`Template não encontrado em: ${TEMPLATE_PATH}`);
  }
  if (!fs.existsSync(PYTHON_SCRIPT)) {
    throw new Error(`Script Python não encontrado em: ${PYTHON_SCRIPT}`);
  }
  fs.mkdirSync(GENERATED_DIR, { recursive: true });

  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "railpack-grd-pdf-"));
  try {
    const templatePdfPath = await gerarXlsmParaPdf(input, workDir);
    const templateDocumento = await PDFDocument.load(fs.readFileSync(templatePdfPath));

    // A cópia temporária contém somente a aba GRD visível, portanto a primeira
    // página exportada pelo LibreOffice é a própria impressão da aba GRD do
    // Excel gerado — sem recorte, redesenho ou redimensionamento posterior.
    if (templateDocumento.getPageCount() !== 1) {
      throw new Error(`A aba GRD foi impressa em ${templateDocumento.getPageCount()} páginas; era esperada exatamente 1.`);
    }

    const documento = templateDocumento;

    for (const anexo of anexos) {
      await adicionarAnexo(documento, anexo);
    }

    const buffer = Buffer.from(await documento.save());
    return {
      buffer,
      fileName: `GRD-${input.numero.padStart(4, "0")}.pdf`,
    };
  } finally {
    fs.rmSync(workDir, { recursive: true, force: true });
  }
}
