import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
	plugins: [tsconfigPaths()],
	test: {
		environment: "node",
		include: ["plugins/**/*.test.ts"],
		exclude: ["**/*.spec.ts"],
	},
});
