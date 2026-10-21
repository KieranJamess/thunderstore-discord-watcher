import { expect, it } from "vitest";
import { legalPage } from "../src/legal";

it("serves the privacy and terms pages, with or without a trailing slash", async () => {
  expect(await legalPage("/privacy")!.text()).toContain("<h1>Privacy Policy</h1>");
  expect(await legalPage("/terms/")!.text()).toContain("<h1>Terms of Service</h1>");
  expect(legalPage("/privacy")!.headers.get("content-type")).toContain("text/html");
  expect(legalPage("/")).toBeNull();
});
