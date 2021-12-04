const { createTypeDocApp } = require('./markdown');
const path = require('path');

createTypeDocApp({
  name: 'Class Docs',
  tsconfig: path.resolve(__dirname, '../tsconfig.docs.json'),
  githubPages: true,
  disableSources: true,
  entryPoints: [
    path.resolve(__dirname, '../../packages/core/src/index.ts'),
    path.resolve(__dirname, '../../packages/gl-core/src/index.ts'),
    path.resolve(__dirname, '../../packages/maptalks/src/index.ts'),
    path.resolve(__dirname, '../../packages/mapbox-gl/src/index.ts'),
    path.resolve(__dirname, '../../packages/ol/src/index.ts'),
    path.resolve(__dirname, '../../packages/ol5/src/index.ts'),
    path.resolve(__dirname, '../../packages/openlayers/src/index.ts'),
    path.resolve(__dirname, '../../packages/leaflet/src/index.ts'),
    path.resolve(__dirname, '../../packages/amap/src/index.ts'),
    path.resolve(__dirname, '../../packages/bmap/src/index.ts'),
  ],
}).build();