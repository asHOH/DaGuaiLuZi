import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

import {
  AccountAlreadyExistsError,
  provisionAccount,
  readAccountAudit,
  resetPassword,
  revokeAllSessions,
} from "./auth.js";
import { openDatabase } from "./db/index.js";

let database: ReturnType<typeof openDatabase> | undefined;
const readline = createInterface({ input, output });

try {
  const command = process.argv[2] ?? "provision";
  if (
    process.argv.length > 3 ||
    !["provision", "reset-password", "revoke-sessions", "audit"].includes(
      command,
    )
  )
    throw new Error("invalid-command");
  const username =
    process.env.DGLZ_USERNAME ?? (await readline.question("用户名: "));
  const password = process.env.DGLZ_PASSWORD;
  delete process.env.DGLZ_PASSWORD;
  if (
    (command === "provision" || command === "reset-password") &&
    password === undefined
  ) {
    throw new Error("missing-password");
  }
  database = openDatabase(process.env.DGLZ_DB_PATH ?? "data/daguailuzi.sqlite");
  switch (command) {
    case "provision": {
      const account = await provisionAccount(database, {
        username,
        password: password!,
        ...(process.env.DGLZ_EMAIL === undefined
          ? {}
          : { email: process.env.DGLZ_EMAIL }),
      });
      process.stdout.write(`已创建账户 ${account.username}\n`);
      break;
    }
    case "reset-password":
      await resetPassword(database, username, password!);
      process.stdout.write("密码已重置，所有会话已撤销\n");
      break;
    case "revoke-sessions":
      revokeAllSessions(database, username);
      process.stdout.write("所有会话已撤销\n");
      break;
    case "audit": {
      const labels = {
        provision: "创建账户",
        "reset-password": "重置密码",
        "change-password": "修改密码",
        "revoke-sessions": "撤销全部会话",
        logout: "退出登录",
      };
      for (const entry of readAccountAudit(database, username)) {
        process.stdout.write(
          JSON.stringify({
            编号: entry.id,
            时间: new Date(entry.recordedAt).toISOString(),
            操作: labels[entry.action],
            操作者: entry.actor,
            来源: entry.source === "cli" ? "管理命令" : "登录会话",
            账户: entry.accountId,
          }) + "\n",
        );
      }
      break;
    }
  }
} catch (error) {
  if (error instanceof AccountAlreadyExistsError) {
    process.stderr.write("账户已存在\n");
    process.exitCode = 1;
  } else if (error instanceof Error && error.message === "missing-password") {
    process.stderr.write("请通过 DGLZ_PASSWORD 提供密码\n");
    process.exitCode = 1;
  } else if (error instanceof Error && error.message === "account-not-found") {
    process.stderr.write("账户不存在\n");
    process.exitCode = 1;
  } else if (
    error instanceof Error &&
    error.message === "invalid-account-input"
  ) {
    process.stderr.write("用户名或密码格式不正确\n");
    process.exitCode = 1;
  } else if (error instanceof Error && error.message === "invalid-command") {
    process.stderr.write("管理命令不正确，请通过环境变量提供用户名和密码\n");
    process.exitCode = 1;
  } else {
    process.stderr.write("账户操作失败\n");
    process.exitCode = 1;
  }
} finally {
  readline.close();
  database?.close();
}
