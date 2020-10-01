/*jslint node: true */
"use strict";

//exports.port = 6611;
//exports.myUrl = 'wss://mydomain.com/bb';

// for local testing
//exports.WS_PROTOCOL === 'ws://';
//exports.port = 16611;
//exports.myUrl = 'ws://127.0.0.1:' + exports.port;

exports.bServeAsHub = false;
exports.bLight = true;

exports.storage = 'sqlite';

exports.hub = process.env.testnet ? 'obyte.org/bb-test' : 'obyte.org/bb';
exports.deviceName = 'Reserve-to-t1 arbitrage bot';
exports.permanent_pairing_secret = '*';
exports.control_addresses = ['DEVICE ALLOWED TO CHAT'];
exports.payout_address = 'WHERE THE MONEY CAN BE SENT TO';
exports.bSingleAddress = true;
exports.bWantNewPeers = true;
exports.KEYS_FILENAME = 'keys.json';

// TOR
exports.socksHost = '127.0.0.1';
exports.socksPort = 9050;

exports.bNoPassphrase = true;

exports.explicitStart = true;

exports.min_reserve_delta = 1e8;
exports.min_distance_delta = 1e-3;

exports.arb_aas = ['']; // set in conf.json
exports.buffer_base_aa = 'VXY4L4NGFQ773NOQKUFFVJEWLZUBCYHI';


console.log('finished arb conf');
