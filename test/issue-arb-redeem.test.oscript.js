// uses `aa-testkit` testing framework for AA tests. Docs can be found here `https://github.com/valyakin/aa-testkit`
// `mocha` standard functions and `expect` from `chai` are available globally
// `Testkit`, `Network`, `Nodes` and `Utils` from `aa-testkit` are available globally too
const path = require('path')
const { expect } = require('chai');

function round(n, precision) {
	return Math.round(n * 10 ** precision) / 10 ** precision;
}


describe('Full circle: issue and redeem shares, arb', function () {
	this.timeout(120000)


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
		this.governance_aa = vars['governance_aa_' + this.curve_aa];

		const { vars: curve_vars } = await this.bob.readAAStateVars(this.curve_aa)
		console.log('curve vars', curve_vars, this.curve_aa)
		expect(curve_vars['asset1']).to.be.equal(this.asset1)
		expect(curve_vars['asset2']).to.be.equal(this.asset2)
		expect(curve_vars['governance_aa']).to.be.equal(this.governance_aa)
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
		expect(this.shares_asset).to.be.validUnit

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


	it('Alice buys more of tokens2 and moves the price p2 below the peg', async () => {
		const tokens2 = 1e2
		const { amount, fee, fee_percent } = this.buy(0, tokens2)

		const { unit, error } = await this.alice.triggerAaWithData({
			toAddress: this.curve_aa,
			amount: amount + fee + 1000,
			data: {
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
		expect(response.response.responseVars['fee%']).to.be.equal(fee_percent+'%')

		const { vars } = await this.alice.readAAStateVars(this.curve_aa)
		console.log(vars)
		expect(vars['supply1']).to.be.equal(this.supply1)
		expect(vars['supply2']).to.be.equal(this.supply2)
		expect(vars['reserve']).to.be.equal(this.reserve)
		expect(vars['slow_capacity']).to.be.equal(this.slow_capacity)
		expect(vars['fast_capacity']).to.be.equal(this.fast_capacity)
		expect(vars['lost_peg_ts']).to.be.undefined

		const { unitObj } = await this.alice.getUnitInfo({ unit: response.response_unit })
	//	console.log(JSON.stringify(unitObj, null, '\t'))
		expect(Utils.getExternalPayments(unitObj)).to.deep.equalInAnyOrder([{
			address: this.aliceAddress,
			asset: this.asset2,
			amount: tokens2,
		}])

	})

	it('Alice triggers arbitrage below the peg which results in buying T1 tokens', async () => {
		const { tokens1, reserve_delta, reserve_needed, reward, p2 } = this.get_exchange_data()
		const triggerer_reward = Math.floor(this.triggerer_reward_share * reward)

		const { unit, error } = await this.alice.triggerAaWithData({
			toAddress: this.arb_aa,
			amount: 1e4,
			data: {
				arb: 1,
			},
			spend_unconfirmed: 'all',
		})

		expect(error).to.be.null
		expect(unit).to.be.validUnit

		const { response } = await this.network.getAaResponseToUnit(unit)
		await this.network.witnessUntilStable(response.response_unit)

		expect(response.response.error).to.be.undefined
		expect(response.bounced).to.be.false
		expect(response.response_unit).to.be.validUnit

		const { vars: avars } = await this.alice.readAAStateVars(this.arb_aa)
		console.log(avars)
		expect(Object.keys(avars).length).to.be.eq(3)
		expect(avars['status']).to.be.undefined
		expect(avars['expected_reserve_amount']).to.be.undefined
		expect(avars['expected_asset1_amount']).to.be.undefined
		
		// 1st response from the arb AA
		const { unitObj } = await this.alice.getUnitInfo({ unit: response.response_unit })
	//	console.log(JSON.stringify(unitObj, null, '\t'))
		expect(Utils.getExternalPayments(unitObj)).to.deep.equalInAnyOrder([
			{
				address: this.curve_aa,
				amount: reserve_needed,
			},
			{
				address: this.aliceAddress,
				amount: triggerer_reward,
			},
		])
		const data = unitObj.messages.find(m => m.app === 'data').payload
		expect(data.tokens1).to.be.eq(tokens1)

		// response from the curve
		const { response: response2 } = await this.network.getAaResponseToUnit(response.response_unit)
		expect(response2.response.error).to.be.undefined
		expect(response2.bounced).to.be.false
		expect(response2.response_unit).to.be.validUnit

		const { unitObj: unitObj2 } = await this.alice.getUnitInfo({ unit: response2.response_unit })
		//	console.log(JSON.stringify(unitObj, null, '\t'))
		expect(Utils.getExternalPayments(unitObj2)).to.deep.equalInAnyOrder([{
			asset: this.asset1,
			address: this.arb_aa,
			amount: tokens1,
		}])
	
		// 2nd response from the arb AA
		const { response: response3 } = await this.network.getAaResponseToUnit(response2.response_unit)
		expect(response3.response.error).to.be.undefined
		expect(response3.bounced).to.be.false
		expect(response3.response_unit).to.be.null

		this.supply1 += tokens1
		this.reserve += reserve_delta
		this.fast_capacity -= reward
		this.p2 = p2

		const { vars } = await this.alice.readAAStateVars(this.curve_aa)
		console.log(vars)
		expect(vars['supply1']).to.be.equal(this.supply1)
		expect(vars['supply2']).to.be.equal(this.supply2)
		expect(vars['reserve']).to.be.equal(this.reserve)
		expect(vars['slow_capacity']).to.be.equal(this.slow_capacity)
		expect(vars['fast_capacity']).to.be.equal(this.fast_capacity)
		expect(vars['lost_peg_ts']).to.be.undefined

		this.arb_reserve_balance += 1e4 - reserve_needed - triggerer_reward - unitObj.headers_commission - unitObj.payload_commission
		this.arb_asset1_balance += tokens1

		const balances = await this.alice.getOutputsBalanceOf(this.arb_aa)
		expect(balances).to.deep.equalInAnyOrder({
			base: { stable: this.arb_reserve_balance, pending: 0, total: this.arb_reserve_balance },
			[this.asset1]: { stable: this.arb_asset1_balance, pending: 0, total: this.arb_asset1_balance },
		})
	})


	it('Alice tries to trigger arbitrage again but fails because there is no arbitrage opportunity any more', async () => {
		const { unit, error } = await this.alice.triggerAaWithData({
			toAddress: this.arb_aa,
			amount: 1e4,
			data: {
				arb: 1,
			},
			spend_unconfirmed: 'all',
		})

		expect(error).to.be.null
		expect(unit).to.be.validUnit

		const { response } = await this.network.getAaResponseToUnit(unit)
		await this.network.witnessUntilStable(response.response_unit)

		expect(response.response.error).to.be.equal("already on-peg")
		expect(response.bounced).to.be.true
		expect(response.response_unit).to.be.null

		this.arb_reserve_balance += 1e4
	})


	it('Alice redeems half of her shares', async () => {
		const amount = Math.floor(this.shares_supply/2)
		const reserve_amount_out = Math.floor(this.arb_reserve_balance/2) // 1e4 not added
		const asset1_amount_out = Math.floor(this.arb_asset1_balance/2)
		this.shares_supply -= amount

		const { unit, error } = await this.alice.sendMulti({
			asset: this.shares_asset,
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
		expect(vars['shares_supply']).to.be.eq(this.shares_supply)

		const { unitObj } = await this.alice.getUnitInfo({ unit: response.response_unit })
	//	console.log(JSON.stringify(unitObj, null, '\t'))
		expect(Utils.getExternalPayments(unitObj)).to.deep.equalInAnyOrder([
			{
				address: this.aliceAddress,
				amount: reserve_amount_out,
			},
			{
				asset: this.asset1,
				address: this.aliceAddress,
				amount: asset1_amount_out,
			},
		])

		this.arb_reserve_balance += 1e4 - reserve_amount_out - unitObj.headers_commission - unitObj.payload_commission
		this.arb_asset1_balance -= asset1_amount_out
		const balances = await this.alice.getOutputsBalanceOf(this.arb_aa)
		delete balances[this.shares_asset]
		expect(balances).to.deep.equalInAnyOrder({
			base: { stable: this.arb_reserve_balance, pending: 0, total: this.arb_reserve_balance },
			[this.asset1]: { stable: this.arb_asset1_balance, pending: 0, total: this.arb_asset1_balance },
		})
	})


	it('Alice buys more shares for T1', async () => {
		const amount = .1e6
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

		const balances = await this.alice.getOutputsBalanceOf(this.arb_aa)
		delete balances[this.shares_asset]
		expect(balances).to.deep.equalInAnyOrder({
			base: { stable: this.arb_reserve_balance, pending: 0, total: this.arb_reserve_balance },
			[this.asset1]: { stable: this.arb_asset1_balance, pending: 0, total: this.arb_asset1_balance },
		})
	})


	it('Alice buys more of tokens1 and moves the price p2 above the peg', async () => {
		const tokens1 = .01e6
		const { amount, fee, fee_percent } = this.buy(tokens1, 0)

		const { unit, error } = await this.alice.triggerAaWithData({
			toAddress: this.curve_aa,
			amount: amount + fee + 1000,
			data: {
				tokens1: tokens1,
			},
		})

		expect(error).to.be.null
		expect(unit).to.be.validUnit

		const { response } = await this.network.getAaResponseToUnit(unit)
	//	await this.network.witnessUntilStable(response.response_unit)

		expect(response.response.error).to.be.undefined
		expect(response.bounced).to.be.false
		expect(response.response_unit).to.be.validUnit
		expect(response.response.responseVars['fee%']).to.be.equal(fee_percent+'%')

		const { vars } = await this.alice.readAAStateVars(this.curve_aa)
		console.log(vars)
		expect(vars['supply1']).to.be.equal(this.supply1)
		expect(vars['supply2']).to.be.equal(this.supply2)
		expect(vars['reserve']).to.be.equal(this.reserve)
		expect(vars['slow_capacity']).to.be.equal(this.slow_capacity)
		expect(vars['fast_capacity']).to.be.equal(this.fast_capacity)
	//	expect(vars['lost_peg_ts']).to.be.undefined

		const { unitObj } = await this.alice.getUnitInfo({ unit: response.response_unit })
	//	console.log(JSON.stringify(unitObj, null, '\t'))
		expect(Utils.getExternalPayments(unitObj)).to.deep.equalInAnyOrder([{
			address: this.aliceAddress,
			asset: this.asset1,
			amount: tokens1,
		}])

	})


	it('Alice triggers arbitrage above the peg which results in selling T1 tokens', async () => {
		const { tokens1, reserve_delta, reserve_needed, reward, p2 } = this.get_exchange_data()
		expect(tokens1).to.be.lt(0)
		expect(reserve_delta).to.be.lt(0)
		expect(reserve_needed).to.be.lt(0)
		expect(reward).to.be.gt(0)
		const triggerer_reward = Math.floor(this.triggerer_reward_share * reward)

		const { unit, error } = await this.alice.triggerAaWithData({
			toAddress: this.arb_aa,
			amount: 1e4,
			data: {
				arb: 1,
			},
			spend_unconfirmed: 'all',
		})

		expect(error).to.be.null
		expect(unit).to.be.validUnit

		const { response } = await this.network.getAaResponseToUnit(unit)
		await this.network.witnessUntilStable(response.response_unit)

		expect(response.response.error).to.be.undefined
		expect(response.bounced).to.be.false
		expect(response.response_unit).to.be.validUnit

		const { vars: avars } = await this.alice.readAAStateVars(this.arb_aa)
		console.log(avars)
		expect(Object.keys(avars).length).to.be.eq(3)
		expect(avars['status']).to.be.undefined
		expect(avars['expected_reserve_amount']).to.be.undefined
		expect(avars['expected_asset1_amount']).to.be.undefined
		
		// 1st response from the arb AA
		const { unitObj } = await this.alice.getUnitInfo({ unit: response.response_unit })
	//	console.log(JSON.stringify(unitObj, null, '\t'))
		expect(Utils.getExternalPayments(unitObj)).to.deep.equalInAnyOrder([
			{
				asset: this.asset1,
				address: this.curve_aa,
				amount: -tokens1,
			},
			{
				address: this.aliceAddress,
				amount: triggerer_reward,
			},
		])
		const dataMessage = unitObj.messages.find(m => m.app === 'data')
		expect(dataMessage).to.be.undefined

		// response from the curve
		const { response: response2 } = await this.network.getAaResponseToUnit(response.response_unit)
		expect(response2.response.error).to.be.undefined
		expect(response2.bounced).to.be.false
		expect(response2.response_unit).to.be.validUnit

		const { unitObj: unitObj2 } = await this.alice.getUnitInfo({ unit: response2.response_unit })
		//	console.log(JSON.stringify(unitObj, null, '\t'))
		expect(Utils.getExternalPayments(unitObj2)).to.deep.equalInAnyOrder([{
			address: this.arb_aa,
			amount: -reserve_needed,
		}])
	
		// 2nd response from the arb AA
		const { response: response3 } = await this.network.getAaResponseToUnit(response2.response_unit)
		expect(response3.response.error).to.be.undefined
		expect(response3.bounced).to.be.false
		expect(response3.response_unit).to.be.null

		this.supply1 += tokens1
		this.reserve += reserve_delta
		this.fast_capacity -= reward
		this.p2 = p2

		const { vars } = await this.alice.readAAStateVars(this.curve_aa)
		console.log(vars)
		expect(vars['supply1']).to.be.equal(this.supply1)
		expect(vars['supply2']).to.be.equal(this.supply2)
		expect(vars['reserve']).to.be.equal(this.reserve)
		expect(vars['slow_capacity']).to.be.equal(this.slow_capacity)
		expect(vars['fast_capacity']).to.be.equal(this.fast_capacity)
		expect(vars['lost_peg_ts']).to.be.undefined

		this.arb_reserve_balance += 1e4 - reserve_needed - triggerer_reward - unitObj.headers_commission - unitObj.payload_commission
		this.arb_asset1_balance += tokens1

		const balances = await this.alice.getOutputsBalanceOf(this.arb_aa)
		delete balances[this.shares_asset]
		console.log('arb balances', balances)
		console.log('t1 assets', balances[this.asset1].stable * this.getP1())
		expect(balances).to.deep.equalInAnyOrder({
			base: { stable: this.arb_reserve_balance, pending: 0, total: this.arb_reserve_balance },
			[this.asset1]: { stable: this.arb_asset1_balance, pending: 0, total: this.arb_asset1_balance },
		})
	})


	it("Alice tries to buy more shares with the reserve currency but fails because the pool's share of the reserve currency is already too large", async () => {
		const amount = 1e9

		const { unit, error } = await this.alice.sendBytes({
			toAddress: this.arb_aa,
			amount: amount,
			spend_unconfirmed: 'all',
		})

		expect(error).to.be.null
		expect(unit).to.be.validUnit

		const { response } = await this.network.getAaResponseToUnit(unit)
		await this.network.witnessUntilStable(response.response_unit)

		expect(response.response.error).to.be.eq("the reserve share is too large and only proportional or T1 contributions (or anything in between) are allowed")
		expect(response.bounced).to.be.true
		expect(response.response_unit).to.be.validUnit

		const { unitObj } = await this.alice.getUnitInfo({ unit: response.response_unit })

		this.arb_reserve_balance += 1e4 - unitObj.headers_commission - unitObj.payload_commission

		const balances = await this.alice.getOutputsBalanceOf(this.arb_aa)
		delete balances[this.shares_asset]
		expect(balances).to.deep.equalInAnyOrder({
			base: { stable: this.arb_reserve_balance, pending: 0, total: this.arb_reserve_balance },
			[this.asset1]: { stable: this.arb_asset1_balance, pending: 0, total: this.arb_asset1_balance },
		})
	})

	after(async () => {
		await this.network.stop()
	})
})
