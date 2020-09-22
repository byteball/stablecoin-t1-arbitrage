module.exports = {
	'root': true,
	'extends': [
		'standard',
		'plugin:mocha/recommended'
	],
	'plugins': [
		'mocha',
		'chai-friendly'
	],
	env: {
    mocha: true,
		node: true
	},
	'globals': {
		requireRoot: true,
		expect: true,
		Network: true,
		Nodes: true,
		Utils: true
	},
	'rules': {
		'indent': ['error', 'tab'],
		'no-tabs': 'off',
		'no-unused-expressions': 0,
		'chai-friendly/no-unused-expressions': 2,
		'no-console': 'error',
		'no-debugger': 'error',
		'mocha/no-mocha-arrows': 'off'
	}
}
