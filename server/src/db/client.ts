import { PrismaClient } from '@prisma/client';

/** Single shared Prisma client. Import this, don't construct your own. */
export const prisma = new PrismaClient();

export async function disconnectDb(): Promise<void> {
  await prisma.$disconnect();
}
