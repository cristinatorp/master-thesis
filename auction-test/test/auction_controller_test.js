let AuctionController = artifacts.require("./TestAuctionController.sol");
let Auction = artifacts.require("./TestAuction.sol");
const truffleAssert = require("truffle-assertions");
const { time } = require("@openzeppelin/test-helpers");

contract("AuctionController", accounts => {
    let contract;
    const owner = accounts[0];
    const seller = accounts[1];
    const energyAmount = 200;
    const minBid = 5000000;
    const deposit = 1000000000;
    const ONE_DAY = 86400;

    beforeEach(async () => {
        contract = await AuctionController.new(
            { from: owner, gas: 6700000 }
        );
    });

    it("contract is initialized", async () => {
        const admin = await contract.testGetAdmin();
        expect(admin).to.equal(owner);
    });

    it("can deploy new auction contract", async () => {
        const tx = await contract.deployNewAuction(
            seller, 
            energyAmount, 
            minBid, 
            deposit,
        );

        const newAuctionAddress = tx.logs[0].args.auction;
        const sellerAddress = await contract.sellerAddresses.call(newAuctionAddress);
        expect(sellerAddress).to.equal(seller);
        
        const auction = await Auction.at(newAuctionAddress);
        const {1: aSeller, 2: aEnergyAmount, 3: aMinBid, 4: aDeposit} = await auction.getAuctionInfo();
        expect(aSeller).to.equal(seller);
        expect(Number(aEnergyAmount)).to.equal(energyAmount);
        expect(Number(aMinBid)).to.equal(minBid);
        expect(Number(aDeposit)).to.equal(deposit);

        truffleAssert.eventEmitted(tx, "AddedNewAuction");
    });

    it("cannot delete auction if not admin or auction seller", async () => {
        const tx = await contract.deployNewAuction(
            seller, 
            energyAmount, 
            minBid, 
            deposit,
        );

        const newAuctionAddress = tx.logs[0].args.auction;

        await truffleAssert.reverts(
            contract.deleteAuction(newAuctionAddress, { from: accounts[2] }),
            "Can only be deleted by admin or the auction seller"
        );
    });

    it("cannot delete auction if in the hidden round", async () => {
        const tx = await contract.deployNewAuction(
            seller, 
            energyAmount, 
            minBid, 
            deposit,
        );
        
        const newAuctionAddress = tx.logs[0].args.auction;
        
        await truffleAssert.reverts(
            contract.deleteAuction(newAuctionAddress, { from: owner }),
            "Cannot delete auction before the token has expired or been retrieved"
        );
    });

    it("cannot delete auction if in the open round", async () => {
        const tx = await contract.deployNewAuction(
            seller, 
            energyAmount, 
            minBid, 
            deposit,
        );
        
        const newAuctionAddress = tx.logs[0].args.auction;
        const auction = await Auction.at(newAuctionAddress);
        await auction.bidInHiddenRound(web3.utils.soliditySha3(minBid, "some_salt"), { from: accounts[2], value: deposit });
        await time.increase(ONE_DAY + 1);
        await auction.closeHiddenRound();
        
        await truffleAssert.reverts(
            contract.deleteAuction(newAuctionAddress, { from: owner }),
            "Cannot delete auction before the token has expired or been retrieved"
        );
    });

    it("cannot delete auction if the token has not yet expired or been retrieved", async () => {
        const tx = await contract.deployNewAuction(
            seller, 
            energyAmount, 
            minBid, 
            deposit,
        );
        
        const newAuctionAddress = tx.logs[0].args.auction;
        const auction = await Auction.at(newAuctionAddress);
        await auction.bidInHiddenRound(web3.utils.soliditySha3(minBid, "some_salt"), { from: accounts[2], value: deposit });
        await time.increase(ONE_DAY + 1);
        await auction.closeHiddenRound();
        await auction.bidInOpenRound(minBid, "some_salt", { from: accounts[2] });
        await time.increase(ONE_DAY + 1);
        await auction.closeAuction();
        
        await truffleAssert.reverts(
            contract.deleteAuction(newAuctionAddress, { from: owner }),
            "Cannot delete auction before the token has expired or been retrieved"
        );
    });

    it("admin can delete auction", async () => {
        const auctionAddress = await mockAuction(seller);

        const deleteTx = await contract.deleteAuction(auctionAddress, { from: owner });
        truffleAssert.eventEmitted(deleteTx, "DeletedAuction", (ev) => ev.auction == auctionAddress);
    });

    it("seller can delete auction", async () => {
        const auctionAddress = await mockAuction(seller);

        const deleteTx = await contract.deleteAuction(auctionAddress, { from: seller });
        truffleAssert.eventEmitted(deleteTx, "DeletedAuction", (ev) => ev.auction == auctionAddress);
    });

    it("seller can delete his own auction, but not one from another seller", async () => {
        const sellersAuction = await mockAuction(seller);
        const anotherAuction = await mockAuction(accounts[2]);
        
        const deleteTx = await contract.deleteAuction(sellersAuction, { from: seller });
        truffleAssert.eventEmitted(deleteTx, "DeletedAuction", (ev) => ev.auction == sellersAuction);

        await truffleAssert.reverts(
            contract.deleteAuction(anotherAuction, { from: seller }),
            "Can only be deleted by admin or the auction seller"
        );
    });

    mockAuction = async (sellerAddress) => {
        const tx = await contract.deployNewAuction(
            sellerAddress, 
            energyAmount, 
            minBid, 
            deposit,
        );
        
        const newAuctionAddress = tx.logs[0].args.auction;
        const auction = await Auction.at(newAuctionAddress);
        
        await auction.bidInHiddenRound(web3.utils.soliditySha3(minBid, "some_salt"), { from: accounts[2], value: deposit });
        await time.increase(ONE_DAY + 1);
        await auction.closeHiddenRound();
        await auction.bidInOpenRound(minBid, "some_salt", { from: accounts[2] });
        await time.increase(ONE_DAY + 1);
        await auction.closeAuction();
        await auction.retrieveToken({ from: accounts[2] });

        return newAuctionAddress;
    };
});