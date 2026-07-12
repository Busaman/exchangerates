import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import { getDatabaseEnv } from "@/lib/env";

let prisma: PrismaClient | undefined;

export function getDb(): PrismaClient {
  if (prisma === undefined) {
    const { DATABASE_URL } = getDatabaseEnv();
    prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: DATABASE_URL }) });
  }

  return prisma;
}
