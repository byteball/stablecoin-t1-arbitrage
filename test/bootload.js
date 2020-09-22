/* eslint-disable chai-friendly/no-unused-expressions */
const path = require('path')
const chai = require('chai')
const expect = chai.expect
const deepEqualInAnyOrder = require('deep-equal-in-any-order')
const { Testkit } = require('aa-testkit')
const { Network, Nodes, Utils } = Testkit({
	TESTDATA_DIR: path.join(process.cwd(), 'testdata')
})

global.expect = expect
global.Testkit = Testkit

global.Network = Network
global.Nodes = Nodes
global.Utils = Utils

chai.use(deepEqualInAnyOrder)

chai.use((_chai, utils) => {
	chai.Assertion.addProperty('validAddress', function () {
		const address = utils.flag(this, 'object')
		const negate = utils.flag(this, 'negate')
		const check = Utils.isValidAddress(address)
		new chai.Assertion(check).to.be.equal(!negate, !check && `'${JSON.stringify(address)}' is not valid address`)
	})

	chai.Assertion.addProperty('validUnit', function () {
		const unit = utils.flag(this, 'object')
		const negate = utils.flag(this, 'negate')
		const check = Utils.isValidBase64(unit, 44) && unit.endsWith('=')
		new chai.Assertion(check).to.be.equal(!negate, !check && `'${JSON.stringify(unit)}' is not valid unit`)
	})
})
