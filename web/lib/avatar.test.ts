import { afterEach, expect, test } from "bun:test";
import { accountAvatar } from "./avatar";

const saved = process.env.GITHUB_WEB_URL;
afterEach(() => {
  if (saved === undefined) delete process.env.GITHUB_WEB_URL;
  else process.env.GITHUB_WEB_URL = saved;
});

test("builds github.com avatars from the account ID", () => {
  delete process.env.GITHUB_WEB_URL;
  expect(accountAvatar(42)).toBe("https://avatars.githubusercontent.com/u/42?v=4");
  process.env.GITHUB_WEB_URL = "https://github.com/";
  expect(accountAvatar(42)).toBe("https://avatars.githubusercontent.com/u/42?v=4");
});

test("returns null for GitHub Enterprise and invalid IDs", () => {
  process.env.GITHUB_WEB_URL = "https://github.example.com";
  expect(accountAvatar(42)).toBeNull();
  delete process.env.GITHUB_WEB_URL;
  expect(accountAvatar(0)).toBeNull();
  expect(accountAvatar(Number.NaN)).toBeNull();
});
