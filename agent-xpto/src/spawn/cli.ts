/**
 * CLI path resolution utilities
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

/**
 * Resolve the pi CLI script path
 */
export function resolvePiCliPath(): string | undefined {
	try {
		// Try to resolve from process.argv[1]
		const entry = process.argv[1];
		if (entry && fs.existsSync(entry)) {
			const realPath = fs.realpathSync(entry);
			if (/\.(?:mjs|cjs|js)$/i.test(realPath)) {
				return realPath;
			}
		}

		// Try npm global package
		const npmRoot = process.env.APPDATA?.replace("\Roaming", "\Local") 
			?? path.join(os.homedir(), "AppData", "Local");
		const piPackageJson = path.join(npmRoot, "npm", "node_modules", "@mariozechner", "pi-coding-agent", "package.json");
		
		if (fs.existsSync(piPackageJson)) {
			const pkg = JSON.parse(fs.readFileSync(piPackageJson, "utf-8"));
			const binField = pkg.bin;
			const binPath = typeof binField === "string" 
				? binField 
				: binField?.pi ?? Object.values(binField ?? {})[0];
			if (binPath) {
				return path.resolve(path.dirname(piPackageJson), binPath);
			}
		}
	} catch {}
	return undefined;
}

/**
 * Get the pi spawn command
 */
export function getPiSpawnCommand(args: string[]): { command: string; args: string[] } {
	const platform = process.platform;
	if (platform === "win32") {
		const piCliPath = resolvePiCliPath();
		if (piCliPath) {
			return {
				command: process.execPath,
				args: [piCliPath, ...args],
			};
		}
	}
	return { command: "pi", args };
}