/// <reference types="vite/client" />
/// <reference path="../electron.d.ts" />

// Fallbacks: in some TS server states, the vite/client augmentation may not apply,
// which produces "Property 'env' does not exist on type 'ImportMeta'".
// Keeping this minimal avoids drifting from Vite's actual env typing.
interface ImportMetaEnv {
	readonly BASE_URL: string
	[key: string]: any
}

interface ImportMeta {
	readonly env: ImportMetaEnv
}
