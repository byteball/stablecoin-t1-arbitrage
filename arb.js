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

let curves = {};
let curvesByArb = {};
let arbsByCurve = {};
let curvesByBuffer = {};

if (conf.arb_aa && !conf.arb_aas)
	conf.arb_aas = [conf.arb_aa];

async function addCurve(curve_aa) {
	const curveAA = await CurveAA.create(curve_aa);
	curves[curve_aa] = curveAA;
}

async function addBuffer(address, curve_aa) {
	curvesByBuffer[address] = curve_aa;
//	await aa_addresses.readAADefinitions([address]);
//	walletGeneral.addWatchedAddress(curve_aa);
//	network.addLightWatchedAa(address);
	await aa_state.followAA(address);
}

async function estimateAndArbAll() {
	for (let arb_aa of conf.arb_aas)
		await estimateAndArb(arb_aa);
}

async function estimateAndArb(arb_aa) {
	const unlock = await mutex.lock('estimate');
	const curve_aa = curvesByArb[arb_aa];
	console.log('===== estimateAndArb arb ' + arb_aa + ' on curve ' + curve_aa);
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
					outputs: [{ address: arb_aa, amount: 1e4 }]
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
	let arrResponses = await aa_composer.estimatePrimaryAATrigger(objUnit, arb_aa, upcomingStateVars, upcomingBalances);
	console.log(`--- estimated responses to simulated arb request`, JSON.stringify(arrResponses, null, 2));
	aa_unlock();
	if (arrResponses[0].bounced)
		return finish(`${arb_aa}/${curve_aa} would bounce: ` + arrResponses[0].response.error);
	const balances = upcomingBalances[arb_aa];
	for (let asset in balances)
		if (balances[asset] < 0)
			return finish(`${arb_aa}/${curve_aa}: ${asset} balance would become negative: ${balances[asset]}`);
	const vars = arrResponses[0].updatedStateVars[curve_aa];
//	const reserve_delta = vars.reserve.delta;
//	if (Math.abs(reserve_delta) < conf.min_reserve_delta)
//		return finish(`${arb_aa}/${curve_aa}: too small reserve delta: ` + reserve_delta);
	const distance_delta = vars.p2.delta / vars.p2.value;
	if (Math.abs(distance_delta) < conf.min_distance_delta)
		return finish(`${arb_aa}/${curve_aa}: too small distance delta: ` + distance_delta);
	console.log(`estimateAndArb: ${arb_aa}/${curve_aa} would succeed`);
	const unit = await dag.sendAARequest(arb_aa, { arb: 1 });
	if (!unit)
		return finish(`sending arb request failed`);
	const objJoint = await dag.readJoint(unit);
	// upcoming state vars are updated and the next request will see them
	console.log(`estimateAndArb: ${arb_aa}/${curve_aa} calling onAARequest manually`);
	await aa_state.onAARequest({ unit: objJoint.unit, aa_address: arb_aa });
	unlock();
}


function onAAResponse(objAAResponse) {
//	console.log(`AA response:`, JSON.stringify(objAAResponse, null, 2));
	if (objAAResponse.bounced && objAAResponse.trigger_address === operator.getAddress())
		return console.log(`=== our request ${objAAResponse.trigger_unit} bounced with error`, objAAResponse.response.error);
	const aa_address = objAAResponse.aa_address;
	if (curves[aa_address]) {
		const curve_aa = aa_address;
		console.log(`new response from the curve ${curve_aa}, will check for arb opportunities`);
		estimateAndArb(arbsByCurve[curve_aa]);
	}
	else if (curvesByBuffer[aa_address])
		return console.log(`new response from buffer ${aa_address} on the curve ${curvesByBuffer[aa_address]}, will skip`);
	else
		return console.log(`new response from unknown AA ${aa_address}`);
}

function onAARequest(objAARequest) {
//	console.log(`AA request:`, JSON.stringify(objAARequest, null, 2));
	if (objAARequest.unit.authors[0].address === operator.getAddress())
		return console.log(`skipping our own request`);
	const aa_address = objAARequest.aa_address;
	if (curves[aa_address]) {
		const curve_aa = aa_address;
		console.log(`new request to the curve ${curve_aa}, will check for arb opportunities`);
		estimateAndArb(arbsByCurve[curve_aa]);
	}
	else if (curvesByBuffer[aa_address]) {
		const curve_aa = curvesByBuffer[aa_address];
		const objUnit = objAARequest.unit;
		const dataMessage = objUnit.messages.find(m => m.app === 'data');
		if (dataMessage && dataMessage.payload.execute) {
			console.log(`new request to buffer ${aa_address} on the curve ${curve_aa}, will check for arb opportunities`);
			estimateAndArb(arbsByCurve[curve_aa]);
		}
		else
			return console.log(`new request to deposit funds to buffer ${aa_address} on the curve ${curve_aa}, will skip`);
	}
	else
		return console.log(`new request to unknown AA ${aa_address}`);
}


async function startWatching() {
	for (let arb_aa of conf.arb_aas) {
		await aa_state.followAA(arb_aa);
	
		// init the curve
		const params = await dag.readAAParams(arb_aa);
		const curve_aa = params.curve_aa;
		curvesByArb[arb_aa] = curve_aa;
		if (arbsByCurve[curve_aa])
			throw Error(`curve ${curve_aa} is already arbed`);
		arbsByCurve[curve_aa] = arb_aa;
		await addCurve(curve_aa);
	}

	// init the buffers linked to this curve
	await dag.loadAA(conf.buffer_base_aa);
	network.addLightWatchedAa(conf.buffer_base_aa); // to learn when new buffer AAs are defined based on it
	const rows = await dag.getAAsByBaseAAs([conf.buffer_base_aa]);
	for (let row of rows) {
		let curve_aa = row.definition[1].params.curve_aa;
		if (curves[curve_aa])
			await addBuffer(row.address, curve_aa);
	}

	eventBus.on("aa_request_applied", onAARequest);
	eventBus.on("aa_response_applied", onAAResponse);
	eventBus.on("aa_definition_applied-" + conf.buffer_base_aa, async (address, definition) => {
		let curve_aa = definition[1].params.curve_aa;
		if (curves[curve_aa])
			await addBuffer(address, curve_aa);
	});
	eventBus.on('data_feeds_updated', estimateAndArbAll);

	setTimeout(estimateAndArbAll, 1000);
}


exports.startWatching = startWatching;

