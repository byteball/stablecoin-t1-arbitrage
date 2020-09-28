/*jslint node: true */
"use strict";
const eventBus = require('ocore/event_bus.js');
const network = require('ocore/network.js');
const conf = require('ocore/conf.js');

const operator = require('aabot/operator.js');
const arb = require('./arb.js');


eventBus.on('headless_wallet_ready', async () => {
	await operator.start();

	if (!conf.arb_aas)
		throw Error("Please specify arb_aas in conf.json");

	network.start();
	await arb.startWatching();
});

process.on('unhandledRejection', up => {
	console.error('unhandledRejection event', up, up.stack);
	throw up;
});
