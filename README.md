# Autonomous Agent for arbitrage between T1 and reserve tokens on bonded stablecoins

Whenever the price of T2 tokens deviates from the peg, this AA will buy or sell T1 tokens in order to correct the price back to the peg and earn a reward (if any capacity is available in the fast capacity pool). See the [introductory article about bonded stablecoins](https://medium.com/obyte/using-multi-dimensional-bonding-curves-to-create-stablecoins-81e857b4355c) to learn about the roles of T1 and t2 tokens.

Investors provide liquidity to the AA as the reserve and T1 tokens, get shares in exchange, and share the profits from both arbitrage and the performance of the reserve+T1 portfolio that the AA holds. Investors participate in governance and can tune various parameters of the AA.

All arbitrage actions of the AA are triggered by a companion bot that is also included here.

## Bot operator:

### Installing
```bash
yarn
```

### Testing the AA

Tests are written using the [AA Testkit](https://github.com/valyakin/aa-testkit).

```bash
yarn test
```

### Creating the arbitrage AA

Use your Obyte wallet to send a transaction to the factory AA **I3EA42PJ352JBF5EGOXV2UYT46WCAUEJ**. It has only one required parameter `curve_aa`, which is the AA of the curve the bot will be trading on (see the Governance section below for a full list of parameters). The factory will create a new arbitrage AA, this is the AA that will store the funds of investors. The bot will issue `arb` commands to this AA when it sees an arbitrage opportunity.

Specify this arbitrage AA as `arb_aa` in your conf.json.

### Running the arbitrage bot

```bash
node run.js 2>errlog
```
When the bot starts, it prints its address (`====== my single address: ....`), refill it with some Bytes, so it can send transactions to the AA.

The bot's funds are separate from the AA's funds. The bot needs to hold only small amounts required to trigger the AA.

The bot earns a portion of the reward paid by the curve for correcting the price towards the peg.

## Investors:

### Investing/divesting

To provide liquidity and participate in profits of the AA, investors send their T1 or reserve funds to the AA and get shares in exchange. The price of T1 in terms of the reserve asset is determined using the bonding curve, and the relative weights of the reserve and T1 assets in the AA's holdings determine the share price.

To redeem, users send their shares back to the AA and specify a `what` parameter as `t1`, `reserve`, or `both` to indicate what asset they want to receive in exchange. When requesting `both`, the user gets back the reserve and T1 assets in the same proportions as the AA currently holds.

### Governance

Investors can tune the following parameters by voting to change their values:

* `min_reserve_share`: minimum share of the reserve asset in the AA's holdings. If it gets below this threshold, only contributions/redemptions that increase the share of the reserve asset become allowed. Above the threshold, any contributions/redemptions are allowed (e.g. single-asset contributions in T1 asset). Default: 0.
* `max_reserve_share`: maximum share of the reserve asset in the AA's holdings. If it gets above this threshold, only contributions/redemptions that decrease the share of the reserve asset become allowed. Below the threshold, any contributions/redemptions are allowed (e.g. single-asset contributions in the reserve asset). Default: 1.
* `min_reserve_delta`: minimum amount of the reserve currency that should be transacted in each arbitrage trade. Its purpose is to avoid taking small trades whose profits might be too small to justify the transaction fees. Default: 1e5.
* `triggerer_reward_share`: the share of the reward paid by the curve AA for moving the price to the peg that is paid to the triggerer of the arbitrage trade. The companion bot tries to be that triggerer but the AA can be triggered by anybody. Default: 0.
* `investments_paused`: this parameter can be set to 1 to stop accepting new contributions to the pool in order not to dilute the current investors. This can make sense if the current investors think that there is limited profit to be made on the market and don't want to divide the pie among a bigger number of investors. Default: 0.

The initial values of these parameters can be set when triggering the factory to create the arbitrage AA.

Later changes can be decided on by the investors through a governance AA that is created at the same time the main arbitrage AA is created. The mechanism for decision making is **challenger voting** - the same mechanism that is used in [bonded stablecoins](https://medium.com/obyte/using-multi-dimensional-bonding-curves-to-create-stablecoins-81e857b4355c) governance.

To propose or support a change of a parameter, investors send their shares to the governance AA and specify the `name` of the parameter they want to vote on (one of the 4 parameters listed above) and the proposed `value`. Votes are weighted by the balance of shares locked. After a value retains the leading position (i.e. having the largest support in terms of shares locked) for 7 days, it becomes the winner and can be activated in the arbitrage AA by sending a `commit` command to the governance AA. Those who voted for the winning decision cannot unlock their shares from the governance AA for 30 days after the decision was activated.

The address of the governance AA attached to the arbitrage AA can be looked up on the explorer by visiting the page of the arbitrage AA, e.g. https://explorer.obyte.org/#Y3NP6UMNFMA6DU2DGPJN4HB65KHKVAKR, and viewing its state variables.

Unfortunately there is no user interface for convenient sending of votes and viewing the current results of voting.
