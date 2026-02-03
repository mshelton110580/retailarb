import { PrismaClient, UserRole } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  const email = process.env.SEED_ADMIN_EMAIL ?? "admin@arbdesk.local";
  const password = process.env.SEED_ADMIN_PASSWORD ?? "ChangeMe123!";

  const existing = await prisma.users.findUnique({ where: { email } });
  if (existing) {
    return;
  }

  const password_hash = await bcrypt.hash(password, 12);
  await prisma.users.create({
    data: {
      email,
      password_hash,
      role: UserRole.ADMIN
    }
  });
}

main()
  .catch((error) => {
    console.error("Seed failed", error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
