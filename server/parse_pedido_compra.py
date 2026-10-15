#!/usr/bin/env python3
"""
Extrai dados estruturados de um PDF de Pedido de Compra (formato HCM/Mega) —
cabeçalho (número do pedido, fornecedor, obra, datas) + tabela de materiais.
Usa pdfplumber especificamente porque extract_tables() lê pela posição real
das colunas no PDF, evitando o embaralhamento que a extração de texto puro
pode causar em tabelas.

Uso: python3 parse_pedido_compra.py caminho/do/arquivo.pdf
Saída: JSON no stdout.
"""
import sys
import json
import re

try:
    import pdfplumber
except ImportError:
    import subprocess
    subprocess.check_call([sys.executable, "-m", "pip", "install", "--break-system-packages", "--quiet", "pdfplumber"])
    import pdfplumber


def limpar(texto):
    if texto is None:
        return ""
    return re.sub(r"\s+", " ", str(texto)).strip()


def num_br(texto):
    """Converte '8.736,000' ou '6,8800' (formato BR) pra float."""
    if not texto:
        return None
    t = limpar(texto).replace(".", "").replace(",", ".")
    try:
        return float(t)
    except ValueError:
        return None


def extrair_cabecalho(texto_completo):
    dados = {}

    m = re.search(r"PC\s*N[ºo°]?\s*:?\s*(\d+)", texto_completo, re.IGNORECASE)
    dados["numeroPedido"] = m.group(1) if m else None

    m = re.search(r"Processo\s*N[ºo°]?\s*:?\s*(\d+)", texto_completo, re.IGNORECASE)
    dados["processoNumero"] = m.group(1) if m else None

    m = re.search(r"Emiss[ãa]o\s*:?\s*(\d{2}/\d{2}/\d{4})", texto_completo, re.IGNORECASE)
    dados["dataEmissao"] = m.group(1) if m else None

    m = re.search(r"Projeto\s*:?\s*(.+?)(?:\s+Emiss[ãa]o|\n)", texto_completo, re.IGNORECASE)
    dados["obraNome"] = limpar(m.group(1)) if m else None

    # Fornecedor — primeira ocorrência de "Razão Social" depois de "DADOS DO FORNECEDOR"
    bloco_fornecedor = texto_completo.split("DADOS DO FORNECEDOR")[-1].split("DADOS PARA FATURAMENTO")[0]
    m = re.search(r"Raz[ãa]o Social\s*:?\s*(.+)", bloco_fornecedor, re.IGNORECASE)
    dados["fornecedorNome"] = limpar(m.group(1)) if m else None
    m = re.search(r"CNPJ\s*:?\s*([\d./\-]+)", bloco_fornecedor, re.IGNORECASE)
    dados["fornecedorCnpj"] = limpar(m.group(1)) if m else None

    m = re.search(r"Dt\.?\(?s?\)?\s*Entrega\s*:?\s*(\d{2}/\d{2}/\d{4})", texto_completo, re.IGNORECASE)
    dados["dataEntregaPrevista"] = m.group(1) if m else None

    m = re.search(r"Cond\.?\s*Pagto\.?\s*:?\s*(.+?)(?:\n|Cota[çc][ãa]o|Solicita)", texto_completo, re.IGNORECASE)
    dados["condPagamento"] = limpar(m.group(1)) if m else None

    m = re.search(r"Cota[çc][ãa]o\s*:?\s*(.+?)(?:\n|Solicita)", texto_completo, re.IGNORECASE)
    dados["cotacao"] = limpar(m.group(1)) if m else None

    # A linha de "Total Pedido" costuma vir com vários valores (frete, seguro,
    # descontos...) antes dele — o total de verdade é sempre o ÚLTIMO número
    # dessa linha, não o primeiro.
    m = re.search(r"Total\s+Pedido\s*\n?\s*(.+)", texto_completo, re.IGNORECASE)
    if m:
        numeros_na_linha = re.findall(r"[\d.,]+", m.group(1))
        dados["valorTotalPedido"] = num_br(numeros_na_linha[-1]) if numeros_na_linha else None
    else:
        dados["valorTotalPedido"] = None

    return dados


