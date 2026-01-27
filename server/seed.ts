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
      email: "admin@cronosfichajes.es",
      password: adminPassword,
      firstName: "Admin",
      lastName: "Sistema",
      role: "admin",
      pin: "000000",
      isActive: true,
    },
    {
      email: "gerente@cronosfichajes.es",
      password: managerPassword,
      firstName: "Maria",
      lastName: "Garcia",
      role: "manager",
      pin: "111111",
      isActive: true,
    },
    {
      email: "carlos.lopez@cronosfichajes.es",
      password: employeePassword,
      firstName: "Carlos",
      lastName: "Lopez",
      role: "employee",
      pin: "123456",
      isActive: true,
    },
    {
      email: "ana.martinez@cronosfichajes.es",
      password: employeePassword,
      firstName: "Ana",
      lastName: "Martinez",
      role: "employee",
      pin: "234567",
      isActive: true,
    },
    {
      email: "pedro.sanchez@cronosfichajes.es",
      password: employeePassword,
      firstName: "Pedro",
      lastName: "Sanchez",
      role: "employee",
      pin: "345678",
      isActive: true,
    },
  ]);

  console.log("Seed completado!");
  console.log("\nCuentas de prueba:");
  console.log("- Admin: admin@cronosfichajes.es / admin123 (PIN: 000000)");
  console.log("- Gerente: gerente@cronosfichajes.es / manager123 (PIN: 111111)");
  console.log("- Empleado: carlos.lopez@cronosfichajes.es / employee123 (PIN: 123456)");
  console.log("- Empleado: ana.martinez@cronosfichajes.es / employee123 (PIN: 234567)");
  console.log("- Empleado: pedro.sanchez@cronosfichajes.es / employee123 (PIN: 345678)");
}

seed()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Seed failed:", err);
    process.exit(1);
  });
