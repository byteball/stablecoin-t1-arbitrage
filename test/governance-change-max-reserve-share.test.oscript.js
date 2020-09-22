const path = require('path')
// eslint-disable-next-line no-unused-vars
const { Testkit, Utils } = require('aa-testkit')
const formulaCommon = require('ocore/formula/common.js');
const { expect } = require('chai');
const { Network } = Testkit({
	TESTDATA_DIR: path.join(__dirname, '../testdata'),
})

function round(n, precision) {
	return Math.round(n * 10 ** precision) / 10 ** precision;
}

describe('Governance change max_reserve_share', function () {
	this.timeout(120 * 1000)


	before(async () => {
		this.network = await Network.create()
			.with.numberOfWitnesses(1)
			.with.agent({ bank: path.join(__dirname, '../node_modules/bank-aa/bank.oscript') })
			.with.agent({ bs: path.join(__dirname, '../node_modules/bonded-stablecoin/bonded-stablecoin.oscript') })
			.with.agent({ bsf: path.join(__dirname, '../node_modules/bonded-stablecoin/bonded-stablecoin-factory.oscript') })
			.with.agent({ daf2: path.join(__dirname, '../node_modules/bonded-stablecoin/define-asset2-forwarder.oscript') })
			.with.agent({ governance: path.join(__dirname, '../node_modules/bonded-stablecoin/governance.oscript') })
			.with.agent({ deposits: path.join(__dirname, '../node_modules/bonded-stablecoin/deposits.oscript') })
			.with.agent({ arb_governance: path.join(__dirname, '../governance.oscript') })
			.with.agent({ arb: path.join(__dirname, '../arbitrage-t1.oscript') })
			.with.agent({ arbFactory: path.join(__dirname, '../arbitrage-t1-factory.oscript') })
			.with.wallet({ oracle: 1e9 })
			.with.wallet({ alice: 10000e9 })
			.with.wallet({ bob: 1000e9 })
		//	.with.explorer()
			.run()
		console.log('--- agents\n', this.network.agent)
	//	console.log('--- wallets\n', this.network.wallet)
		this.oracle = this.network.wallet.oracle
		this.oracleAddress = await this.oracle.getAddress()
		this.alice = this.network.wallet.alice
		this.aliceAddress = await this.alice.getAddress()
		this.bob = this.network.wallet.bob
		this.bobAddress = await this.bob.getAddress()
	//	this.explorer = await this.network.newObyteExplorer().ready()
		
		const balance = await this.bob.getBalance()
		console.log(balance)
		expect(balance.base.stable).to.be.equal(1000e9)
	})


	it('Post data feed', async () => {
		const price = 20
		const { unit, error } = await this.oracle.sendMulti({
			messages: [{
				app: 'data_feed',
				payload: {
					GBYTE_USD: price,
				}
			}],
		})

		expect(error).to.be.null
		expect(unit).to.be.validUnit

		const { unitObj } = await this.oracle.getUnitInfo({ unit: unit })
		const dfMessage = unitObj.messages.find(m => m.app === 'data_feed')
		expect(dfMessage.payload.GBYTE_USD).to.be.equal(20)
		await this.network.witnessUntilStable(unit)

		this.target_p2 = 1/price
	})
	
	it('Bob defines a new stablecoin', async () => {
		const { error: tf_error } = await this.network.timefreeze()
		expect(tf_error).to.be.null

		this.ts = Math.round(Date.now() / 1000)
		this.fee_multiplier = 5
		this.interest_rate = 0.1
		this.reserve_asset = 'base'
		this.decimals1 = 6
		const { unit, error } = await this.bob.triggerAaWithData({
			toAddress: this.network.agent.bsf,
			amount: 15000,
			data: {
				reserve_asset: this.reserve_asset,
				reserve_asset_decimals: 9,
				decimals1: this.decimals1,
				decimals2: 2,
				m: 2,
				n: 0.5,
				interest_rate: this.interest_rate,
				allow_grants: true,
				oracle1: this.oracleAddress,
				feed_name1: 'GBYTE_USD',
			},
		})
		console.log(unit, error)

		expect(error).to.be.null
		expect(unit).to.be.validUnit

		const { response } = await this.network.getAaResponseToUnitOnNode(this.bob, unit)
	//	const { response } = await this.network.getAaResponseToUnit(unit)
	//	await this.network.witnessUntilStable(response.response_unit)

		expect(response.response.error).to.be.undefined
		expect(response.bounced).to.be.false
		expect(response.response_unit).to.be.validUnit

		const { vars } = await this.bob.readAAStateVars(this.network.agent.bsf)
		console.log('vars', vars)
		expect(Object.keys(vars).length).to.be.equal(6)
		for (let name in vars) {
			if (name.startsWith('curve_')) {
				this.curve_aa = name.substr(6)
				expect(vars[name]).to.be.equal("s1^2 s2^0.5")
			}
		}
		this.asset1 = vars['asset_' + this.curve_aa + '_1'];
		this.asset2 = vars['asset_' + this.curve_aa + '_2'];
		this.asset_stable = vars['asset_' + this.curve_aa + '_stable'];
		this.deposit_aa = vars['deposit_aa_' + this.curve_aa];
	//	this.governance_aa = vars['governance_aa_' + this.curve_aa];

		const { vars: curve_vars } = await this.bob.readAAStateVars(this.curve_aa)
		console.log('curve vars', curve_vars, this.curve_aa)
		expect(curve_vars['asset1']).to.be.equal(this.asset1)
		expect(curve_vars['asset2']).to.be.equal(this.asset2)
	//	expect(curve_vars['governance_aa']).to.be.equal(this.governance_aa)
		expect(curve_vars['growth_factor']).to.be.equal(1)
		expect(curve_vars['dilution_factor']).to.be.equal(1)
		expect(curve_vars['interest_rate']).to.be.equal(0.1)
		expect(parseInt(curve_vars['rate_update_ts'])).to.be.eq(this.ts)

		this.getReserve = (s1, s2) => Math.ceil(1e9*(s1/10**this.decimals1)**2 * (s2/1e2)**0.5)
		this.getP2 = (s1, s2) => (s1/10**this.decimals1)**2 * 0.5 / (s2/1e2)**0.5
		this.getP1 = () => 2 * (this.supply1/10**this.decimals1) * (this.supply2/1e2)**0.5 * 10**(9-this.decimals1)
		this.getFee = (avg_reserve, old_distance, new_distance) => Math.ceil(avg_reserve * (new_distance**2 - old_distance**2) * this.fee_multiplier);

		this.buy = (tokens1, tokens2) => {
			const new_supply1 = this.supply1 + tokens1
			const new_supply2 = this.supply2 + tokens2
			const new_reserve = this.getReserve(new_supply1, new_supply2)
			const amount = new_reserve - this.reserve
			const abs_reserve_delta = Math.abs(amount)
			const avg_reserve = (this.reserve + new_reserve)/2
			const p2 = this.getP2(new_supply1, new_supply2)
	
			const old_distance = this.reserve ? Math.abs(this.p2 - this.target_p2) / this.target_p2 : 0
			const new_distance = Math.abs(p2 - this.target_p2) / this.target_p2
			let fee = this.getFee(avg_reserve, old_distance, new_distance);
			if (fee > 0) {
				const reverse_reward = Math.floor((1 - old_distance / new_distance) * this.fast_capacity); // rough approximation
			}

			const fee_percent = round(fee / abs_reserve_delta * 100, 4)
			const reward = old_distance ? Math.floor((1 - new_distance / old_distance) * this.fast_capacity) : 0;
			const reward_percent = round(reward / abs_reserve_delta * 100, 4)

			console.log('p2 =', p2, 'target p2 =', this.target_p2, 'amount =', amount, 'fee =', fee, 'reward =', reward, 'old distance =', old_distance, 'new distance =', new_distance, 'fast capacity =', this.fast_capacity)
	
			this.p2 = p2
			this.distance = new_distance
			if (fee > 0) {
				this.slow_capacity += Math.floor(fee / 2)
				this.fast_capacity += fee - Math.floor(fee / 2)
			}
			else if (reward > 0)
				this.fast_capacity -= reward
			
			if (fee > 0 && reward > 0)
				throw Error("both fee and reward are positive");
			if (fee < 0 && reward < 0)
				throw Error("both fee and reward are negative");
	
			this.supply1 += tokens1
			this.supply2 += tokens2
			this.reserve += amount
	
			return { amount, fee, fee_percent, reward, reward_percent }
		}

		this.get_exchange_data = () => {
			const target_s1 = (this.target_p2 / 0.5 * (this.supply2 / 1e2) ** (1 - 0.5)) ** (1 / 2)
			const tokens1 = Math.round(target_s1 * 10**this.decimals1) - this.supply1
			const new_reserve = this.getReserve(this.supply1 + tokens1, this.supply2)
			const reserve_delta = new_reserve - this.reserve

			// reward
			const old_distance = Math.abs(this.p2 - this.target_p2) / this.target_p2
			const p2 = this.getP2(this.supply1 + tokens1, this.supply2)
			const new_distance = Math.abs(p2 - this.target_p2) / this.target_p2
			const reward = Math.floor((1 - new_distance / old_distance) * this.fast_capacity)
			const reserve_needed = reserve_delta - reward + 1000

			console.log('exchange data', { tokens1, reserve_delta, reserve_needed, reward })
			return { tokens1, reserve_delta, reserve_needed, reward, p2 }
		}

		this.supply1 = 0
		this.supply2 = 0
		this.reserve = 0
		this.slow_capacity = 0;
		this.fast_capacity = 0;
		this.distance = 0
	})


	it('Alice buys tokens', async () => {
		const tokens1 = 1e6
		const tokens2 = 100e2
		const { amount, fee, fee_percent } = this.buy(tokens1, tokens2)

		const { unit, error } = await this.alice.triggerAaWithData({
			toAddress: this.curve_aa,
			amount: amount + 1000,
			data: {
				tokens1: tokens1,
				tokens2: tokens2,
			},
		})

		expect(error).to.be.null
		expect(unit).to.be.validUnit

		const { response } = await this.network.getAaResponseToUnit(unit)
	//	await this.network.witnessUntilStable(response.response_unit)

		expect(response.response.error).to.be.undefined
		expect(response.bounced).to.be.false
		expect(response.response_unit).to.be.validUnit

		const { vars } = await this.alice.readAAStateVars(this.curve_aa)
		console.log(vars)
		expect(vars['supply1']).to.be.equal(this.supply1)
		expect(vars['supply2']).to.be.equal(this.supply2)
		expect(vars['reserve']).to.be.equal(this.reserve)
		expect(parseFloat(parseFloat(vars['p2']).toPrecision(13))).to.be.equal(this.p2)
		expect(vars['slow_capacity']).to.be.undefined
		expect(vars['fast_capacity']).to.be.undefined
		expect(vars['lost_peg_ts']).to.be.undefined

		const { unitObj } = await this.alice.getUnitInfo({ unit: response.response_unit })
	//	console.log(JSON.stringify(unitObj, null, '\t'))
		expect(Utils.getExternalPayments(unitObj)).to.deep.equalInAnyOrder([
			{
				address: this.aliceAddress,
				asset: this.asset1,
				amount: tokens1,
			},
			{
				address: this.aliceAddress,
				asset: this.asset2,
				amount: tokens2,
			},
		])

	})

	
	it('Bob defines a new arbitrage AA', async () => {
		this.max_reserve_share = 0.2
		this.min_reserve_share = 0.1
		this.triggerer_reward_share = 0.1
		this.min_reserve_delta = 1e5
		const { unit, error } = await this.bob.triggerAaWithData({
			toAddress: this.network.agent.arbFactory,
			amount: 10000,
			data: {
				curve_aa: this.curve_aa,
				max_reserve_share: this.max_reserve_share,
				min_reserve_share: this.min_reserve_share,
				triggerer_reward_share: this.triggerer_reward_share,
				min_reserve_delta: this.min_reserve_delta,
			},
		})
		console.log(unit, error)

		expect(error).to.be.null
		expect(unit).to.be.validUnit

		const { response } = await this.network.getAaResponseToUnitOnNode(this.bob, unit)
	//	const { response } = await this.network.getAaResponseToUnit(unit)
	//	await this.network.witnessUntilStable(response.response_unit)

		expect(response.response.error).to.be.undefined
		expect(response.bounced).to.be.false
		expect(response.response_unit).to.be.validUnit

		this.arb_aa = response.response.responseVars.address
		expect(this.arb_aa).to.be.validAddress

		const { vars } = await this.bob.readAAStateVars(this.network.agent.arbFactory)
		console.log('vars', vars)
		expect(Object.keys(vars).length).to.be.equal(1)

		const { vars: arb_vars } = await this.bob.readAAStateVars(this.arb_aa)
		console.log('arb vars', arb_vars)
		this.shares_asset = arb_vars['shares_asset']
		this.governance_aa = arb_vars['governance_aa'];
		expect(this.shares_asset).to.be.validUnit
		expect(this.governance_aa).to.be.validAddress

		expect(vars['arb_' + this.arb_aa]).to.be.deep.equalInAnyOrder({
			curve_aa: this.curve_aa,
			reserve_asset: this.reserve_asset,
			asset1: this.asset1,
			asset2: this.asset2,
			max_reserve_share: this.max_reserve_share,
			min_reserve_share: this.min_reserve_share,
			triggerer_reward_share: this.triggerer_reward_share,
			min_reserve_delta: this.min_reserve_delta,
			shares_asset: this.shares_asset,
		})
		const balances = await this.bob.getOutputsBalanceOf(this.arb_aa)
		this.arb_reserve_balance = balances.base.stable + balances.base.pending
		this.arb_asset1_balance = 0
	})


	it('Alice buys shares in arbitrage AA', async () => {
		const amount = 10e9

		const { unit, error } = await this.alice.sendBytes({
			toAddress: this.arb_aa,
			amount: amount,
			spend_unconfirmed: 'all',
		})

		expect(error).to.be.null
		expect(unit).to.be.validUnit

		const { response } = await this.network.getAaResponseToUnit(unit)
		await this.network.witnessUntilStable(response.response_unit)

		expect(response.response.error).to.be.undefined
		expect(response.bounced).to.be.false
		expect(response.response_unit).to.be.validUnit

		const { vars } = await this.alice.readAAStateVars(this.arb_aa)
		console.log(vars)
		expect(vars['shares_supply']).to.be.equal(amount)

		const { unitObj } = await this.alice.getUnitInfo({ unit: response.response_unit })
	//	console.log(JSON.stringify(unitObj, null, '\t'))
		expect(Utils.getExternalPayments(unitObj)).to.deep.equalInAnyOrder([{
			address: this.aliceAddress,
			asset: this.shares_asset,
			amount: amount,
		}])

		this.shares_supply = amount

		this.arb_reserve_balance += amount - unitObj.headers_commission - unitObj.payload_commission

		const balances = await this.alice.getOutputsBalanceOf(this.arb_aa)
		expect(balances).to.deep.equalInAnyOrder({ base: { stable: this.arb_reserve_balance, pending: 0, total: this.arb_reserve_balance } })
	})


	it('Alice votes for increase of max_reserve_share to 0.5', async () => {
		const shares = Math.floor(this.shares_supply / 4)
		const name = 'max_reserve_share'
		const value = 0.5

		const { unit, error } = await this.alice.sendMulti({
			asset: this.shares_asset,
			base_outputs: [{ address: this.governance_aa, amount: 1e4 }],
			asset_outputs: [{ address: this.governance_aa, amount: shares }],
			spend_unconfirmed: 'all',
			messages: [{
				app: 'data',
				payload: {
					name: name,
					value: value
				}
			}]
		})

		expect(error).to.be.null
		expect(unit).to.be.validUnit

		const { response } = await this.network.getAaResponseToUnit(unit)
	//	await this.network.witnessUntilStable(response.response_unit)

		expect(response.response.error).to.be.undefined
		expect(response.bounced).to.be.false
		expect(response.response_unit).to.be.null

		const { vars } = await this.alice.readAAStateVars(this.governance_aa)
		console.log(vars)
		expect(vars['support_' + name + '_' + value]).to.be.equal(shares)
		expect(vars['support_' + name + '_' + value + '_' + this.aliceAddress]).to.be.equal(shares)
		expect(vars['leader_' + name]).to.be.equal(value)
		expect(vars['balance_' + this.aliceAddress]).to.be.equal(shares)

		const { unitObj } = await this.alice.getUnitInfo({ unit })
	//	console.log(JSON.stringify(unitObj, null, '\t'))
		expect(vars['challenging_period_start_ts_' + name]).to.be.equal(unitObj.timestamp)

		this.name = name
		this.value = value
		this.shares = shares
	})

	it('Alice also votes for pausing of further investments', async () => {
		const name = 'investments_paused'
		const value = 1

		const { unit, error } = await this.alice.triggerAaWithData({
			toAddress: this.governance_aa,
			amount: 1e4,
			spend_unconfirmed: 'all',
			data: {
				name: name,
				value: value
			}
		})

		expect(error).to.be.null
		expect(unit).to.be.validUnit

		const { response } = await this.network.getAaResponseToUnit(unit)
	//	await this.network.witnessUntilStable(response.response_unit)

		expect(response.response.error).to.be.undefined
		expect(response.bounced).to.be.false
		expect(response.response_unit).to.be.null

		const { vars } = await this.alice.readAAStateVars(this.governance_aa)
		console.log(vars)
		expect(vars['support_' + name + '_' + value]).to.be.equal(this.shares)
		expect(vars['support_' + name + '_' + value + '_' + this.aliceAddress]).to.be.equal(this.shares)
		expect(vars['leader_' + name]).to.be.equal(value)
		expect(vars['balance_' + this.aliceAddress]).to.be.equal(this.shares)

		const { unitObj } = await this.alice.getUnitInfo({ unit })
	//	console.log(JSON.stringify(unitObj, null, '\t'))
		expect(vars['challenging_period_start_ts_' + name]).to.be.equal(unitObj.timestamp)
	})


	it('Bob tries to commit too early but unsuccessful', async () => {
		const { unit, error } = await this.bob.triggerAaWithData({
			toAddress: this.governance_aa,
			amount: 1e4,
			spend_unconfirmed: 'all',
			data: {
				name: this.name,
				commit: 1,
			}
		})

		expect(error).to.be.null
		expect(unit).to.be.validUnit

		const { response } = await this.network.getAaResponseToUnit(unit)
	//	await this.network.witnessUntilStable(response.response_unit)

		expect(response.response.error).to.be.equal('challenging period not expired yet')
		expect(response.bounced).to.be.true
		expect(response.response_unit).to.be.null

	})


	it('Bob waits for 5 days and then commits successfully', async () => {
		const { time_error } = await this.network.timetravel({shift: '7d'})
		expect(time_error).to.be.undefined

		const { unit, error } = await this.bob.triggerAaWithData({
			toAddress: this.governance_aa,
			amount: 1e4,
			spend_unconfirmed: 'all',
			data: {
				name: this.name,
				commit: 1,
			}
		})

		expect(error).to.be.null
		expect(unit).to.be.validUnit

		const { response } = await this.network.getAaResponseToUnit(unit)
		await this.network.witnessUntilStable(response.response_unit)

		expect(response.response.error).to.be.undefined
		expect(response.bounced).to.be.false
		expect(response.response_unit).to.be.validUnit

		const { vars } = await this.bob.readAAStateVars(this.governance_aa)
		console.log(vars)
		expect(vars['support_' + this.name + '_' + this.value]).to.be.equal(this.shares)
		expect(vars['support_' + this.name + '_' + this.value + '_' + this.aliceAddress]).to.be.equal(this.shares)
		expect(vars['leader_' + this.name]).to.be.equal(this.value)
		expect(vars[this.name]).to.be.equal(this.value)
		expect(vars['balance_' + this.aliceAddress]).to.be.equal(this.shares)

		const { unitObj } = await this.bob.getUnitInfo({ unit: response.response_unit })

		const { vars: arb_vars } = await this.bob.readAAStateVars(this.arb_aa)
		console.log(arb_vars)
		expect(arb_vars[this.name]).to.be.equal(this.value)

		this.max_reserve_share = this.value

		this.arb_reserve_balance += 5000
		const balances = await this.bob.getOutputsBalanceOf(this.arb_aa)
		delete balances[this.shares_asset]
		expect(balances).to.deep.equalInAnyOrder({
			base: { stable: this.arb_reserve_balance, pending: 0, total: this.arb_reserve_balance },
		})
	})


	it('Bob commits investments_paused too', async () => {
		const name = 'investments_paused'
		const value = 1

		const { unit, error } = await this.bob.triggerAaWithData({
			toAddress: this.governance_aa,
			amount: 1e4,
			spend_unconfirmed: 'all',
			data: {
				name: name,
				commit: 1,
			}
		})

		expect(error).to.be.null
		expect(unit).to.be.validUnit

		const { response } = await this.network.getAaResponseToUnit(unit)
		await this.network.witnessUntilStable(response.response_unit)

		expect(response.response.error).to.be.undefined
		expect(response.bounced).to.be.false
		expect(response.response_unit).to.be.validUnit

		const { vars } = await this.bob.readAAStateVars(this.governance_aa)
		console.log(vars)
		expect(vars['support_' + name + '_' + value]).to.be.equal(this.shares)
		expect(vars['support_' + name + '_' + value + '_' + this.aliceAddress]).to.be.equal(this.shares)
		expect(vars['leader_' + name]).to.be.equal(value)
		expect(vars[name]).to.be.equal(value)
		expect(vars['balance_' + this.aliceAddress]).to.be.equal(this.shares)

		const { unitObj } = await this.bob.getUnitInfo({ unit: response.response_unit })

		const { vars: arb_vars } = await this.bob.readAAStateVars(this.arb_aa)
		console.log(arb_vars)
		expect(arb_vars[name]).to.be.equal(value)

		this.arb_reserve_balance += 5000
		const balances = await this.bob.getOutputsBalanceOf(this.arb_aa)
		delete balances[this.shares_asset]
		expect(balances).to.deep.equalInAnyOrder({
			base: { stable: this.arb_reserve_balance, pending: 0, total: this.arb_reserve_balance },
		})
	})


	it('Alice tries to withdraw but fails', async () => {
		const { unit, error } = await this.alice.triggerAaWithData({
			toAddress: this.governance_aa,
			amount: 1e4,
			spend_unconfirmed: 'all',
			data: {
				withdraw: 1,
			}
		})

		expect(error).to.be.null
		expect(unit).to.be.validUnit

		const { response } = await this.network.getAaResponseToUnit(unit)
	//	await this.network.witnessUntilStable(response.response_unit)

		expect(response.response.error).to.be.equal("support for max_reserve_share not removed yet")
		expect(response.bounced).to.be.true
		expect(response.response_unit).to.be.null

	})

	it('Alice tries to untie her vote too early but fails', async () => {
		const { unit, error } = await this.alice.triggerAaWithData({
			toAddress: this.governance_aa,
			amount: 1e4,
			spend_unconfirmed: 'all',
			data: {
				name: this.name,
			}
		})

		expect(error).to.be.null
		expect(unit).to.be.validUnit

		const { response } = await this.network.getAaResponseToUnit(unit)
	//	await this.network.witnessUntilStable(response.response_unit)

		expect(response.response.error).to.be.equal("you cannot change your vote yet")
		expect(response.bounced).to.be.true
		expect(response.response_unit).to.be.null

	})


	it('Alice waits for 30 days and unties her vote successfully', async () => {
		const { time_error } = await this.network.timetravel({shift: '30d'})
		expect(time_error).to.be.undefined

		const { unit, error } = await this.alice.triggerAaWithData({
			toAddress: this.governance_aa,
			amount: 1e4,
			spend_unconfirmed: 'all',
			data: {
				name: this.name,
			}
		})

		expect(error).to.be.null
		expect(unit).to.be.validUnit

		const { response } = await this.network.getAaResponseToUnit(unit)
	//	await this.network.witnessUntilStable(response.response_unit)

		expect(response.response.error).to.be.undefined
		expect(response.bounced).to.be.false
		expect(response.response_unit).to.be.null

		const { vars } = await this.alice.readAAStateVars(this.governance_aa)
		console.log(vars)
		expect(vars['support_' + this.name + '_' + this.value]).to.be.equal(0)
		expect(vars['support_' + this.name + '_' + this.value + '_' + this.aliceAddress]).to.be.undefined
		expect(vars['leader_' + this.name]).to.be.equal(this.value)
		expect(vars['balance_' + this.aliceAddress]).to.be.equal(this.shares)
		expect(vars[this.name]).to.be.equal(this.value)

	})

	it('Alice tries to withdraw but fails again, this time thanks to investments_paused', async () => {
		const { unit, error } = await this.alice.triggerAaWithData({
			toAddress: this.governance_aa,
			amount: 1e4,
			spend_unconfirmed: 'all',
			data: {
				withdraw: 1,
			}
		})

		expect(error).to.be.null
		expect(unit).to.be.validUnit

		const { response } = await this.network.getAaResponseToUnit(unit)
	//	await this.network.witnessUntilStable(response.response_unit)

		expect(response.response.error).to.be.equal("support for investments_paused not removed yet")
		expect(response.bounced).to.be.true
		expect(response.response_unit).to.be.null

	})


	it('Alice tries to buy more shares for T1 but fails because the AA accepts no more investments', async () => {
		const amount = .1e6

		const { unit, error } = await this.alice.sendMulti({
			asset: this.asset1,
			base_outputs: [{ address: this.arb_aa, amount: 1e4 }],
			asset_outputs: [{ address: this.arb_aa, amount: amount }],
			spend_unconfirmed: 'all',
		})

		expect(error).to.be.null
		expect(unit).to.be.validUnit

		const { response } = await this.network.getAaResponseToUnit(unit)

		expect(response.response.error).to.be.eq("investments paused by governance decision")
		expect(response.bounced).to.be.true
		expect(response.response_unit).to.be.validUnit

		await this.network.witnessUntilStable(response.response_unit)
		const { unitObj } = await this.alice.getUnitInfo({ unit: response.response_unit })

		this.arb_reserve_balance += 1e4 - unitObj.headers_commission - unitObj.payload_commission

		const balances = await this.alice.getOutputsBalanceOf(this.arb_aa)
		delete balances[this.shares_asset]
		expect(balances).to.deep.equalInAnyOrder({
			base: { stable: this.arb_reserve_balance, pending: 0, total: this.arb_reserve_balance },
		})
	})


	it('Alice votes for resumption of investments', async () => {
		const name = 'investments_paused'
		const value = 0

		const { unit, error } = await this.alice.triggerAaWithData({
			toAddress: this.governance_aa,
			amount: 1e4,
			spend_unconfirmed: 'all',
			data: {
				name: name,
				value: value
			}
		})

		expect(error).to.be.null
		expect(unit).to.be.validUnit

		const { response } = await this.network.getAaResponseToUnit(unit)
	//	await this.network.witnessUntilStable(response.response_unit)

		expect(response.response.error).to.be.undefined
		expect(response.bounced).to.be.false
		expect(response.response_unit).to.be.null

		const { vars } = await this.alice.readAAStateVars(this.governance_aa)
		console.log(vars)
		expect(vars['support_' + name + '_' + value]).to.be.equal(this.shares)
		expect(vars['support_' + name + '_' + value + '_' + this.aliceAddress]).to.be.equal(this.shares)
		expect(vars['leader_' + name]).to.be.equal(value)
		expect(vars['balance_' + this.aliceAddress]).to.be.equal(this.shares)

		const { unitObj } = await this.alice.getUnitInfo({ unit })
	//	console.log(JSON.stringify(unitObj, null, '\t'))
		expect(vars['challenging_period_start_ts_' + name]).to.be.equal(unitObj.timestamp)
	})


	it('Bob commits investments_paused=0', async () => {
		const { time_error } = await this.network.timetravel({shift: '7d'})
		expect(time_error).to.be.undefined

		const name = 'investments_paused'
		const value = 0

		const { unit, error } = await this.bob.triggerAaWithData({
			toAddress: this.governance_aa,
			amount: 1e4,
			spend_unconfirmed: 'all',
			data: {
				name: name,
				commit: 1,
			}
		})

		expect(error).to.be.null
		expect(unit).to.be.validUnit

		const { response } = await this.network.getAaResponseToUnit(unit)
		await this.network.witnessUntilStable(response.response_unit)

		expect(response.response.error).to.be.undefined
		expect(response.bounced).to.be.false
		expect(response.response_unit).to.be.validUnit

		const { vars } = await this.bob.readAAStateVars(this.governance_aa)
		console.log(vars)
		expect(vars['support_' + name + '_' + value]).to.be.equal(this.shares)
		expect(vars['support_' + name + '_' + value + '_' + this.aliceAddress]).to.be.equal(this.shares)
		expect(vars['leader_' + name]).to.be.equal(value)
		expect(vars[name]).to.be.equal(value)
		expect(vars['balance_' + this.aliceAddress]).to.be.equal(this.shares)

		const { unitObj } = await this.bob.getUnitInfo({ unit: response.response_unit })

		const { vars: arb_vars } = await this.bob.readAAStateVars(this.arb_aa)
		console.log(arb_vars)
		expect(arb_vars[name]).to.be.equal(value)

		this.arb_reserve_balance += 5000
		const balances = await this.bob.getOutputsBalanceOf(this.arb_aa)
		delete balances[this.shares_asset]
		expect(balances).to.deep.equalInAnyOrder({
			base: { stable: this.arb_reserve_balance, pending: 0, total: this.arb_reserve_balance },
		})
	})


	it('Alice unties her vote for investments_paused successfully', async () => {
		const { time_error } = await this.network.timetravel({shift: '30d'})
		expect(time_error).to.be.undefined

		const name = 'investments_paused'
		const value = 0

		const { unit, error } = await this.alice.triggerAaWithData({
			toAddress: this.governance_aa,
			amount: 1e4,
			spend_unconfirmed: 'all',
			data: {
				name: name,
			}
		})

		expect(error).to.be.null
		expect(unit).to.be.validUnit

		const { response } = await this.network.getAaResponseToUnit(unit)
	//	await this.network.witnessUntilStable(response.response_unit)

		expect(response.response.error).to.be.undefined
		expect(response.bounced).to.be.false
		expect(response.response_unit).to.be.null

		const { vars } = await this.alice.readAAStateVars(this.governance_aa)
		console.log(vars)
		expect(vars['support_' + name + '_' + value]).to.be.equal(0)
		expect(vars['support_' + name + '_' + value + '_' + this.aliceAddress]).to.be.undefined
		expect(vars['leader_' + name]).to.be.equal(value)
		expect(vars['balance_' + this.aliceAddress]).to.be.equal(this.shares)
		expect(vars['investments_paused']).to.be.equal(value)

	})


	it('Alice withdraws successfully', async () => {
		const { unit, error } = await this.alice.triggerAaWithData({
			toAddress: this.governance_aa,
			amount: 1e4,
			spend_unconfirmed: 'all',
			data: {
				withdraw: 1,
			}
		})

		expect(error).to.be.null
		expect(unit).to.be.validUnit

		const { response } = await this.network.getAaResponseToUnit(unit)
	//	await this.network.witnessUntilStable(response.response_unit)

		expect(response.response.error).to.be.undefined
		expect(response.bounced).to.be.false
		expect(response.response_unit).to.be.validUnit

		const { vars } = await this.alice.readAAStateVars(this.governance_aa)
		console.log(vars)
		expect(vars['support_' + this.name + '_' + this.value]).to.be.equal(0)
		expect(vars['support_' + this.name + '_' + this.value + '_' + this.aliceAddress]).to.be.undefined
		expect(vars['leader_' + this.name]).to.be.equal(this.value)
		expect(vars['balance_' + this.aliceAddress]).to.be.equal(0)
		expect(vars[this.name]).to.be.equal(this.value)

		const { unitObj } = await this.alice.getUnitInfo({ unit: response.response_unit })
		expect(Utils.getExternalPayments(unitObj)).to.deep.equalInAnyOrder([{
			address: this.aliceAddress,
			asset: this.shares_asset,
			amount: this.shares,
		}])

	})


	it('Alice buys more shares for T1', async () => {
		const amount = .7e6
		const share_price = (this.arb_reserve_balance + this.getP1() * this.arb_asset1_balance) / this.shares_supply
		const shares = Math.floor(amount * this.getP1() / share_price)
		console.log({ share_price, shares })
		this.shares_supply += shares

		const { unit, error } = await this.alice.sendMulti({
			asset: this.asset1,
			base_outputs: [{ address: this.arb_aa, amount: 1e4 }],
			asset_outputs: [{ address: this.arb_aa, amount: amount }],
			spend_unconfirmed: 'all',
		})

		expect(error).to.be.null
		expect(unit).to.be.validUnit

		const { response } = await this.network.getAaResponseToUnit(unit)
		await this.network.witnessUntilStable(response.response_unit)

		expect(response.response.error).to.be.undefined
		expect(response.bounced).to.be.false
		expect(response.response_unit).to.be.validUnit

		const { vars } = await this.alice.readAAStateVars(this.arb_aa)
		console.log(vars)
		expect(vars['shares_supply']).to.be.equal(this.shares_supply)

		const { unitObj } = await this.alice.getUnitInfo({ unit: response.response_unit })
	//	console.log(JSON.stringify(unitObj, null, '\t'))
		expect(Utils.getExternalPayments(unitObj)).to.deep.equalInAnyOrder([{
			address: this.aliceAddress,
			asset: this.shares_asset,
			amount: shares,
		}])

		this.arb_reserve_balance += 1e4 - unitObj.headers_commission - unitObj.payload_commission
		this.arb_asset1_balance += amount
		console.log('reserve share', this.arb_reserve_balance / (this.arb_reserve_balance + this.getP1() * this.arb_asset1_balance))

		const balances = await this.alice.getOutputsBalanceOf(this.arb_aa)
		delete balances[this.shares_asset]
		expect(balances).to.deep.equalInAnyOrder({
			base: { stable: this.arb_reserve_balance, pending: 0, total: this.arb_reserve_balance },
			[this.asset1]: { stable: this.arb_asset1_balance, pending: 0, total: this.arb_asset1_balance },
		})
	})


	it('Alice buys more shares for the reserve currency, which was not allowed by the old rules but is allowed now', async () => {
		const amount = .1e9
		const share_price = (this.arb_reserve_balance + this.getP1() * this.arb_asset1_balance) / this.shares_supply
		const shares = Math.floor(amount / share_price)
		console.log({ share_price, shares })
		this.shares_supply += shares

		const { unit, error } = await this.alice.sendBytes({
			toAddress: this.arb_aa,
			amount: amount,
			spend_unconfirmed: 'all',
		})

		expect(error).to.be.null
		expect(unit).to.be.validUnit

		const { response } = await this.network.getAaResponseToUnit(unit)
		await this.network.witnessUntilStable(response.response_unit)

		expect(response.response.error).to.be.undefined
		expect(response.bounced).to.be.false
		expect(response.response_unit).to.be.validUnit

		const { vars } = await this.alice.readAAStateVars(this.arb_aa)
		console.log(vars)
		expect(vars['shares_supply']).to.be.equal(this.shares_supply)

		const { unitObj } = await this.alice.getUnitInfo({ unit: response.response_unit })
	//	console.log(JSON.stringify(unitObj, null, '\t'))
		expect(Utils.getExternalPayments(unitObj)).to.deep.equalInAnyOrder([{
			address: this.aliceAddress,
			asset: this.shares_asset,
			amount: shares,
		}])

		this.arb_reserve_balance += amount - unitObj.headers_commission - unitObj.payload_commission
		console.log('reserve share', this.arb_reserve_balance / (this.arb_reserve_balance + this.getP1() * this.arb_asset1_balance))

		const balances = await this.alice.getOutputsBalanceOf(this.arb_aa)
		delete balances[this.shares_asset]
		expect(balances).to.deep.equalInAnyOrder({
			base: { stable: this.arb_reserve_balance, pending: 0, total: this.arb_reserve_balance },
			[this.asset1]: { stable: this.arb_asset1_balance, pending: 0, total: this.arb_asset1_balance },
		})
	})

	after(async () => {
		// uncomment this line to pause test execution to get time for Obyte DAG explorer inspection
	//	await Utils.sleep(3600 * 1000)
		await this.network.stop()
	})
})