def extrair_aco_limpo(texto_bruto):
    """
    Isola só o código do aço (ex: "A36", "A572-Gr 50") de dentro de um trecho
    que pode vir misturado com outras informações (ex: espessura de reforço
    em perfis dobrados: "e-2,0mm A36"). Se não achar esse padrão específico,
    devolve o texto bruto mesmo — melhor ter algo pra revisar do que nada.
    """
    m = re.search(r"\b(A\s?\d+(?:[\s-]?Gr\s?\d+)?)\b", texto_bruto, re.IGNORECASE)
    return limpar(m.group(1)) if m else limpar(texto_bruto)


def extrair_item_da_descricao(descricao):
    """
    Extrai tipo/bitola/aço/comprimento/quantidade de uma descrição em texto
    livre. Cobre os padrões de frase observados nos pedidos reais até agora:
    "Perfil metalico ...", "Perfil dobrado ...", "Barra redonda laminada
    ...", "Cantoneira laminado abas iguais ...", "Chapa aco carbono ...".
    Ajustar/ampliar conforme mais exemplos reais aparecerem — o campo
    descricaoOriginal sempre fica disponível na tela de revisão como
    referência, mesmo quando nenhum padrão bate.
    """
    desc = limpar(descricao)
    resultado = {
        "descricaoOriginal": desc,
        "tipo": None, "bitola": None, "aco": None,
        "comprimento": None, "quantidadePecas": None,
        # Antes o padrão era sempre "PERFIL", mesmo pra item que não tem nada
        # a ver com matéria-prima (EPI, tinta, ferramenta...) — como esses
        # pedidos passam pela mesma tabela/formato de PDF, todo item acabava
        # marcado como perfil metálico. Agora só vira PERFIL/CHAPA se a
        # descrição realmente citar uma palavra de material bruto; o resto
        # fica em OUTRO, pra não entrar como falso positivo na leitura
        # automática de e-mail (ver temMateriaPrima em gmailPedidos.service.ts).
        "categoria": "OUTRO",
    }

    # "Protetor para vergalhão", "Luva de proteção"... são acessório/EPI que
    # só cita o nome do material — não é o material em si.
    eh_acessorio = re.search(r"\b(protetor|prote[çc][ãa]o|capa|luva)\b", desc, re.IGNORECASE)

    if re.search(r"\bchapa\b", desc, re.IGNORECASE) and not eh_acessorio:
        resultado["categoria"] = "CHAPA"
    elif not eh_acessorio and re.search(
        r"\b(perfil|barra\s+redonda|cantoneira|tubo|vergalh[ãa]o|cordoalha|"
        r"viga|laminado|dobrado|barra\s+chata|a[çc]o\s+carbono)\b",
        desc, re.IGNORECASE
    ):
        resultado["categoria"] = "PERFIL"

    # 1) Perfil metálico ou dobrado — "Perfil metalico W 150x13 A572-Gr 50
    #    com 12 metros" / "Perfil dobrado UE 150x60x20mm (Kg/br 27,3)
    #    e-2,0mm A36 com 6 metros"
    m = re.search(
        r"Perfil\s+(?:met[aá]lic[ao]|dobrado)\s+(\S+)\s+(.+?)\s+com\s+(\d+)\s*(metros?|mm|m\b)",
        desc, re.IGNORECASE
    )
    if m:
        resultado["tipo"] = m.group(1).upper()
        meio_sem_peso = re.sub(r"\(K?g/\w+[^)]*\)", "", m.group(2)).strip()
        m_bitola = re.match(r"^([\w.x,]+)", meio_sem_peso)
        resultado["bitola"] = limpar(m_bitola.group(1)).upper() if m_bitola else None
        resultado["aco"] = extrair_aco_limpo(meio_sem_peso).upper()
        valor = int(m.group(3))
        unidade = m.group(4).lower()
        resultado["comprimento"] = valor * 1000 if "metro" in unidade or unidade == "m" else valor

    # 2) Barra redonda / Cantoneira — "Barra redonda laminada (kg/m 0,99)
    #    1/2" (12,70mm) A36 c/ 6 m" / "Cantoneira laminado abas iguais
    #    (Kg/m 2,46) 1/8x2" A36 c/ 6m"
    if not resultado["tipo"]:
        m = re.search(
            r"(Barra redonda laminada|Cantoneira laminado abas iguais)\s*\(K?g/m[^)]*\)\s*(.+?)\s+(A\s?\d+(?:[\s-]?Gr\s?\d+)?)\s+c/\s*(\d+)\s*m",
            desc, re.IGNORECASE
        )
        if m:
            resultado["tipo"] = "BARRA REDONDA" if "barra" in m.group(1).lower() else "CANTONEIRA"
            resultado["bitola"] = limpar(m.group(2)).upper()
            resultado["aco"] = limpar(m.group(3)).upper()
            resultado["comprimento"] = int(m.group(4)) * 1000

    # 3) Chapa — "Chapa aco carbono de 2mm com 1,5x6m (Kg/ch 141,3) A36"
    if not resultado["tipo"]:
        m = re.search(
            r"Chapa\s+a[çc]o\s+carbono\s+de\s+([\d,]+\s*mm)\s+com\s+([\dx,]+\s*m)\s*\(K?g/ch[^)]*\)\s*(\S+)",
            desc, re.IGNORECASE
        )
        if m:
            resultado["categoria"] = "CHAPA"
            resultado["tipo"] = "CHAPA"
            resultado["bitola"] = f"{limpar(m.group(1))} ({limpar(m.group(2))})".upper()
            resultado["aco"] = limpar(m.group(3)).upper()

    m = re.search(r"\((\d+)\s*(?:barras?|folhas?|chapas?|pe[çc]as?|un(?:idades?)?)\)", desc, re.IGNORECASE)
    if m:
        resultado["quantidadePecas"] = int(m.group(1))

    return resultado


