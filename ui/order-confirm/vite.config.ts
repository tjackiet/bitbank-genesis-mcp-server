import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

// MCP Apps (SEP-1865): 注文確認 UI を単一 HTML にバンドルする。
// 成果物は `ui/order-confirm/dist/order-confirm.html` に出力され、
// サーバー側 `src/resources/app-resources.ts` から読み込まれる。
export default defineConfig({
	root: __dirname,
	plugins: [react(), viteSingleFile()],
	build: {
		outDir: resolve(__dirname, 'dist'),
		emptyOutDir: true,
		rollupOptions: {
			input: resolve(__dirname, 'order-confirm.html'),
		},
		// MCP Apps の iframe 環境を狙ったインライン化
		assetsInlineLimit: 100_000_000,
		cssCodeSplit: false,
		sourcemap: false,
		minify: 'esbuild',
	},
});
