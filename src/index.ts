

import sourcemaps from 'source-map-support';
sourcemaps.install();

import Constants from 'discord.js-selfbot-v13/src/util/Constants';
import config from '@../config.json';

Constants.UserAgent = config.userAgent;

import Client from '@structures/client';

new Client().start();

process.on('uncaughtException', () => null);
process.on('unhandledRejection', () => null);