import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

import { AccountAlreadyExistsError, provisionAccount } from "./auth.js";
import { openDatabase } from "./db/index.js";

const database = openDatabase(
  process.env.DGLZ_DB_PATH ?? "data/daguailuzi.sqlite",
);
const readline = createInterface({ input, output });

try {
  const username =
    process.env.DGLZ_USERNAME ?? (await readline.question("用户名: "));
  const password = process.env.DGLZ_PASSWORD;
  if (password === undefined) {
    throw new Error("missing-password");
  }
  const account = await provisionAccount(database, {
    username,
    password,
    ...(process.env.DGLZ_EMAIL === undefined
      ? {}
      : { email: process.env.DGLZ_EMAIL }),
  });
  process.stdout.write(`已创建账户 ${account.username}\n`);
} catch (error) {
  if (error instanceof AccountAlreadyExistsError) {
    process.stderr.write("账户已存在\n");
    process.exitCode = 1;
  } else if (error instanceof Error && error.message === "missing-password") {
    process.stderr.write("请通过 DGLZ_PASSWORD 提供密码\n");
    process.exitCode = 1;
  } else {
    process.stderr.write("创建账户失败\n");
    process.exitCode = 1;
  }
} finally {
  readline.close();
  database.close();
}
