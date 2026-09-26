import { describe, expect, it } from "vitest";
import { breadcrumbs, cdCommand, formatSize, isHiddenName, joinRemotePath, parentRemotePath, quoteForShell } from "./sftpPath";

describe("joinRemotePath", () => {
  it("joins a directory and a name", () => {
    expect(joinRemotePath("/home/user", "photo.png")).toBe("/home/user/photo.png");
    expect(joinRemotePath("/", "etc")).toBe("/etc");
  });
});

describe("parentRemotePath", () => {
  it("returns the parent directory", () => {
    expect(parentRemotePath("/a/b/c")).toBe("/a/b");
    expect(parentRemotePath("/a")).toBe("/");
  });
  it("returns null at the root", () => {
    expect(parentRemotePath("/")).toBeNull();
  });
});

describe("breadcrumbs", () => {
  it("builds one crumb per segment, root included", () => {
    expect(breadcrumbs("/a/b")).toEqual([
      { name: "/", path: "/" },
      { name: "a", path: "/a" },
      { name: "b", path: "/a/b" },
    ]);
  });
  it("is just the root for /", () => {
    expect(breadcrumbs("/")).toEqual([{ name: "/", path: "/" }]);
  });
});

describe("formatSize", () => {
  it("uses bytes below 1024", () => {
    expect(formatSize(0)).toBe("0 o");
    expect(formatSize(512)).toBe("512 o");
  });
  it("scales to Ko/Mo/Go", () => {
    expect(formatSize(1024)).toBe("1.0 Ko");
    expect(formatSize(1536)).toBe("1.5 Ko");
    expect(formatSize(1024 * 1024 * 3)).toBe("3.0 Mo");
    expect(formatSize(1024 * 1024 * 1024 * 12)).toBe("12 Go");
  });
});

describe("quoteForShell / cdCommand", () => {
  it("wraps a simple path in single quotes", () => {
    expect(quoteForShell("/var/log")).toBe("'/var/log'");
    expect(cdCommand("/var/log")).toBe("cd '/var/log'");
  });
  it("escapes embedded single quotes safely", () => {
    expect(quoteForShell("/home/user/it's a folder")).toBe("'/home/user/it'\\''s a folder'");
  });
  it("handles spaces, $, backticks and other shell-special characters", () => {
    const path = "/tmp/$(rm -rf ~)`echo hi`";
    const quoted = quoteForShell(path);
    // Rien de spécial ne doit survivre en dehors des guillemets simples fermés/rouverts
    expect(quoted.startsWith("'") && quoted.endsWith("'")).toBe(true);
    expect(quoted).toContain("$(rm -rf ~)");
  });
});

describe("isHiddenName", () => {
  it("flags dotfiles only", () => {
    expect(isHiddenName(".bashrc")).toBe(true);
    expect(isHiddenName("readme.txt")).toBe(false);
  });
});
