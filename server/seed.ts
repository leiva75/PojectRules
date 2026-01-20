import { db } from "./db";
import { employees } from "@shared/schema";
import bcrypt from "bcrypt";

async function seed() {
  console.log("Seeding database...");

  const existingAdmin = await db.select().from(employees).limit(1);
  if (existingAdmin.length > 0) {
    console.log("Database already has data, skipping seed");
    return;
  }

  const adminPassword = await bcrypt.hash("admin123", 10);
  const managerPassword = await bcrypt.hash("manager123", 10);
  const employeePassword = await bcrypt.hash("employee123", 10);

  await db.insert(employees).values([
    {
      email: "admin@pointeuse.fr",
      password: adminPassword,
      firstName: "Admin",
      lastName: "Système",
      role: "admin",
      pin: "000000",
      isActive: true,
    },
    {
      email: "manager@pointeuse.fr",
      password: managerPassword,
      firstName: "Marie",
      lastName: "Dupont",
      role: "manager",
      pin: "111111",
      isActive: true,
    },
    {
      email: "jean.martin@pointeuse.fr",
      password: employeePassword,
      firstName: "Jean",
      lastName: "Martin",
      role: "employee",
      pin: "123456",
      isActive: true,
    },
    {
      email: "sophie.bernard@pointeuse.fr",
      password: employeePassword,
      firstName: "Sophie",
      lastName: "Bernard",
      role: "employee",
      pin: "234567",
      isActive: true,
    },
    {
      email: "pierre.durand@pointeuse.fr",
      password: employeePassword,
      firstName: "Pierre",
      lastName: "Durand",
      role: "employee",
      pin: "345678",
      isActive: true,
    },
  ]);

  console.log("Seed completed!");
  console.log("\nTest accounts:");
  console.log("- Admin: admin@pointeuse.fr / admin123 (PIN: 000000)");
  console.log("- Manager: manager@pointeuse.fr / manager123 (PIN: 111111)");
  console.log("- Employee: jean.martin@pointeuse.fr / employee123 (PIN: 123456)");
  console.log("- Employee: sophie.bernard@pointeuse.fr / employee123 (PIN: 234567)");
  console.log("- Employee: pierre.durand@pointeuse.fr / employee123 (PIN: 345678)");
}

seed()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Seed failed:", err);
    process.exit(1);
  });
