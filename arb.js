"use strict";
const _ = require('lodash');

const eventBus = require('ocore/event_bus.js');
const conf = require('ocore/conf.js');
const mutex = require('ocore/mutex.js');
const network = require('ocore/network.js');
const aa_composer = require("ocore/aa_composer.js");

const dag = require('aabot/dag.js');
const operator = require('aabot/operator.js');
const aa_state = require('aabot/aa_state.js');
const CurveAA = require('./curve.js');

let curve_aa;

let curves = {};
let buffers = {};

async function addCurve(curve_aa) {
	const curveAA = await CurveAA.create(curve_aa);
	curves[curve_aa] = curveAA;
}

async function addBuffer(address) {
	buffers[address] = curve_aa;
//	await aa_addresses.readAADefinitions([address]);
//	walletGeneral.addWatchedAddress(curve_aa);
//	network.addLightWatchedAa(address);
	await aa_state.followAA(address);
}

async function estimateAndArb() {
	const unlock = await mutex.lock('estimate');
	console.log('===== estimateAndArb');
	const finish = msg => {
		console.log(msg);
		unlock();
	};
	// simulate an arb request
	const aa_unlock = await aa_state.lock();
	let upcomingStateVars = _.cloneDeep(aa_state.getUpcomingStateVars());
	let upcomingBalances = _.cloneDeep(aa_state.getUpcomingBalances());
	let objUnit = {
		unit: 'dummy_trigger_unit',
		authors: [{ address: operator.getAddress() }],
		messages: [
			{
				app: 'payment',
				payload: {
					outputs: [{ address: conf.arb_aa, amount: 1e4 }]
				}
			},
			{
				app: 'data',
				payload: {
					arb: 1
				}
			},
		]
	};
	let curveAA = curves[curve_aa];
	await curveAA.updateDataFeeds(false, true);
	let arrResponses = await aa_composer.estimatePrimaryAATrigger(objUnit, conf.arb_aa, upcomingStateVars, upcomingBalances);
	console.log(`--- estimated responses to simulated arb request`, JSON.stringify(arrResponses, null, 2));
	aa_unlock();
	if (arrResponses[0].bounced)
		return finish(`would bounce: ` + arrResponses[0].response.error);
	const unit = await dag.sendAARequest(conf.arb_aa, { arb: 1 });
	if (!unit)
		return finish(`sending arb request failed`);
	const objJoint = await dag.readJoint(unit);
	// upcoming state vars are updated and the next request will see them
	console.log(`estimateAndArb: calling onAARequest manually`);
	await aa_state.onAARequest({ unit: objJoint.unit, aa_address: conf.arb_aa });
	unlock();
}


function onAAResponse(objAAResponse) {
//	console.log(`AA response:`, JSON.stringify(objAAResponse, null, 2));
	if (objAAResponse.bounced && objAAResponse.trigger_address === operator.getAddress())
		return console.log(`=== our request ${objAAResponse.trigger_unit} bounced with error`, objAAResponse.response.error);
	const aa_address = objAAResponse.aa_address;
	if (aa_address === curve_aa)
		console.log(`new response from the curve ${curve_aa}, will check for arb opportunities`);
	else if (buffers[aa_address] === curve_aa)
		return console.log(`new response from buffer ${aa_address} on the curve ${curve_aa}, will skip`);
	else
		return console.log(`new response from unknown AA ${aa_address}`);
	estimateAndArb();
}

function onAARequest(objAARequest) {
//	console.log(`AA request:`, JSON.stringify(objAARequest, null, 2));
	if (objAARequest.unit.authors[0].address === operator.getAddress())
		return console.log(`skipping our own request`);
	const aa_address = objAARequest.aa_address;
	if (aa_address === curve_aa)
		console.log(`new request to the curve ${curve_aa}, will check for arb opportunities`);
	else if (buffers[aa_address] === curve_aa) {
		const objUnit = objAARequest.unit;
		const dataMessage = objUnit.messages.find(m => m.app === 'data');
		if (dataMessage.payload.execute)
			console.log(`new request to buffer ${aa_address} on the curve ${curve_aa}, will check for arb opportunities`);
		else
			return console.log(`new request to deposit funds to buffer ${aa_address} on the curve ${curve_aa}, will skip`);
	}
	else
		return console.log(`new request to unknown AA ${aa_address}`);
	estimateAndArb();
}


async function startWatching() {
	await aa_state.followAA(conf.arb_aa);
	
	// init the curve
	const params = await dag.readAAParams(conf.arb_aa);
	curve_aa = params.curve_aa;
	await addCurve(curve_aa);
	
	// init the buffers linked to this curve
	await dag.loadAA(conf.buffer_base_aa);
	network.addLightWatchedAa(conf.buffer_base_aa); // to learn when new buffer AAs are defined based on it
	const rows = await dag.getAAsByBaseAAs([conf.buffer_base_aa]);
	for (let row of rows) {
		if (row.definition[1].params.curve_aa !== curve_aa)
			continue;
		await addBuffer(row.address);
	}

	eventBus.on("aa_request_applied", onAARequest);
	eventBus.on("aa_response_applied", onAAResponse);
	eventBus.on("aa_definition_applied-" + conf.buffer_base_aa, addBuffer);
	eventBus.on('data_feeds_updated', estimateAndArb);

	setTimeout(estimateAndArb, 1000);
}


exports.startWatching = startWatching;

