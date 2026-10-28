import { defineConfig } from "vite";

export default defineConfig({
	build: {
		outDir: "dist/client",
		emptyOutDir: true,
		target: "es2022",
		chunkSizeWarningLimit: 1800,
		rollupOptions: {
			output: {
				manualChunks: {
					phaser: ["phaser"],
				},
			},
		},
	},
	server: {
		port: 5173,
		proxy: {
			"/api": {
				target: "http://127.0.0.1:8788",
				changeOrigin: true,
			},
		},
	},
});