def mapear_colunas(cabecalho_linha):
    """
    Lê a linha de cabeçalho da tabela (com None nas colunas mescladas) e
    devolve o índice de cada coluna que nos interessa, pelo texto do rótulo.
    Isso evita depender da ORDEM dos números aparecerem na linha de dado —
    cada valor é lido da posição certa, mesmo que ICMS/IPI estejam vazios.
    """
    indices = {}
    for i, celula in enumerate(cabecalho_linha):
        texto = limpar(celula).lower()
        if not texto:
            continue
        if "código" in texto or "codigo" in texto:
            indices["codigo"] = i
        elif "quantidade" in texto:
            indices["pesoTotal"] = i
        elif "unidade" in texto:
            indices["unidade"] = i
        elif "descri" in texto:
            indices["descricao"] = i
        elif "unit" in texto:
            indices["valorUnitario"] = i
        elif "total" in texto and "item" in texto:
            indices["valorTotalItem"] = i
    return indices


def extrair_itens(pdf):
    itens = []
    for page in pdf.pages:
        tabelas = page.extract_tables()
        for tabela in tabelas:
            indices = {}
            for linha in tabela:
                # Primeiro tenta reconhecer essa linha como o cabeçalho da tabela.
                if "codigo" not in indices:
                    candidato = mapear_colunas(linha)
                    if "codigo" in candidato and "descricao" in candidato:
                        indices = candidato
                        continue

                if not indices:
                    continue  # ainda não achamos o cabeçalho dessa tabela

                codigo_raw = limpar(linha[indices["codigo"]]) if indices.get("codigo") is not None and indices["codigo"] < len(linha) else ""
                # Linha de item real começa com um código numérico (ex: "8.635") —
                # filtra linhas de rodapé (Base calc. ICMS, Total Bruto, etc.)
                if not re.match(r"^[\d.]+$", codigo_raw):
                    continue

                def campo(chave):
                    idx = indices.get(chave)
                    if idx is None or idx >= len(linha):
                        return None
                    return linha[idx]

                descricao_bruta = campo("descricao") or ""
                item_desc = extrair_item_da_descricao(descricao_bruta)

                item = {
                    "codigo": codigo_raw,
                    "pesoTotal": num_br(campo("pesoTotal")),
                    "unidade": limpar(campo("unidade")) or None,
                    "valorUnitario": num_br(campo("valorUnitario")),
                    "valorTotalItem": num_br(campo("valorTotalItem")),
                    **item_desc,
                }
                itens.append(item)
    return itens


def main():
    if len(sys.argv) < 2:
        print(json.dumps({"erro": "Uso: parse_pedido_compra.py arquivo.pdf"}))
        sys.exit(1)

    caminho = sys.argv[1]
    with pdfplumber.open(caminho) as pdf:
        texto_completo = "\n".join(p.extract_text() or "" for p in pdf.pages)
        cabecalho = extrair_cabecalho(texto_completo)
        itens = extrair_itens(pdf)

    print(json.dumps({"cabecalho": cabecalho, "itens": itens}, ensure_ascii=False))


if __name__ == "__main__":
    main()
