/**
 * Unit tests for tool target path extraction.
 */

import { describe, it, expect } from "vitest";
import { getToolTargetPath } from "./internal";

describe("getToolTargetPath", () => {
  describe("write tool", () => {
    it("should extract path from write tool input", () => {
      const event = {
        toolName: "write",
        input: { path: "/workspace/src/file.ts" },
      };
      expect(getToolTargetPath(event)).toBe("/workspace/src/file.ts");
    });

    it("should extract Windows path from write tool", () => {
      const event = {
        toolName: "write",
        input: { path: "C:\\Users\\test\\file.txt" },
      };
      expect(getToolTargetPath(event)).toBe("C:\\Users\\test\\file.txt");
    });

    it("should return null if no path in input", () => {
      const event = {
        toolName: "write",
        input: {},
      };
      expect(getToolTargetPath(event)).toBeNull();
    });
  });

  describe("edit tool", () => {
    it("should extract path from edit tool input", () => {
      const event = {
        toolName: "edit",
        input: { path: "/workspace/src/file.ts" },
      };
      expect(getToolTargetPath(event)).toBe("/workspace/src/file.ts");
    });

    it("should return null for edit without path", () => {
      const event = {
        toolName: "edit",
        input: { something: "else" },
      };
      expect(getToolTargetPath(event)).toBeNull();
    });
  });

  describe("read tool", () => {
    it("should extract path from read tool input", () => {
      const event = {
        toolName: "read",
        input: { path: "/workspace/src/file.ts" },
      };
      expect(getToolTargetPath(event)).toBe("/workspace/src/file.ts");
    });
  });

  describe("bash tool", () => {
    it("should return null for bash without paths", () => {
      const event = {
        toolName: "bash",
        input: { command: "echo hello" },
      };
      expect(getToolTargetPath(event)).toBeNull();
    });

    it("should handle bash command with quoted paths", () => {
      const event = {
        toolName: "bash",
        input: { command: "mv '/path with spaces' '/dest/file'" },
      };
      expect(getToolTargetPath(event)).toBe("/path with spaces");
    });

    it("should extract first quoted path", () => {
      const event = {
        toolName: "bash",
        input: { command: "cat '/path with spaces/file.txt'" },
      };
      expect(getToolTargetPath(event)).toBe("/path with spaces/file.txt");
    });
  });

  describe("other tools", () => {
    it("should return null for unknown tools", () => {
      const event = {
        toolName: "unknown",
        input: { path: "/some/path" },
      };
      expect(getToolTargetPath(event)).toBeNull();
    });

    it("should return null for tools without path", () => {
      const event = {
        toolName: "search",
        input: { query: "test" },
      };
      expect(getToolTargetPath(event)).toBeNull();
    });
  });
});