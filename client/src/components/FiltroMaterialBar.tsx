import { Search, SlidersHorizontal, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useState } from "react";
import type { FiltroMaterialState } from "@/hooks/useFiltroMaterial";

interface FiltroMaterialBarProps {
  filtro: FiltroMaterialState;
  setFiltro: (update: Partial<FiltroMaterialState>) => void;
  resetFiltro: () => void;
  temFiltroAtivo: boolean;
  totalFiltrado: number;
  totalGeral: number;
  tiposDisponiveis?: string[];
  acosDisponiveis?: string[];
  obrasDisponiveis?: string[];
  fornecedoresDisponiveis?: string[];
  /** Quais filtros dedicados mostrar. Padrão: todos */
  campos?: Array<"tipo" | "aco" | "obra" | "local" | "fornecedor" | "comprimento">;
  onChangePage?: () => void;
}

export function FiltroMaterialBar({
  filtro,
  setFiltro,
  resetFiltro,
  temFiltroAtivo,
  totalFiltrado,
  totalGeral,
  tiposDisponiveis = [],
  acosDisponiveis = [],
  obrasDisponiveis = [],
  fornecedoresDisponiveis = [],
  campos = ["tipo", "aco", "obra", "local", "fornecedor", "comprimento"],
  onChangePage,
}: FiltroMaterialBarProps) {
  const [expandido, setExpandido] = useState(false);

  const onChange = (update: Partial<FiltroMaterialState>) => {
    setFiltro(update);
    onChangePage?.();
  };

  const onReset = () => {
    resetFiltro();
    onChangePage?.();
  };

  return (
    <div className="space-y-3">
      {/* Linha principal — busca livre + botão expandir */}
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Buscar por tipo, bitola, aço, NF, certificado, corrida, obra, local, fornecedor..."
            value={filtro.texto}
            onChange={e => onChange({ texto: e.target.value })}
            className="pl-9 pr-4"
          />
        </div>

        <Button
          variant={expandido ? "default" : "outline"}
          size="sm"
          className="gap-1.5 shrink-0"
          onClick={() => setExpandido(v => !v)}
        >
          <SlidersHorizontal className="w-4 h-4" />
          <span className="hidden sm:inline">Filtros</span>
          {temFiltroAtivo && (
            <span className="w-2 h-2 rounded-full bg-accent inline-block" />
          )}
        </Button>

        {temFiltroAtivo && (
          <Button variant="ghost" size="sm" onClick={onReset} className="gap-1 text-muted-foreground shrink-0">
            <X className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Limpar</span>
          </Button>
        )}
      </div>

      {/* Filtros expandidos */}
      {expandido && (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-2 p-3 bg-muted/30 rounded-lg border border-border">
          {campos.includes("tipo") && (
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground font-medium">Tipo</label>
              <Select
                value={filtro.tipo || "__all__"}
                onValueChange={v => onChange({ tipo: v === "__all__" ? "" : v })}
              >
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue placeholder="Todos" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">Todos</SelectItem>
                  {tiposDisponiveis.map(t => (
                    <SelectItem key={t} value={t}>{t}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {campos.includes("aco") && (
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground font-medium">Aço</label>
              {acosDisponiveis.length > 0 ? (
                <Select
                  value={filtro.aco || "__all__"}
                  onValueChange={v => onChange({ aco: v === "__all__" ? "" : v })}
                >
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue placeholder="Todos" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__all__">Todos</SelectItem>
                    {acosDisponiveis.map(a => (
                      <SelectItem key={a} value={a}>{a}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <Input
                  value={filtro.aco}
                  onChange={e => onChange({ aco: e.target.value })}
                  placeholder="Ex: CA-50"
                  className="h-8 text-xs"
                />
              )}
            </div>
          )}

          {campos.includes("obra") && (
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground font-medium">Obra</label>
              {obrasDisponiveis.length > 0 ? (
                <Select
                  value={filtro.obra || "__all__"}
                  onValueChange={v => onChange({ obra: v === "__all__" ? "" : v })}
                >
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue placeholder="Todas" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__all__">Todas</SelectItem>
                    <SelectItem value="LIVRE">Livre</SelectItem>
                    {obrasDisponiveis.map(o => (
                      <SelectItem key={o} value={o}>{o}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <Input
                  value={filtro.obra}
                  onChange={e => onChange({ obra: e.target.value })}
                  placeholder="Nome ou código"
                  className="h-8 text-xs"
                />
              )}
            </div>
          )}

          {campos.includes("local") && (
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground font-medium">Local / Rua / Vão</label>
              <Input
                value={filtro.local}
                onChange={e => onChange({ local: e.target.value })}
                placeholder="Ex: Rua A, Vão 3"
                className="h-8 text-xs"
              />
            </div>
          )}

          {campos.includes("fornecedor") && (
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground font-medium">Fornecedor</label>
              {fornecedoresDisponiveis.length > 0 ? (
                <Select
                  value={filtro.fornecedor || "__all__"}
                  onValueChange={v => onChange({ fornecedor: v === "__all__" ? "" : v })}
                >
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue placeholder="Todos" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__all__">Todos</SelectItem>
                    {fornecedoresDisponiveis.map(f => (
                      <SelectItem key={f} value={f}>{f}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <Input
                  value={filtro.fornecedor}
                  onChange={e => onChange({ fornecedor: e.target.value })}
                  placeholder="Nome do fornecedor"
                  className="h-8 text-xs"
                />
              )}
            </div>
          )}

          {campos.includes("comprimento") && (
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground font-medium">Comprimento (mm)</label>
              <Input
                value={filtro.comprimento}
                onChange={e => onChange({ comprimento: e.target.value })}
                placeholder="Ex: 12000"
                className="h-8 text-xs"
                type="number"
              />
            </div>
          )}
        </div>
      )}

      {/* Contador de resultados */}
      {temFiltroAtivo && (
        <p className="text-xs text-muted-foreground">
          {totalFiltrado === totalGeral
            ? `${totalGeral} item(ns)`
            : <><span className="font-semibold text-foreground">{totalFiltrado}</span> de {totalGeral} item(ns) encontrado(s)</>
          }
        </p>
      )}
    </div>
  );
}
