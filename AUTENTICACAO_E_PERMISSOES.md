# Sistema de Autenticação e Permissões (RBAC)

Este documento descreve como usar o novo sistema de autenticação e controle de acesso baseado em funções (RBAC) implementado no projeto.

## Visão Geral

O sistema foi projetado para ser **escalável e granular**, permitindo:

- **Autenticação Local**: Usuários fazem login com email e senha
- **Controle de Acesso Baseado em Funções (RBAC)**: Cada usuário possui um role (função)
- **Permissões Granulares**: Cada ação no sistema é uma permissão que pode ser controlada
- **Sobrescrita de Permissões**: Permissões customizadas por usuário podem sobrescrever as do role

## Estrutura de Dados

### Tabela `users`

Armazena informações dos usuários:

```sql
- id: ID único
- openId: Identificador único para integração futura
- name: Nome do usuário
- email: Email (único, usado para login)
- passwordHash: Hash da senha (bcrypt)
- role: Função do usuário (owner, admin, supervisor, operator, viewer)
- ativo: Se o usuário está ativo ou não
- createdAt, updatedAt, lastSignedIn: Timestamps
```

### Tabela `permissoes`

Define todas as ações possíveis no sistema:

```sql
- id: ID único
- chave: Identificador único (ex: "material.criar", "obra.editar")
- descricao: Descrição legível
- modulo: Módulo do sistema (ex: "materiais", "obras")
- acao: Tipo de ação (ex: "criar", "editar", "deletar")
```

### Tabela `role_permissoes`

Define quais permissões cada role possui:

```sql
- id: ID único
- role: Função (owner, admin, supervisor, operator, viewer)
- permissaoId: ID da permissão
```

### Tabela `usuario_permissoes`

Permite sobrescrever permissões padrão para usuários específicos:

```sql
- id: ID único
- usuarioId: ID do usuário
- permissaoId: ID da permissão
- permitido: true (permitir) ou false (negar)
```

## Roles Padrão

### Owner (Proprietário)
- Acesso completo a todas as funcionalidades
- Pode gerenciar usuários
- Pode visualizar relatórios

### Admin (Administrador)
- Acesso quase completo
- Pode gerenciar usuários (criar, editar, mas não deletar)
- Pode visualizar relatórios

### Supervisor (Supervisor)
- Pode criar, editar e visualizar materiais
- Pode criar e editar obras
- Pode criar e editar solicitações
- Pode criar e editar inventários
- Pode visualizar relatórios

### Operator (Operador)
- Pode visualizar e criar materiais
- Pode realizar baixas
- Pode criar solicitações
- Pode visualizar inventários

### Viewer (Visualizador)
- Acesso somente leitura
- Pode visualizar materiais, obras, especificações, etc.

## Como Usar no Frontend

### 1. Verificar Permissão Simples

```tsx
import { usePermission } from "@/hooks/usePermission";

export function MeuComponente() {
  const podeEditar = usePermission("material.editar");

  return (
    <>
      {podeEditar && (
        <Button>Editar Material</Button>
      )}
    </>
  );
}
```

### 2. Usar PermissionGate

```tsx
import { PermissionGate } from "@/components/PermissionGate";

export function MeuComponente() {
  return (
    <PermissionGate permission="material.criar">
      <Button>Novo Material</Button>
    </PermissionGate>
  );
}
```

### 3. Verificar Múltiplas Permissões

```tsx
import { useAnyPermission, useAllPermissions } from "@/hooks/usePermission";

export function MeuComponente() {
  // Requer QUALQUER UMA das permissões
  const podeModificar = useAnyPermission([
    "material.editar",
    "material.deletar"
  ]);

  // Requer TODAS as permissões
  const podeGerenciar = useAllPermissions([
    "material.editar",
    "material.deletar"
  ]);

  return (
    <>
      {podeModificar && <Button>Modificar</Button>}
      {podeGerenciar && <Button>Gerenciar</Button>}
    </>
  );
}
```

### 4. Desabilitar Elemento sem Permissão

```tsx
import { PermissionDisable } from "@/components/PermissionGate";

export function MeuComponente() {
  return (
    <PermissionDisable permission="material.deletar">
      <Button>Deletar Material</Button>
    </PermissionDisable>
  );
}
```

## Como Usar no Backend

### 1. Verificar Permissão em Endpoint tRPC

```typescript
// server/routers.ts
export const appRouter = router({
  materiais: router({
    criar: publicProcedure
      .input(z.object({ ... }))
      .mutation(async ({ input, ctx }) => {
        // Verificar permissão
        const temPermissao = await hasPermission(
          ctx.userId,
          "material.criar"
        );
        
        if (!temPermissao) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "Você não tem permissão para criar materiais",
          });
        }

        // Executar ação
        return createMaterial(input);
      }),
  }),
});
```

