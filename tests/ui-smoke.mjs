import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { chromium } from "@playwright/test";

const port = Number(process.env.ACCOUNT_UI_SMOKE_PORT || 9120);
const baseURL = `http://127.0.0.1:${port}`;
const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "account-ui-smoke-"));
const dbPath = path.join(tmpDir, "accounts.sqlite3");
const screenshotPath = path.join(os.tmpdir(), "account-ui-smoke-dashboard.png");

const server = spawn(process.execPath, ["src/server.mjs"], {
  cwd: path.dirname(path.dirname(new URL(import.meta.url).pathname)),
  env: {
    ...process.env,
    ACCOUNT_DB_PATH: dbPath,
    ACCOUNT_PORT: String(port),
    ACCOUNT_HOST: "127.0.0.1"
  },
  stdio: ["ignore", "pipe", "pipe"]
});

let serverOutput = "";
server.stdout.on("data", (chunk) => {
  serverOutput += chunk.toString();
});
server.stderr.on("data", (chunk) => {
  serverOutput += chunk.toString();
});

try {
  await waitForHealth();

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 980 } });
  const browserMessages = [];
  page.on("console", (message) => browserMessages.push(`${message.type()}: ${message.text()}`));
  page.on("pageerror", (error) => browserMessages.push(`pageerror: ${error.message}`));
  await page.goto(`${baseURL}/login`, { waitUntil: "networkidle" });

  await assertVisibleText(page, "创建系统管理员");
  const mascotBox = await page.locator(".mascot-frame img").boundingBox();
  assert.ok(mascotBox, "mascot image should render");
  assert.ok(mascotBox.width <= 240, `mascot should be cropped and constrained, got width ${mascotBox.width}`);
  assert.ok(mascotBox.height <= 240, `mascot should be cropped and constrained, got height ${mascotBox.height}`);

  const naturalSize = await page.locator(".mascot-frame img").evaluate((img) => ({
    width: img.naturalWidth,
    height: img.naturalHeight,
    src: img.getAttribute("src")
  }));
  assert.equal(naturalSize.width, 420);
  assert.equal(naturalSize.height, 397);
  assert.equal(naturalSize.src, "/assets/mascot-account.png");
  const cornerAlpha = await page.locator(".mascot-frame img").evaluate((img) => {
    const canvas = document.createElement("canvas");
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const context = canvas.getContext("2d");
    context.drawImage(img, 0, 0);
    return context.getImageData(0, 0, 1, 1).data[3];
  });
  assert.equal(cornerAlpha, 0);

  await page.locator("#setup-form").getByLabel("邮箱").fill("smoke-admin@example.com");
  await page.locator("#setup-form").getByLabel("显示名").fill("Smoke Admin");
  await page.locator("#setup-form").getByLabel("密码", { exact: true }).fill("SmokePass123!");
  await page.locator("#setup-form").getByLabel("确认密码").fill("SmokePass123!");
  await page.getByRole("button", { name: "完成初始化" }).click();

  await assertVisibleText(page, "登录账户中心");
  await page.locator("#login-form").getByLabel("邮箱").fill("smoke-admin@example.com");
  await page.locator("#login-form").getByLabel("密码").fill("SmokePass123!");
  await page.getByRole("button", { name: "登录" }).click();

  await page.waitForURL("**/dashboard");
  await assertVisibleText(page, "用户管理");
  await assertVisibleText(page, "统一用户");
  await page.getByRole("button", { name: "新建用户" }).click();
  await page.locator("#user-dialog").waitFor({ state: "visible" });
  await page.locator("#user-dialog").getByRole("button", { name: "取消" }).click();
  await page.locator("#user-dialog").waitFor({ state: "hidden" });
  await page.getByRole("button", { name: "新建用户" }).click();
  await page.locator("#user-dialog").waitFor({ state: "visible" });
  await page.locator("#user-form").getByLabel("邮箱").fill("reader@example.com");
  await page.locator("#user-form").getByLabel("显示名").fill("Reader");
  await page.locator("#user-form").getByRole("button", { name: "生成" }).click();
  const userResponsePromise = page.waitForResponse((response) => response.url().includes("/users") && response.request().method() === "POST");
  await page.locator("#user-form").getByRole("button", { name: "创建" }).click();
  const userResponse = await userResponsePromise;
  assert.equal(userResponse.status(), 201, await userResponse.text());
  try {
    await page.waitForFunction(() => document.querySelector("#users-grid")?.textContent?.includes("Reader"), null, { timeout: 5000 });
  } catch (error) {
    const gridText = await page.locator("#users-grid").textContent().catch(() => "");
    throw new Error(`Reader was not rendered. grid=${gridText} messages=${browserMessages.join(" | ")}`);
  }

  await page.getByRole("button", { name: "API 接入" }).click();
  await page.getByRole("button", { name: "新增 API" }).click();
  await page.locator("#client-dialog").getByRole("button", { name: "取消" }).click();
  await page.locator("#client-dialog").waitFor({ state: "hidden" });
  await page.getByRole("button", { name: "新增 API" }).click();
  await page.locator("#client-form").getByRole("button", { name: "身份接入" }).click();
  await page.locator("#client-form").getByLabel("名称").fill("identity-api");
  await page.locator("#client-form").getByRole("button", { name: "创建" }).click();
  await assertVisibleText(page, "API 密钥");
  await page.getByRole("button", { name: "关闭" }).click();
  await assertVisibleText(page, "identity-api");
  const deleteResponsePromise = page.waitForResponse((response) => response.url().includes("/apis/") && response.request().method() === "DELETE");
  await page.locator("[data-api-id]").getByRole("button", { name: "删除" }).click();
  const deleteResponse = await deleteResponsePromise;
  assert.equal(deleteResponse.status(), 200, await deleteResponse.text());
  await assertVisibleText(page, "系统管理员");

  await page.getByRole("button", { name: "个人设置" }).click();
  await assertVisibleText(page, "账户资料");
  await page.locator("#profile-form").getByLabel("显示名称").fill("Smoke Root");
  const profileResponsePromise = page.waitForResponse((response) => response.url().includes("/me") && response.request().method() === "PATCH");
  await page.locator("#profile-form").getByRole("button", { name: "保存" }).click();
  const profileResponse = await profileResponsePromise;
  assert.equal(profileResponse.status(), 200, await profileResponse.text());
  await assertVisibleText(page, "Smoke Root / 系统管理员");
  await assertVisibleText(page, "注销账户");
  await assertVisibleText(page, "提交注销账户");
  await assertVisibleText(page, "第三方服务项目将无法正常获取你的账户信息");

  await assertVisibleText(page, "修改密码");
  await page.locator("#password-form").getByLabel("当前密码").fill("SmokePass123!");
  await page.locator("#password-form").getByLabel("新密码").fill("SmokePass456!");
  const passwordResponsePromise = page.waitForResponse((response) => response.url().includes("/me/password") && response.request().method() === "POST");
  await page.locator("#password-form").getByRole("button", { name: "更新" }).click();
  const passwordResponse = await passwordResponsePromise;
  assert.equal(passwordResponse.status(), 200, await passwordResponse.text());

  await page.screenshot({ path: screenshotPath, fullPage: true });
  await browser.close();
  console.log(`UI smoke passed: ${screenshotPath}`);
} finally {
  server.kill("SIGTERM");
}

async function waitForHealth() {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseURL}/api/v1/myaccount/healthz`);
      if (response.ok) {
        return;
      }
    } catch {
      // Service is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error(`account server did not become healthy: ${serverOutput}`);
}

async function assertVisibleText(page, text) {
  await page.getByText(text, { exact: false }).first().waitFor({ state: "visible", timeout: 5000 });
}
