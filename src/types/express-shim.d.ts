declare module 'express' {
	import type { Express } from 'express-serve-static-core';
	interface ExpressFactory {
		(): Express;
		json(options?: { limit?: string }): import('express-serve-static-core').RequestHandler;
	}
	const e: ExpressFactory;
	export default e;
}
