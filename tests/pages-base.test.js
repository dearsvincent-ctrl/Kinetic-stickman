import test from "node:test";
import assert from "node:assert/strict";
import { resolvePagesBase } from "../build/pagesBase.js";

test("normal dev and static builds retain relative assets", () => {
  assert.equal(resolvePagesBase({}), "./");
  assert.equal(
    resolvePagesBase({ GITHUB_REPOSITORY: "owner/repository" }),
    "./",
  );
});

test("Pages builds use the exact repository name and support renamed repositories", () => {
  assert.equal(
    resolvePagesBase({
      GITHUB_PAGES: "true",
      GITHUB_REPOSITORY: "dearsvincent-ctrl/Kinetic-stickman",
    }),
    "/Kinetic-stickman/",
  );
  assert.equal(
    resolvePagesBase({
      GITHUB_PAGES: "true",
      GITHUB_REPOSITORY: "owner/My-Game.v2",
    }),
    "/My-Game.v2/",
  );
});

test("user and organization Pages sites load assets from the domain root", () => {
  assert.equal(
    resolvePagesBase({
      GITHUB_PAGES: "true",
      GITHUB_REPOSITORY: "Owner/owner.github.io",
    }),
    "/",
  );
});

test("misconfigured Pages metadata fails before producing broken deployment URLs", () => {
  for (const name of [
    undefined,
    "repository",
    "owner/",
    "owner/repo/path",
    "owner/../repo",
    "owner/..",
    "owner/.",
  ]) {
    assert.throws(() =>
      resolvePagesBase({ GITHUB_PAGES: "true", GITHUB_REPOSITORY: name }),
    );
  }
});
