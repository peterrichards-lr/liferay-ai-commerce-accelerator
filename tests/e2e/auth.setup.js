import { test as setup, expect } from "@playwright/test";
import path from "path";

const STORAGE_STATE = path.join(__dirname, "../../playwright/.auth/user.json");

setup("authenticate", async ({ page }) => {
  // Navigate to Liferay login
  await page.goto("http://localhost:8080/c/portal/login");

  // Perform login (Standard dev credentials)
  await page.getByLabel("Email Address").fill("test@liferay.com");
  await page.getByLabel("Password").fill("L1feray$");
  await page.getByRole("button", { name: "Sign In" }).click();

  // Wait for landing page
  await expect(page).toHaveTitle(/Home/i);

  // Save storage state
  await page.context().storageState({ path: STORAGE_STATE });
});
