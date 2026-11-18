import bcrypt from "bcryptjs";
import { prisma } from "../src/prisma";

async function main() {
  if (process.env.NODE_ENV === "production") {
    throw new Error("Development seed is disabled in production");
  }
  const count = await prisma.user.count();
  if (count > 0) return;
  const passwordHash = await bcrypt.hash("ChatindDemo123!", 12);
  const maya = await prisma.user.create({
    data: { username: "maya", email: "maya@example.test", displayName: "Maya Kapoor", passwordHash, about: "Making room for good conversations." },
  });
  const arjun = await prisma.user.create({
    data: { username: "arjun", email: "arjun@example.test", displayName: "Arjun Mehta", passwordHash },
  });
  await prisma.conversation.create({
    data: { type: "DIRECT", members: { create: [{ userId: maya.id }, { userId: arjun.id }] } },
  });
  console.log("Created local demo users maya and arjun (password: ChatindDemo123!)");
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
}).finally(() => prisma.$disconnect());
