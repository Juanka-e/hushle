
import { PrismaClient } from "@hushle/platform-db";
import bcryptjs from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
    const args = process.argv.slice(2);
    const username = args[0] || "admin";
    const password = args[1] || "admin123";
    const role = args[2] || "admin";

    try {
        console.log(`Checking user: ${username}...`);

        const existingUser = await prisma.user.findUnique({
            where: { username },
        });

        const hashedPassword = await bcryptjs.hash(password, 10);

        if (existingUser) {
            console.log("User exists. Updating password and role...");
            await prisma.user.update({
                where: { username },
                data: {
                    password: hashedPassword,
                    role: role
                },
            });
            console.log(`User ${username} updated. Role: ${role}`);
        } else {
            console.log("Creating new user...");
            await prisma.user.create({
                data: {
                    username,
                    password: hashedPassword,
                    role
                },
            });
            console.log(`User ${username} created. Role: ${role}`);
        }
    } catch (e) {
        console.error(e);
    } finally {
        await prisma.$disconnect();
    }
}

main();
