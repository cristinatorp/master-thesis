let Auction = artifacts.require("./TestAuction.sol");
const truffleAssert = require("truffle-assertions");
const { time } = require("@openzeppelin/test-helpers");

contract("Auction", accounts => {
    let contract;
    const sellerAccount = accounts[9];

    const READY_FOR_HIDDEN_BIDS_STATE = 0;
    const READY_FOR_OPEN_BIDS_STATE = 1;
    const CLOSED_STATE = 2;
    const READY_FOR_DELETION_STATE = 3;

    const ONE_DAY = 86400;
    const ENERGY_AMOUNT = 200;
    const MIN_BID_VALUE = 50000;
    const DEPOSIT_VALUE = 100000;

    const MOCK_BIDS = [MIN_BID_VALUE + 2, MIN_BID_VALUE + 4, MIN_BID_VALUE + 1, MIN_BID_VALUE + 3, MIN_BID_VALUE];

    beforeEach(async () => {
        contract = await Auction.new(
            sellerAccount,
            ENERGY_AMOUNT,
            MIN_BID_VALUE,
            DEPOSIT_VALUE,
            {
                gas: 4000000
            }
        );
    });

    it("contract is initialized", async () => {
        let a = await getAuctionInfo();
        const latestTime = await time.latest();

        expect(a.currentState).to.equal(READY_FOR_HIDDEN_BIDS_STATE);
        expect(a.seller).to.equal(sellerAccount);
        expect(a.energyAmount).to.equal(ENERGY_AMOUNT);
        expect(a.minBidValue).to.equal(MIN_BID_VALUE);
        expect(a.depositValue).to.equal(DEPOSIT_VALUE);
        expect(a.hiddenBidsDeadline).to.equal(latestTime.toNumber() + ONE_DAY);
        expect(a.openBidsDeadline).to.equal(latestTime.toNumber() + (ONE_DAY * 2));
    });

    // TESTS DURING HIDDEN ROUND

    it("can bid in hidden round", async () => {
        await bidInHiddenRound(MIN_BID_VALUE, accounts[1], DEPOSIT_VALUE);
        const bid = await contract.bids.call(accounts[1]);

        expect(bid.existsHiddenBid).to.equal(true);
        expect(Number(bid.deposit)).to.equal(DEPOSIT_VALUE);
    });

    it("cannot bid in hidden round if in the wrong state", async () => {
        await contract.setCurrentState(READY_FOR_OPEN_BIDS_STATE);
        await truffleAssert.reverts(
            bidInHiddenRound(MIN_BID_VALUE, accounts[1], DEPOSIT_VALUE), 
            "Invalid state"
        );
    });

    it("cannot bid in hidden round if after deadline", async () => {
        await time.increase(ONE_DAY + 1);
        await truffleAssert.reverts(
            bidInHiddenRound(MIN_BID_VALUE, accounts[1], DEPOSIT_VALUE),
            "Cannot bid after deadline"
        );
    });

    it("cannot bid in hidden round if deposit is too low", async () => {
        await truffleAssert.reverts(
            bidInHiddenRound(MIN_BID_VALUE, accounts[1], DEPOSIT_VALUE - 1),
            "Deposit value is too low"
        );
    });

    it("auction should close if no hidden bids were recevied", async () => {
        await time.increase(ONE_DAY + 1);
        
        const tx = await contract.closeHiddenRound();
        truffleAssert.eventEmitted(tx, "ClosedAuctionWithNoBids", (ev) => {
            return ev.whichRound == "Hidden round";
        });

        const hiddenBidsLength = Number(await contract.getHiddenBidsLength());
        expect(hiddenBidsLength).to.equal(0);

        const state = Number(await contract.getCurrentState());
        expect(state).to.equal(READY_FOR_DELETION_STATE);
    });

    it("closed hidden round and started open round", async () => {
        await bidInHiddenRound(MIN_BID_VALUE, accounts[1], DEPOSIT_VALUE);
        await time.increase(ONE_DAY + 1);
        const tx = await contract.closeHiddenRound();

        truffleAssert.eventEmitted(tx, "ClosedRound", (ev) => ev.whichRound == "Hidden round");

        let a = await getAuctionInfo();
        expect(a.currentState).to.equal(READY_FOR_OPEN_BIDS_STATE);
    });

    it("cannot close hidden round if in the wrong state", async () => {
        await contract.setCurrentState(READY_FOR_OPEN_BIDS_STATE);
        await truffleAssert.reverts(
            contract.closeHiddenRound(),
            "Invalid state"
        );
    });

    it("cannot close hidden round before deadline", async () => {
        await time.increase(ONE_DAY - 1);
        await truffleAssert.reverts(
            contract.closeHiddenRound(),
            "Cannot perform this action before the deadline"
        );
    });

    // TESTS DURING OPEN ROUND

    it("can bid in open round", async () => {
        await bidInHiddenRound(MIN_BID_VALUE, accounts[1], DEPOSIT_VALUE);
        await time.increase(ONE_DAY + 1);
        await contract.closeHiddenRound();
        await contract.bidInOpenRound(MIN_BID_VALUE, "some_salt", { from: accounts[1] });

        let bid = await contract.bids.call(accounts[1]);

        expect(bid.isOpenBidValid).to.equal(true);
        expect(Number(bid.openBid)).to.equal(MIN_BID_VALUE);
    });

    it("cannot bid in open round if in the wrong state", async () => {
        await bidInHiddenRound(MIN_BID_VALUE, accounts[1], DEPOSIT_VALUE);
        await time.increase(ONE_DAY + 1);

        await truffleAssert.reverts(
            contract.bidInOpenRound(MIN_BID_VALUE, { from: accounts[1] }),
            "Invalid state"
        );
    });

    it("cannot bid in open round if after deadline", async () => {
        await bidInHiddenRound(MIN_BID_VALUE, accounts[1], DEPOSIT_VALUE);
        await time.increase(ONE_DAY + 1);
        await contract.closeHiddenRound();
        await time.increase(ONE_DAY + 1);

        await truffleAssert.reverts(
            contract.bidInOpenRound(MIN_BID_VALUE, { from: accounts[1] }),
            "Cannot bid after deadline"
        );
    });

    it("cannot bid in open round if not already bidden in hidden round", async () => {
        await bidInHiddenRound(MIN_BID_VALUE, accounts[1], DEPOSIT_VALUE);
        await time.increase(ONE_DAY + 1);
        await contract.closeHiddenRound();

        await truffleAssert.reverts(
            contract.bidInOpenRound(MIN_BID_VALUE, "some_salt", { from: accounts[2] }),
            "This account has not bidden in the hidden round"
        );
    });

    it("cannot bid in open round if bid is too low", async () => {
        await bidInHiddenRound(MIN_BID_VALUE, accounts[1], DEPOSIT_VALUE);
        await time.increase(ONE_DAY + 1);
        await contract.closeHiddenRound();

        await truffleAssert.reverts(
            contract.bidInOpenRound(MIN_BID_VALUE - 1, "some_salt", { from: accounts[1] }),
            "Bid value is too low"
        );
    });

    it("cannot bid in open round if bid does not match hidden bid", async () => {
        await bidInHiddenRound(MIN_BID_VALUE, accounts[1], DEPOSIT_VALUE);
        await time.increase(ONE_DAY + 1);
        await contract.closeHiddenRound();

        await truffleAssert.reverts(
            contract.bidInOpenRound(MIN_BID_VALUE + 1, "some_salt", { from: accounts[1] }),
            "Open bid and hidden bid do not match"
        );
    });

    it("auction should close if no valid open bids were recevied", async () => {
        await bidInHiddenRound(MIN_BID_VALUE + 1, accounts[1], DEPOSIT_VALUE);
        await time.increase(ONE_DAY + 1);
        await contract.closeHiddenRound();
        
        await truffleAssert.reverts(
            contract.bidInOpenRound(MIN_BID_VALUE, "some_salt", { from: accounts[1]}),
            "Open bid and hidden bid do not match"
        );

        await time.increase(ONE_DAY + 1);
        const tx = await contract.closeOpenRound();
        truffleAssert.eventEmitted(tx, "ClosedAuctionWithNoBids", (ev) => {
            return ev.whichRound == "Open round, no valid bids";
        });

        const state = Number(await contract.getCurrentState());
        expect(state).to.equal(READY_FOR_DELETION_STATE);

        truffleAssert.eventEmitted(tx, "ClosedAuctionWithNoBids", (ev) => ev.whichRound == "Open round, no valid bids");
    });

    it("closed open round", async () => {
        await mockBidding(MOCK_BIDS);
        await time.increase(ONE_DAY + 1);
        // await contract.setCurrentState(READY_FOR_OPEN_BIDS_STATE);
        const tx = await contract.closeOpenRound();

        let a = await getAuctionInfo();
        expect(a.currentState).to.equal(CLOSED_STATE);
        truffleAssert.eventEmitted(tx, "ClosedRound", (ev) => ev.whichRound == "Open round");
    });

    it("cannot close open round if in the wrong state", async () => {
        await time.increase((ONE_DAY * 2) + 1);
        await truffleAssert.reverts(
            contract.closeOpenRound(),
            "Invalid state"
        )
    });

    it("cannot close open round before deadline", async () => {
        await contract.setCurrentState(READY_FOR_OPEN_BIDS_STATE);
        await truffleAssert.reverts(
            contract.closeOpenRound(),
            "Cannot perform this action before the deadline"
        )
    });

    // TESTS FOR CLOSING THE AUCTION

    it("found auction winner", async () => {
        const actualHighestBid = await mockBidding(MOCK_BIDS);
        await time.increase(ONE_DAY + 1);
        await contract.closeOpenRound();
        const tx = await contract.testFindWinner();
        
        const winner = await contract.winner.call();

        truffleAssert.eventEmitted(tx, "FoundHighestBid");
        expect(winner.accountAddress).to.equal(actualHighestBid.bidder);
        expect(Number(winner.bid)).to.equal(actualHighestBid.bid);
    });

    it("cannot find auction winner if in wrong state", async () => {
        await mockBidding(MOCK_BIDS);
        await time.increase(ONE_DAY + 1);
        
        await truffleAssert.reverts(
            contract.testFindWinner(),
            "Invalid state"
        );
    });

    it("sent deposits back to bidders (all bids valid)", async () => {
        const highestBid = await mockBidding(MOCK_BIDS);
        await time.increase(ONE_DAY + 1);
        await contract.closeOpenRound();
        await contract.testFindWinner();

        const winner = await contract.winner.call();
        expect(winner.accountAddress).to.equal(highestBid.bidder);
        expect(Number(winner.bid)).to.equal(highestBid.bid);
        
        let balancesBefore = [];
        for (let i = 0; i < MOCK_BIDS.length; i++) {
            balancesBefore.push(await getBalance(accounts[i + 1]));
        }

        const tx = await contract.testTransferBackDeposits();
        truffleAssert.eventEmitted(tx, "TransferEvent");

        for (let i = 0; i < MOCK_BIDS.length; i++) {
            const isWinner = accounts[i + 1] === winner.accountAddress;
            const currentBalance = await getBalance(accounts[i + 1]);
            
            const refundedValue = isWinner ? DEPOSIT_VALUE - MOCK_BIDS[i] : DEPOSIT_VALUE;
            expect(Number(currentBalance - balancesBefore[i])).to.equal(refundedValue);
        }
    });

    it("did not send deposit back to invalid bidder", async () => {
        const invalidBidder = accounts[1];
        await mockBidding(MOCK_BIDS, true); // Include invalid first bid
        await contract.setCurrentState(CLOSED_STATE);
        await contract.testFindWinner();

        let balanceBefore = await getBalance(invalidBidder);
        let tx = await contract.testTransferBackDeposits();
        truffleAssert.eventEmitted(tx, "TransferEvent");
        let balanceAfter = await getBalance(invalidBidder);
        
        expect(Number(balanceAfter - balanceBefore)).to.equal(0);
    });

    it("sent highest bid to seller, no extra deposits", async () => {
        const highestBid = await mockBidding(MOCK_BIDS);
        await time.increase(ONE_DAY + 1);
        await contract.closeOpenRound();
        await contract.testFindWinner();
        await contract.testTransferBackDeposits();
        
        const balanceBefore = await getBalance(sellerAccount);
        const tx = await contract.testTransferHighestBidToSeller();
        truffleAssert.eventEmitted(tx, "TransferEvent");
        const balanceAfter = await getBalance(sellerAccount);

        expect(Number(balanceAfter - balanceBefore)).to.equal(highestBid.bid);
    });

    it("sent highest bid to seller, one extra deposit", async () => {
        const highestBid = await mockBidding(MOCK_BIDS, true); // Include invalid first bid
        await time.increase(ONE_DAY + 1);
        await contract.closeOpenRound();
        await contract.testFindWinner();
        await contract.testTransferBackDeposits();
        
        const balanceBefore = BigInt(await web3.eth.getBalance(sellerAccount));
        const tx = await contract.testTransferHighestBidToSeller({ gasPrice: 0});
        truffleAssert.eventEmitted(tx, "TransferEvent");
        const balanceAfter = BigInt(await web3.eth.getBalance(sellerAccount));

        expect(Number(balanceAfter - balanceBefore)).to.equal(highestBid.bid + DEPOSIT_VALUE);
    });

    it("winner retrieved token", async() => {
        await mockBidding(MOCK_BIDS);
        await time.increase(ONE_DAY + 1);
        await contract.closeAuction();
        const winner = await contract.winner.call();

        const tx = await contract.retrieveToken({ from: winner.accountAddress });
        truffleAssert.eventEmitted(tx, "RetrievedToken");
    });

    it("non-winner is not allowed to retrieve token", async() => {
        await mockBidding(MOCK_BIDS);
        await time.increase(ONE_DAY + 1);
        await contract.closeAuction();

        await truffleAssert.reverts(
            contract.retrieveToken({ from: accounts[1] }),
            "You are not the winner of the auction!"
        );
    });

    it("token should not be callable", async() => {
        await mockBidding(MOCK_BIDS);
        await time.increase(ONE_DAY + 1);
        await contract.closeAuction();
        
        try {
            await contract.token.call();
            expect.fail();
        } catch(error) {
            expect(error.message).to.equal("Cannot read property 'call' of undefined");
        }
    });

    // CONVENIENCE FUNCTIONS

    getAuctionInfo = async () => {
        let info = await contract.getAuctionInfo.call();
        return {
            "currentState": Number(info[0]),
            "seller": info[1],
            "energyAmount": Number(info[2]),
            "minBidValue": Number(info[3]),
            "depositValue": Number(info[4]),
            "hiddenBidsDeadline": Number(info[5]),
            "openBidsDeadline": Number(info[6]),
        };
    }

    bidInHiddenRound = async (bidValue, bidderAddress, depositValue) => {
        let tx = await contract.bidInHiddenRound(web3.utils.soliditySha3(bidValue, "some_salt"), {
            value: depositValue,
            from: bidderAddress
        });

        truffleAssert.eventEmitted(tx, "ReceivedHiddenBid", (ev) => {
            return ev.bidder == bidderAddress && ev.deposit == depositValue;
        });
    };

    bidInOpenRound = async (bidValue, salt, bidderAddress) => {
        let tx = await contract.bidInOpenRound(bidValue, salt, { 
            from: bidderAddress
        });

        truffleAssert.eventEmitted(tx, "ReceivedOpenBid", (ev) => {
            return ev.bidder == bidderAddress && ev.bid == bidValue;
        });
    };

    mockBidding = async (bids, includeInvalidBid = false) => {
        for (let i = 0; i < bids.length; i++) {
            await bidInHiddenRound(bids[i], accounts[i + 1], DEPOSIT_VALUE);
        }
        let hiddenBidsNum = Number(await contract.getHiddenBidsLength.call());
        expect(hiddenBidsNum).to.equal(bids.length);

        await time.increase(ONE_DAY + 1);
        await contract.closeHiddenRound();

        for (let i = 0; i < bids.length; i++) {
            if (includeInvalidBid && i == 0) {
                await truffleAssert.reverts(
                    bidInOpenRound(bids[i] - 1, "some_salt", accounts[i + 1]),
                    "Open bid and hidden bid do not match"
                );
                continue;
            }
            await bidInOpenRound(bids[i], "some_salt", accounts[i + 1]);
        }

        let highestBid = Math.max(...bids);
        let highestBidder = accounts[bids.indexOf(highestBid) + 1];
        return { "bid": highestBid, "bidder": highestBidder};
    };

    getBalance = async (account) => {
        return BigInt(await web3.eth.getBalance(account));
    };
});