/**
 * Unit tests for path helper functions.
 */

import { describe, it, expect, vi } from "vitest";
import os from "node:os";
import path from "node:path";
import {
  isWindowsDrive,
  isSameDrive,
  normalizeGitBashPath,
  resolveHome,
  resolveTargetPath,
  isPathOutsideWorkspace,
  getExtensionScriptDirs,
} from "./internal";

// Mock getExtensionScriptDirs to return empty array for consistent tests
const originalGetExtensionScriptDirs = getExtensionScriptDirs;

describe("isWindowsDrive", () => {
  it("should return true for uppercase drive letters", () => {
    expect(isWindowsDrive("C:\\")).toBe(true);
    expect(isWindowsDrive("D:/")).toBe(true);
    expect(isWindowsDrive("E:\\Users\\test")).toBe(true);
  });

  it("should return true for lowercase drive letters", () => {
    expect(isWindowsDrive("c:\\")).toBe(true);
    expect(isWindowsDrive("d:/")).toBe(true);
    expect(isWindowsDrive("a:\\path")).toBe(true);
  });

  it("should return false for paths without drive letters", () => {
    expect(isWindowsDrive("/home/user")).toBe(false);
    expect(isWindowsDrive("relative/path")).toBe(false);
    expect(isWindowsDrive("~/path")).toBe(false);
  });

  it("should return false for empty or short strings", () => {
    expect(isWindowsDrive("")).toBe(false);
    expect(isWindowsDrive("C")).toBe(false);
    expect(isWindowsDrive(":")).toBe(false);
  });
});

describe("isSameDrive", () => {
  it("should return true for same drive (uppercase)", () => {
    expect(isSameDrive("C:\\path1", "C:\\path2")).toBe(true);
    expect(isSameDrive("D:/folder", "D:\\file.txt")).toBe(true);
  });

  it("should return true for same drive (lowercase)", () => {
    expect(isSameDrive("c:\\path", "C:\\other")).toBe(true);
    expect(isSameDrive("D:\\dir", "d:\\file")).toBe(true);
  });

  it("should return false for different drives", () => {
    expect(isSameDrive("C:\\path", "D:\\path")).toBe(false);
    expect(isSameDrive("D:/folder", "E:\\file")).toBe(false);
  });

  it("should handle paths without drives", () => {
    expect(isSameDrive("/unix/path", "/other/path")).toBe(true); // No drive = empty = equal
  });

  it("should handle mixed drive/no-drive paths", () => {
    expect(isSameDrive("C:\\path", "/unix/path")).toBe(false);
  });
});

describe("normalizeGitBashPath", () => {
  it("should convert Git Bash style paths to Windows paths", () => {
    expect(normalizeGitBashPath("/c/Users/test")).toBe("C:/Users/test");
    expect(normalizeGitBashPath("/d/project")).toBe("D:/project");
    expect(normalizeGitBashPath("/e")).toBe("E:");
  });

  it("should handle lowercase drive letters", () => {
    expect(normalizeGitBashPath("/c/path")).toBe("C:/path");
    expect(normalizeGitBashPath("/a/file.txt")).toBe("A:/file.txt");
  });

  it("should not modify regular Unix paths", () => {
    expect(normalizeGitBashPath("/home/user")).toBe("/home/user");
    expect(normalizeGitBashPath("/var/log")).toBe("/var/log");
  });

  it("should not modify Windows paths already in correct format", () => {
    expect(normalizeGitBashPath("C:\\Users\\test")).toBe("C:\\Users\\test");
    expect(normalizeGitBashPath("D:/folder")).toBe("D:/folder");
  });

  it("should handle paths with only drive letter", () => {
    expect(normalizeGitBashPath("/c")).toBe("C:");
  });

  it("should handle empty strings", () => {
    expect(normalizeGitBashPath("")).toBe("");
  });
});

describe("resolveHome", () => {
  it("should expand tilde to home directory", () => {
    const home = os.homedir();
    expect(resolveHome("~")).toBe(home);
    expect(resolveHome("~/path/to/file")).toBe(path.join(home, "path/to/file"));
    expect(resolveHome("~/Documents")).toBe(path.join(home, "Documents"));
  });

  it("should not modify paths without tilde", () => {
    expect(resolveHome("/absolute/path")).toBe("/absolute/path");
    expect(resolveHome("relative/path")).toBe("relative/path");
    expect(resolveHome("C:\\Users\\test")).toBe("C:\\Users\\test");
  });

  it("should handle empty string", () => {
    expect(resolveHome("")).toBe("");
  });
});

describe("resolveTargetPath", () => {
  const workspace = "C:\\Users\\test\\workspace";

  it("should resolve relative paths against workspace", () => {
    expect(resolveTargetPath("src", workspace)).toBe("C:\\Users\\test\\workspace\\src");
    expect(resolveTargetPath("./file.txt", workspace)).toBe("C:\\Users\\test\\workspace\\file.txt");
  });

  it("should not modify absolute paths", () => {
    expect(resolveTargetPath("C:\\Other\\path", workspace)).toBe("C:\\Other\\path");
    expect(resolveTargetPath("/usr/local/bin", workspace)).toBe("/usr/local/bin");
  });

  it("should handle Git Bash paths", () => {
    expect(resolveTargetPath("/c/other/project", workspace)).toBe("C:/other/project");
  });

  it("should handle empty string", () => {
    expect(resolveTargetPath("", workspace)).toBe(workspace);
  });
});

describe("isPathOutsideWorkspace", () => {
  const workspace = "C:\\Users\\test\\workspace";

  it("should return false for paths inside workspace", () => {
    expect(isPathOutsideWorkspace("src", workspace)).toBe(false);
    expect(isPathOutsideWorkspace("src/index.ts", workspace)).toBe(false);
    expect(isPathOutsideWorkspace("./relative", workspace)).toBe(false);
  });

  it("should return true for paths outside workspace", () => {
    expect(isPathOutsideWorkspace("../other", workspace)).toBe(true);
    expect(isPathOutsideWorkspace("C:\\Users\\test\\other", workspace)).toBe(true);
    expect(isPathOutsideWorkspace("D:\\different\\drive", workspace)).toBe(true);
  });

  it("should return false for paths equal to workspace", () => {
    expect(isPathOutsideWorkspace(workspace, workspace)).toBe(false);
  });

  it("should handle Git Bash paths", () => {
    expect(isPathOutsideWorkspace("/c/Users/test/other", workspace)).toBe(true);
    expect(isPathOutsideWorkspace("/c/Users/test/workspace/src", workspace)).toBe(false);
  });

  it("should handle relative paths that stay within workspace", () => {
    expect(isPathOutsideWorkspace("src/../src", workspace)).toBe(false);
  });
});