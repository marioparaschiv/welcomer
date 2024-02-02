

import sourcemaps from 'source-map-support';
sourcemaps.install();

import Client from '@structures/client';
new Client().start();

process.on('uncaughtException', () => null);
process.on('unhandledRejection', () => null);