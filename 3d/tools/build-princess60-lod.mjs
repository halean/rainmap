// Build Nha Rong's far-view proxies (see build-lod.mjs, which does the work).
// node --loader ./tests/three-loader.mjs 3d/tools/build-princess60-lod.mjs <cell metres> <level>
// The viewer uses level 1 (0.14 m cells) and level 2 (0.35 m cells).
process.argv.splice(2, 0, 'princess60');
await import('./build-lod.mjs');
