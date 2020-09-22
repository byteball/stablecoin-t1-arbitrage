"use strict";

const eventBus = require('ocore/event_bus.js');
const conf = require('ocore/conf.js');
const dag = require('aabot/dag.js');
const aa_state = require('aabot/aa_state.js');
const light_data_feeds = conf.bLight ? require('aabot/light_data_feeds.js') : null;

const ORACLE_UPDATE_INTERVAL = 2 * 60 * 1000;

class CurveAA {
	#curve_aa;
	#params;
	#oracles;
	
	constructor(curve_aa, params, oracles) {
		this.#curve_aa = curve_aa;
		this.#params = params;
		this.#oracles = oracles;
		setInterval(() => this.updateDataFeeds(), ORACLE_UPDATE_INTERVAL);
	}

	static async create(curve_aa) {
		const params = await dag.readAAParams(curve_aa);
		const oracles = await dag.executeGetter(curve_aa, 'get_oracles');

		if (conf.bLight)
			for (let oracle of oracles)
				await light_data_feeds.updateDataFeed(oracle.oracle, oracle.feed_name);

		await aa_state.followAA(curve_aa);

		return new CurveAA(curve_aa, params, oracles);
	}

	async updateDataFeeds(bForce, bQuiet) {
		if (!conf.bLight)
			return;
		let bUpdated = false;
		for (let oracle of this.#oracles)
			if (await light_data_feeds.updateDataFeed(oracle.oracle, oracle.feed_name, bForce))
				bUpdated = true;
		if (bUpdated && !bQuiet)
			eventBus.emit('data_feeds_updated');
	}

}

module.exports = CurveAA;
