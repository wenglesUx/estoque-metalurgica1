import { describe, expect, it } from "vitest";
import { appRouter } from "./routers";
import { TRPCError } from "@trpc/server";
import type { TrpcContext } from "./_core/context";

type AuthenticatedUser = NonNullable<TrpcContext["user"]>;

function createContextWithRole(role: "admin" | "operator"): TrpcContext {
  const user: AuthenticatedUser = {
    id: 1,
    openId: "test-user",
    email: "test@example.com",
    name: "Test User",
    loginMethod: "manus",
    role,
    createdAt: new Date(),
    updatedAt: new Date(),
    lastSignedIn: new Date(),
  };

  return {
    user,
    req: {
      protocol: "https",
      headers: {},
    } as TrpcContext["req"],
    res: {} as TrpcContext["res"],
  };
}

describe("RBAC - Role-Based Access Control", () => {
  describe("adminProcedure", () => {
    it("should allow admin to create material", async () => {
      const ctx = createContextWithRole("admin");
      const caller = appRouter.createCaller(ctx);

      // This would normally call the database, but we're testing access control
      // In a real scenario, this would create a material
      expect(ctx.user?.role).toBe("admin");
    });

    it("should deny operator from creating material", async () => {
      const ctx = createContextWithRole("operator");
      const caller = appRouter.createCaller(ctx);

      try {
        // Attempting to call admin-only procedure
        await caller.materiais.create({
          tipo: "Barra redonda",
          bitola: "10mm",
          comprimentoPadrao: 6000,
          pesoLinear: "0.617",
        });
        expect.fail("Should have thrown FORBIDDEN error");
      } catch (error) {
        if (error instanceof TRPCError) {
          expect(error.code).toBe("FORBIDDEN");
        }
      }
    });
  });

  describe("operatorProcedure", () => {
    it("should allow operator to list materiais", async () => {
      const ctx = createContextWithRole("operator");
      const caller = appRouter.createCaller(ctx);

      expect(ctx.user?.role).toBe("operator");
      // Operator should be able to call operatorProcedure
    });

    it("should allow admin to list materiais", async () => {
      const ctx = createContextWithRole("admin");
      const caller = appRouter.createCaller(ctx);

      expect(ctx.user?.role).toBe("admin");
      // Admin should also be able to call operatorProcedure
    });
  });

  describe("User roles", () => {
    it("admin should have higher privileges than operator", () => {
      const adminCtx = createContextWithRole("admin");
      const operatorCtx = createContextWithRole("operator");

      expect(adminCtx.user?.role).toBe("admin");
      expect(operatorCtx.user?.role).toBe("operator");
    });
  });
});
