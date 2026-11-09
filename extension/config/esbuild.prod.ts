/**
 * Vendored from easyeda/pro-api-sdk (Apache-2.0), adapted for pcb-pilot.
 * Source: https://github.com/easyeda/pro-api-sdk/blob/main/config/esbuild.prod.ts
 */
import process from 'node:process';
import esbuild from 'esbuild';
import common from './esbuild.common.ts';

(async () => {
	const ctx = await esbuild.context(common);
	if (process.argv.includes('--watch')) {
		await ctx.watch();
	}
	else {
		await ctx.rebuild();
		process.exit();
	}
})();