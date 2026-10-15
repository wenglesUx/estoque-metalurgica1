import { PermissionGate } from "@/components/PermissionGate";
import { StockDashboardLayout } from "@/components/StockDashboardLayout";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Upload, FileText, AlertCircle, CheckCircle, XCircle } from "lucide-react";
import { useState, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import * as XLSX from "xlsx";
import { trpc } from "@/lib/trpc";

interface ImportPreview {
  file: File;
  rows: Array<Record<string, any>>;
  columnMapping: Record<string, string>;
  headers: string[];
}

interface ImportResult {
  total: number;
  erros: string[];
}

export default function Importacao() {
  const [step, setStep] = useState<"upload" | "mapping" | "preview" | "complete">("upload");
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [columnMapping, setColumnMapping] = useState<Record<string, string>>({});
  const [isDragging, setIsDragging] = useState(false);
  const [resultado, setResultado] = useState<ImportResult | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();

  const importMutation = trpc.importacao.processarExcel.useMutation();

  const requiredFields = [
    { key: "tipo",       label: "TIPO",       required: true },
    { key: "bitola",     label: "BITOLA",     required: true },
    { key: "quantidade", label: "QTD",        required: false },
    { key: "comprimento",label: "COMPR",      required: false },
    { key: "aco",        label: "AÇO",        required: false },
    { key: "obra",       label: "OBRA",       required: false },
    { key: "local",      label: "LOCAL",      required: false },
    { key: "fornecedor", label: "FORNECEDOR", required: false },
    { key: "nf",         label: "NF",         required: false },
    { key: "corrida",    label: "CORRIDA",    required: false },
    { key: "numeroCertificado", label: "CERTIFICADO", required: false },
  ];

  const baixarModelo = () => {
    const headers = requiredFields.map(f => f.label);
    // Uma linha de exemplo, só pra ilustrar o formato esperado — o usuário apaga depois.
    const linhaExemplo = ["W", "150X13", "10", "6000", "A36", "Nome da Obra ou vazio para Livre", "ESTOQUE", "Fornecedor Exemplo", "12345", "AB123", "CERT-001"];
    const planilha = XLSX.utils.aoa_to_sheet([headers, linhaExemplo]);
    planilha["!cols"] = headers.map(() => ({ wch: 18 }));
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, planilha, "Materiais");
    XLSX.writeFile(workbook, "modelo_importacao_materiais.xlsx");
    toast.success("Modelo baixado — preencha e volte pra subir o arquivo.");
  };

  const readExcelFile = async (file: File) => {
    try {
      const arrayBuffer = await file.arrayBuffer();
      const workbook = XLSX.read(arrayBuffer, { type: "array" });
      const worksheet = workbook.Sheets[workbook.SheetNames[0]];
      if (!worksheet) { toast.error("Nenhuma planilha encontrada"); return; }

      const data = XLSX.utils.sheet_to_json(worksheet, { defval: "" }) as Record<string, any>[];
      if (!data.length) { toast.error("Planilha vazia"); return; }

      const headers = Object.keys(data[0]);

      // Auto-mapeamento: compara ignorando maiúsculas/espaços/acentos
      const normalize = (s: string) => s.toUpperCase().trim()
        .replace(/[ÇÃÀÁÂÄç]/g, "C").replace(/[ÕÔÓÒÖõôóòö]/g, "O")
        .replace(/[ÉÊÈËéêèë]/g, "E").replace(/[ÍÎÌÏíîìï]/g, "I")
        .replace(/[ÚÛÙÜúûùü]/g, "U").replace(/[Ãã]/g, "A");

      const autoMapping: Record<string, string> = {};
      requiredFields.forEach(field => {
        const match = headers.find(h =>
          normalize(h) === normalize(field.label) ||
          normalize(h).includes(normalize(field.key)) ||
          normalize(h).includes(normalize(field.label))
        );
        if (match) autoMapping[field.key] = match;
      });

      setPreview({ file, rows: data, columnMapping: {}, headers });
      setColumnMapping(autoMapping);
      setStep("mapping");
    } catch (error) {
      toast.error("Erro ao processar arquivo. Verifique se é um Excel válido.");
    }
  };

  const handleImport = async () => {
    if (!preview) return;

    // Validar campos obrigatórios mapeados
    const missing = requiredFields.filter(f => f.required && !columnMapping[f.key]);
    if (missing.length > 0) {
      toast.error(`Mapeie os campos obrigatórios: ${missing.map(f => f.label).join(", ")}`);
      return;
    }

    // Converter linhas usando o mapeamento — só inclui campos realmente mapeados
    const processedRows = preview.rows.map((row, idx) => {
      const processed: Record<string, any> = {};
      Object.entries(columnMapping).forEach(([key, header]) => {
        if (!header) return; // campo não mapeado — pular
        const val = row[header];
        // Ignorar undefined/null/string vazia
        if (val === undefined || val === null || val === "") return;
        processed[key] = val;
      });
      return processed;
    });

    // Remover linhas completamente vazias
    const linhasValidas = processedRows.filter(r => r.tipo || r.bitola);

    if (!linhasValidas.length) {
      toast.error("Nenhuma linha válida encontrada. Verifique o mapeamento.");
      return;
    }

    try {
      const res = await importMutation.mutateAsync({ dados: linhasValidas });

      // Atualizar cache do tRPC para a página de materiais
      queryClient.invalidateQueries({ queryKey: [["materiais", "list"]] });

      setResultado({ total: res.total, erros: res.erros });
      setStep("complete");

      if (res.erros.length > 0) {
        toast.warning(`${res.total} importados, ${res.erros.length} com erro`);
      } else {
        toast.success(`${res.total} materiais importados com sucesso!`);
      }
    } catch (error: any) {
      toast.error(`Erro na importação: ${error.message}`);
    }
  };

  const resetar = () => {
    setStep("upload");
    setPreview(null);
    setColumnMapping({});
    setResultado(null);
  };

  return (
    <StockDashboardLayout>
      <div className="space-y-8">
        <div>
          <h2 className="text-3xl font-bold text-foreground">Importar Planilha</h2>
          <p className="text-muted-foreground mt-1">
            Importe materiais em lote via Excel. Campos obrigatórios: <strong>TIPO</strong> e <strong>BITOLA</strong>.
          </p>
        </div>

        {/* Indicador de etapas */}
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          {["Upload", "Mapeamento", "Preview", "Concluído"].map((label, i) => {
            const steps = ["upload", "mapping", "preview", "complete"];
            const current = steps.indexOf(step);
            const active = i === current;
            const done = i < current;
            return (
              <span key={label} className="flex items-center gap-2">
                <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${active ? "bg-accent text-white" : done ? "bg-green-500 text-white" : "bg-muted text-muted-foreground"}`}>
                  {done ? "✓" : i + 1}
                </span>
                <span className={active ? "text-foreground font-medium" : ""}>{label}</span>
                {i < 3 && <span className="text-muted-foreground/40">→</span>}
              </span>
            );
          })}
        </div>

        {/* ETAPA 1: Upload */}
        {step === "upload" && (
          <div className="space-y-4">
            <div className="flex justify-end">
              <Button type="button" variant="outline" onClick={baixarModelo} className="gap-2">
                <FileText className="w-4 h-4" /> Baixar Modelo de Planilha
              </Button>
            </div>
            <Card
            className={`p-12 border-2 border-dashed text-center cursor-pointer transition-colors ${isDragging ? "border-accent bg-accent/5" : "border-border hover:border-accent/50"}`}
            onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={(e) => { e.preventDefault(); setIsDragging(false); const f = e.dataTransfer.files[0]; if (f) readExcelFile(f); }}
            onClick={() => fileInputRef.current?.click()}
          >
            <Upload className="w-16 h-16 mx-auto mb-4 text-muted-foreground" />
            <h3 className="text-lg font-semibold mb-2">Arraste sua planilha Excel aqui</h3>
            <p className="text-sm text-muted-foreground mb-4">ou clique para selecionar o arquivo</p>
            <p className="text-xs text-muted-foreground">Suporta .xlsx, .xls, .csv</p>
            <input
              ref={fileInputRef}
              type="file"
              className="hidden"
              accept=".xlsx,.xls,.csv"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) readExcelFile(f); }}
            />
            </Card>
          </div>
        )}

        {/* ETAPA 2: Mapeamento */}
        {step === "mapping" && preview && (
          <Card className="p-6 space-y-6">
            <div>
              <h3 className="text-lg font-semibold">Mapeamento de Colunas</h3>
              <p className="text-sm text-muted-foreground mt-1">
                Associe cada campo do sistema à coluna correspondente na sua planilha.
                Colunas detectadas: <strong>{preview.headers.join(", ")}</strong>
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {requiredFields.map((field) => (
                <div key={field.key}>
                  <label className="text-sm font-medium block mb-1">
                    {field.label}
                    {field.required && <span className="text-red-500 ml-1">*</span>}
                  </label>
                  <select
                    value={columnMapping[field.key] || ""}
                    onChange={(e) => setColumnMapping({ ...columnMapping, [field.key]: e.target.value })}
                    className={`w-full p-2 border rounded bg-background text-sm ${field.required && !columnMapping[field.key] ? "border-red-300" : "border-input"}`}
                  >
                    <option value="">-- Não importar --</option>
                    {preview.headers.map(h => <option key={h} value={h}>{h}</option>)}
                  </select>
                </div>
              ))}
            </div>

            <div className="flex gap-2">
              <Button onClick={() => setStep("preview")} className="bg-accent">
                Próximo → Preview
              </Button>
              <Button onClick={resetar} variant="outline">Voltar</Button>
            </div>
          </Card>
        )}

        {/* ETAPA 3: Preview */}
        {step === "preview" && preview && (
          <Card className="p-6 space-y-6">
            <div className="flex items-center gap-2 text-blue-700 bg-blue-50 p-4 rounded-lg border border-blue-200">
              <AlertCircle className="w-5 h-5 flex-shrink-0" />
              <span>
                <strong>{preview.rows.length} linhas</strong> prontas para importação.
                Veja abaixo as primeiras 5 como ficará no sistema.
              </span>
            </div>

            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="w-full text-sm">
                <thead className="bg-muted">
                  <tr>
                    <th className="p-2 text-left text-xs font-bold uppercase text-muted-foreground">#</th>
                    {requiredFields.filter(f => columnMapping[f.key]).map(f => (
                      <th key={f.key} className="p-2 text-left text-xs font-bold uppercase text-muted-foreground">
                        {f.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {preview.rows.slice(0, 5).map((row, i) => (
                    <tr key={i} className="hover:bg-muted/30">
                      <td className="p-2 text-muted-foreground text-xs">{i + 1}</td>
                      {requiredFields.filter(f => columnMapping[f.key]).map(f => (
                        <td key={f.key} className="p-2">
                          {String(row[columnMapping[f.key]] ?? "-")}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
              {preview.rows.length > 5 && (
                <div className="p-2 text-center text-xs text-muted-foreground bg-muted/30">
                  ... e mais {preview.rows.length - 5} linhas
                </div>
              )}
            </div>

            <div className="flex gap-2">
              <PermissionGate permission="importacao:executar">
              <Button
                onClick={handleImport}
                disabled={importMutation.isPending}
                className="bg-accent hover:bg-accent/90 gap-2"
              >
                {importMutation.isPending ? (
                  <><span className="animate-spin">⟳</span> Importando {preview.rows.length} itens...</>
                ) : (
                  <>Confirmar Importação ({preview.rows.length} itens)</>
                )}
              </Button>
              </PermissionGate>
              <Button onClick={() => setStep("mapping")} variant="outline" disabled={importMutation.isPending}>
                Voltar
              </Button>
            </div>
          </Card>
        )}

        {/* ETAPA 4: Concluído */}
        {step === "complete" && resultado && (
          <Card className="p-12 text-center space-y-6">
            {resultado.total > 0 ? (
              <CheckCircle className="w-16 h-16 mx-auto text-green-500" />
            ) : (
              <XCircle className="w-16 h-16 mx-auto text-red-500" />
            )}

            <div>
              <h3 className="text-2xl font-bold mb-2">
                {resultado.total > 0 ? "Importação Concluída!" : "Nenhum item importado"}
              </h3>
              <p className="text-muted-foreground text-lg">
                <strong className="text-green-600">{resultado.total}</strong> {resultado.total === 1 ? "material importado" : "materiais importados"} com sucesso.
              </p>
            </div>

            {resultado.erros.length > 0 && (
              <div className="text-left max-w-2xl mx-auto bg-red-50 border border-red-200 rounded-lg p-4">
                <p className="font-semibold text-red-700 mb-2 flex items-center gap-2">
                  <XCircle className="w-4 h-4" />
                  {resultado.erros.length} {resultado.erros.length === 1 ? "erro encontrado" : "erros encontrados"}:
                </p>
                <ul className="space-y-1 max-h-48 overflow-y-auto">
                  {resultado.erros.map((err, i) => (
                    <li key={i} className="text-sm text-red-600 flex gap-2">
                      <span className="text-red-400 flex-shrink-0">•</span>
                      {err}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="flex gap-3 justify-center">
              <Button onClick={resetar} className="bg-accent">
                Importar Outra Planilha
              </Button>
              <Button variant="outline" onClick={() => window.location.href = "/materiais"}>
                Ver Materiais
              </Button>
            </div>
          </Card>
        )}
      </div>
    </StockDashboardLayout>
  );
}


interface ImportPreview {
  file: File;
  rows: Array<Record<string, any>>;
  columnMapping: Record<string, string>;
  headers: string[];
}

// export default function Importacao() {
//   const [step, setStep] = useState<"upload" | "mapping" | "preview" | "complete">("upload");
//   const [preview, setPreview] = useState<ImportPreview | null>(null);
//   const [columnMapping, setColumnMapping] = useState<Record<string, string>>({});
//   const [isDragging, setIsDragging] = useState(false);
//   const [importedCount, setImportedCount] = useState(0);
//   const [erros, setErros] = useState<string[]>([]);
//   const fileInputRef = useRef<HTMLInputElement>(null);
//   const queryClient = useQueryClient();
//   const importMutation = trpc.importacao.processarExcel.useMutation({
//     onSuccess: (res) => {
//       queryClient.invalidateQueries(["materiais", "list"]);
//       if (res.erros.length > 0) {
//         toast.warning(`${res.total} importados, ${res.erros.length} com erro`);
//         setErros(res.erros);
//       } else {
//         toast.success(`${res.total} materiais importados com sucesso`);
//       }
//     },
//     onError: (error) => {
//       toast.error(`Erro na importação: ${error.message}`);
//       setErros([error.message]);
//     },
//   });

//   const requiredFields = [
//     { key: "tipo", label: "TIPO" },
//     { key: "bitola", label: "BITOLA" },
//     { key: "quantidade", label: "QTD" },
//     { key: "comprimento", label: "COMPR" },
//     { key: "aco", label: "AÇO" },
//     { key: "obra", label: "OBRA" },
//     { key: "local", label: "LOCAL" }
//   ];

//   const readExcelFile = async (file: File) => {
//     try {
//       const arrayBuffer = await file.arrayBuffer();
//       const workbook = XLSX.read(arrayBuffer, { type: "array" });
//       const worksheet = workbook.Sheets[workbook.SheetNames[0]];
      
//       if (!worksheet) {
//         toast.error("Nenhuma planilha encontrada");
//         return;
//       }

//       const data = XLSX.utils.sheet_to_json(worksheet, { defval: "" }) as Record<string, any>[];
//       const headers = Object.keys(data[0] || {});

//       setPreview({
//         file,
//         rows: data,
//         columnMapping: {},
//         headers,
//       });

//       // Auto-mapeamento baseado nos nomes da planilha do usuário
//       const autoMapping: Record<string, string> = {};
//       requiredFields.forEach(field => {
//         const matchedHeader = headers.find(h => 
//           h.toUpperCase() === field.label.toUpperCase() ||
//           h.toUpperCase().includes(field.label.toUpperCase())
//         );
//         if (matchedHeader) autoMapping[field.key] = matchedHeader;
//       });

//       setColumnMapping(autoMapping);
//       setStep("mapping");
//     } catch (error) {
//       toast.error("Erro ao processar arquivo");
//     }
//   };

//   const handleImport = async () => {
//     if (!preview) return;

//     try {
//       // Mapear as linhas para o formato que o servidor espera (chaves internas)
//       const processedRows = preview.rows.map(row => {
//         const processed: Record<string, any> = {};
//         Object.entries(columnMapping).forEach(([key, header]) => {
//           processed[key] = row[header];
//         });
//         return processed;
//       });

//       await importMutation.mutateAsync({
//         dados: processedRows,
//       });
//       setStep("complete");
//     } catch (error) {
//       toast.error("Erro na importação");
//     }
//   };

//   return (
//     <StockDashboardLayout>
//       <div className="space-y-8">
//         <div>
//           <h2 className="text-3xl font-bold text-foreground">Importar Planilha</h2>
//           <p className="text-muted-foreground mt-1">Siga o padrão: TIPO | BITOLA | QTD | COMPR | AÇO | OBRA | LOCAL</p>
//         </div>

//         {step === "upload" && (
//           <Card
//             className={`p-12 border-2 border-dashed text-center ${isDragging ? "border-accent bg-accent/5" : "border-border"}`}
//             onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
//             onDragLeave={() => setIsDragging(false)}
//             onDrop={(e) => { e.preventDefault(); setIsDragging(false); readExcelFile(e.dataTransfer.files[0]); }}
//           >
//             <Upload className="w-16 h-16 mx-auto mb-4 text-muted-foreground" />
//             <h3 className="text-lg font-semibold mb-2">Arraste sua planilha Excel</h3>
//             <input ref={fileInputRef} type="file" className="hidden" onChange={(e) => e.target.files?.[0] && readExcelFile(e.target.files[0])} />
//             <Button onClick={() => fileInputRef.current?.click()} className="bg-accent">Selecionar Arquivo</Button>
//           </Card>
//         )}

//         {step === "mapping" && preview && (
//           <Card className="p-6 space-y-6">
//             <h3 className="text-lg font-semibold">Confirmar Mapeamento de Colunas</h3>
//             <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
//               {requiredFields.map((field) => (
//                 <div key={field.key}>
//                   <label className="text-sm font-medium block mb-2">{field.label}</label>
//                   <select
//                     value={columnMapping[field.key] || ""}
//                     onChange={(e) => setColumnMapping({ ...columnMapping, [field.key]: e.target.value })}
//                     className="w-full p-2 border rounded bg-background"
//                   >
//                     <option value="">-- Selecione --</option>
//                     {preview.headers.map(h => <option key={h} value={h}>{h}</option>)}
//                   </select>
//                 </div>
//               ))}
//             </div>
//             <div className="flex gap-2">
//               <Button onClick={() => setStep("preview")} className="bg-accent">Próximo</Button>
//               <Button onClick={() => setStep("upload")} variant="outline">Voltar</Button>
//             </div>
//           </Card>
//         )}

//         {step === "preview" && preview && (
//           <Card className="p-6 space-y-6">
//             <div className="flex items-center gap-2 text-blue-600 bg-blue-50 p-4 rounded">
//               <AlertCircle className="w-5 h-5" />
//               <span>{preview.rows.length} linhas prontas para importação.</span>
//             </div>
//             <div className="overflow-x-auto">
//               <table className="w-full text-sm">
//                 <thead className="bg-muted">
//                   <tr>
//                     {requiredFields.map(f => <th key={f.key} className="p-2 text-left">{f.label}</th>)}
//                   </tr>
//                 </thead>
//                 <tbody>
//                   {preview.rows.slice(0, 5).map((row, i) => (
//                     <tr key={i} className="border-b">
//                       {requiredFields.map(f => <td key={f.key} className="p-2">{row[columnMapping[f.key]] || "-"}</td>)}
//                     </tr>
//                   ))}
//                 </tbody>
//               </table>
//             </div>
//             <div className="flex gap-2">
//               <Button onClick={handleImport} disabled={importMutation.isPending} className="bg-accent">
//                 {importMutation.isPending ? "Processando..." : "Confirmar Importação"}
//               </Button>
//               <Button onClick={() => setStep("mapping")} variant="outline">Voltar</Button>
//             </div>
//           </Card>
//         )}

//         {step === "complete" && (
//           <Card className="p-12 text-center">
//             <CheckCircle className="w-16 h-16 mx-auto mb-4 text-green-600" />
//             <h3 className="text-2xl font-bold mb-2">Sucesso!</h3>
//             {erros.length > 0 ? (
//               <div className="text-red-600 mb-6">
//                 <p>{importedCount} itens foram adicionados com sucesso, mas ocorreram erros em {erros.length} linhas:</p>
//                 <ul className="list-disc list-inside text-left mx-auto w-fit mt-2">
//                   {erros.map((err, index) => (
//                     <li key={index}>{err}</li>
//                   ))}
//                 </ul>
//               </div>
//             ) : (
//               <p className="text-muted-foreground mb-6">{importedCount} itens foram adicionados ao estoque.</p>
//             )}
//             <Button onClick={() => setStep("upload")} className="bg-accent">Importar Outra</Button>
//           </Card>
//         )}
//       </div>
//     </StockDashboardLayout>
//   );
// }