### 2. Verificar Qualquer Uma das Permissões

```typescript
const temPermissao = await hasAnyPermission(
  userId,
  ["material.editar", "material.deletar"]
);
```

### 3. Verificar Todas as Permissões

```typescript
const temPermissao = await hasAllPermissions(
  userId,
  ["material.editar", "material.deletar"]
);
```

## Fluxo de Login

1. Usuário acessa a página `/login`
2. Insere email e senha
3. Backend valida as credenciais
4. Se válido, retorna token de sessão
5. Frontend armazena token (cookie/localStorage)
6. Usuário é redirecionado para a página inicial
7. Todas as requisições incluem o token para autenticação

## Fluxo de Registro

1. Usuário clica em "Criar uma conta"
2. Preenche nome, email e senha
3. Backend cria novo usuário com role padrão "operator"
4. Usuário é redirecionado para login
5. Pode fazer login com as credenciais criadas

## Adicionando Novas Permissões

Para adicionar uma nova permissão ao sistema:

1. **Defina a permissão** no banco de dados:
```sql
INSERT INTO permissoes (chave, descricao, modulo, acao)
VALUES ('material.exportar', 'Exportar materiais', 'materiais', 'exportar');
```

2. **Atribua a permissões aos roles** necessários:
```sql
INSERT INTO role_permissoes (role, permissao_id)
SELECT 'admin', id FROM permissoes WHERE chave = 'material.exportar';
```

3. **Use no frontend**:
```tsx
const podeExportar = usePermission("material.exportar");
```

4. **Valide no backend**:
```typescript
const temPermissao = await hasPermission(userId, "material.exportar");
```

## Sobrescrita de Permissões por Usuário

Para dar uma permissão adicional a um usuário específico:

```sql
INSERT INTO usuario_permissoes (usuario_id, permissao_id, permitido)
SELECT 1, id, true FROM permissoes WHERE chave = 'material.deletar';
```

Para negar uma permissão que o role normalmente teria:

```sql
INSERT INTO usuario_permissoes (usuario_id, permissao_id, permitido)
SELECT 1, id, false FROM permissoes WHERE chave = 'material.deletar';
```

## Próximos Passos

1. **Executar Migrações**: Execute as migrações do banco de dados para criar as novas tabelas
2. **Inicializar Permissões**: Execute a função `initializeDefaultPermissions()` para popular as permissões padrão
3. **Testar Login**: Acesse `/login` e crie uma conta de teste
4. **Integrar em Páginas**: Use `PermissionGate` e `usePermission` nas páginas existentes para controlar acesso

## Exemplo Completo

Aqui está um exemplo de como integrar permissões em uma página existente:

```tsx
import { PermissionGate, PermissionDisable } from "@/components/PermissionGate";
import { usePermission } from "@/hooks/usePermission";

export function Materiais() {
  const podeEditar = usePermission("material.editar");
  const podeDeletar = usePermission("material.deletar");

  return (
    <StockDashboardLayout>
      <div className="space-y-6">
        <PermissionGate permission="material.criar">
          <Button>
            <Plus className="w-4 h-4 mr-2" /> Novo Material
          </Button>
        </PermissionGate>

        {/* Tabela de materiais */}
        <table>
          <tbody>
            {materiais.map(material => (
              <tr key={material.id}>
                <td>{material.tipo}</td>
                <td>
                  <PermissionDisable permission="material.editar">
                    <Button variant="ghost" size="icon">
                      <Edit2 className="w-4 h-4" />
                    </Button>
                  </PermissionDisable>
                </td>
                <td>
                  <PermissionGate permission="material.deletar">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="text-destructive"
                      onClick={() => deletarMaterial(material.id)}
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </PermissionGate>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </StockDashboardLayout>
  );
}
```

## Troubleshooting

### Usuário não consegue fazer login
- Verifique se o email está correto
- Verifique se a senha está correta
- Verifique se o usuário está ativo (`ativo = true`)

### Permissão não funciona
- Verifique se a permissão foi criada na tabela `permissoes`
- Verifique se o role do usuário tem a permissão em `role_permissoes`
- Verifique se não há sobrescrita negando a permissão em `usuario_permissoes`

### Erro ao criar usuário
- Verifique se o email já existe
- Verifique se a senha tem no mínimo 6 caracteres
- Verifique se o banco de dados está acessível

## Suporte

Para dúvidas ou problemas, consulte a documentação do projeto ou entre em contato com o desenvolvedor.
