// SPDX-License-Identifier: MIT
pragma solidity ^0.8.1;

contract Auction {
    enum State {
        ReadyForHiddenBids,
        ReadyForOpenBids,
        Closed,
        ReadyForDeletion
    }

    modifier inState(State expectedState) {
        require(auctionInfo.currentState == expectedState, "Invalid state");
        _;
    }

    modifier isBeforeDeadline(uint deadline) {
        require(block.timestamp < deadline, "Cannot bid after deadline");
        _;
    }

    modifier isAfterDeadline(uint deadline) {
        require(block.timestamp > deadline, "Cannot perform this action before the deadline");
        _;
    }

    struct AuctionInfo {
        State currentState;
        address payable seller;
        uint energyAmount;
        uint minBidValue;
        uint depositValue;
        uint hiddenBidsDeadline;
        uint openBidsDeadline;
    }

    struct Bid {
        bool existsHiddenBid;
        bytes32 hiddenBid;
        uint openBid;
        bool isOpenBidValid;
        uint deposit;
    }

    struct Winner {
        address accountAddress;
        uint bid;
    }

    struct Token {
        address winner;
        address auctionContract;
        uint energyAmount;
        uint createdAt;
        uint validUntil;
    }

    address private controller;
    AuctionInfo public auctionInfo;
    Winner public winner;
    mapping(address => Bid) public bids;
    mapping(address => Token) private token;
    address[] public hiddenBidsAddresses;

    event CreatedNewAuction(AuctionInfo auctionInfo, uint currentTime);
    event ReceivedHiddenBid(address bidder, uint deposit, uint currentTime);
    event ReceivedOpenBid(address bidder, uint bid, uint currentTime);
    event ClosedRound(string whichRound, State state, uint currentTime);
    event ClosedAuctionWithNoBids(string whichRound, uint currentTime);
    event FoundHighestBid(Winner winner, uint currentTime);
    event AuctionEnded(Winner winner, uint contractBalance, uint currentTime);
    event TransferEvent(string context, address to, uint value, uint currentTime);
    event RetrievedToken(address retrievedBy, uint currentTime);

    // msg.sender is the controller controller and not the seller address
    // Seller address must therefore be specified as a parameter
    constructor(
        address payable _seller, 
        uint _energyAmount, 
        uint _minBidValue, 
        uint _depositValue
    ) {
        uint currentTime = block.timestamp;
        controller = msg.sender;
        auctionInfo = AuctionInfo({
            currentState: State.ReadyForHiddenBids,
            seller: _seller,
            energyAmount: _energyAmount,
            minBidValue: _minBidValue * 1 wei,
            depositValue: _depositValue * 1 wei,
            hiddenBidsDeadline: currentTime + 1 days,
            openBidsDeadline: currentTime + 2 days
        });

        emit CreatedNewAuction(auctionInfo, currentTime);
    }

    /// Place a hidden bid by hashing it with keccak256().
    /// The deposit is only refunded if the bid is above the minimum bid value, 
    /// and if the open bid equals the hashed bid during the open round
    function bidInHiddenRound(bytes32 bid) public payable 
        inState(State.ReadyForHiddenBids) 
        isBeforeDeadline(auctionInfo.hiddenBidsDeadline) 
    {
        require(msg.value >= auctionInfo.depositValue, "Deposit value is too low");

        bids[msg.sender] = Bid({
            existsHiddenBid: true,
            hiddenBid: bid,
            openBid: 0,
            isOpenBidValid: false,
            deposit: msg.value * 1 wei
        });

        hiddenBidsAddresses.push(msg.sender);
        emit ReceivedHiddenBid(msg.sender, msg.value, block.timestamp);
    }

    function closeHiddenRound() public inState(State.ReadyForHiddenBids) isAfterDeadline(auctionInfo.hiddenBidsDeadline) {
        if (hiddenBidsAddresses.length == 0) {
            auctionInfo.currentState = State.ReadyForDeletion;
            emit ClosedAuctionWithNoBids("Hidden round", block.timestamp);
        } else {
            auctionInfo.currentState = State.ReadyForOpenBids;
            emit ClosedRound("Hidden round", auctionInfo.currentState, block.timestamp);
        }
    }

    function bidInOpenRound(uint openBid, string memory salt) public inState(State.ReadyForOpenBids) isBeforeDeadline(auctionInfo.openBidsDeadline) {
        require(bids[msg.sender].existsHiddenBid, "This account has not bidden in the hidden round");
        require(openBid >= auctionInfo.minBidValue, "Bid value is too low");

        bytes32 hashedBid = keccak256(abi.encodePacked(openBid, salt));
        require(bids[msg.sender].hiddenBid == hashedBid, "Open bid and hidden bid do not match");

        bids[msg.sender].isOpenBidValid = true;
        bids[msg.sender].openBid = openBid;
        emit ReceivedOpenBid(msg.sender, openBid, block.timestamp);
    }

    function closeAuction() public isAfterDeadline(auctionInfo.openBidsDeadline) inState(State.ReadyForOpenBids) {
        uint validOpenBids = 0;
        for (uint i = 0; i < hiddenBidsAddresses.length; i++) {
            if (bids[hiddenBidsAddresses[i]].isOpenBidValid) {
                validOpenBids += 1;
            }
        }
        
        if (validOpenBids == 0) {
            auctionInfo.currentState = State.ReadyForDeletion;
            emit ClosedAuctionWithNoBids("Open round, no valid bids", block.timestamp);
        } else {
            auctionInfo.currentState = State.Closed;
            emit ClosedRound("Open round", auctionInfo.currentState, block.timestamp);
            
            findWinner();
        }
    }

    function findWinner() internal inState(State.Closed) {
        address winnerAddress;
        uint highestBid;

        for(uint i = 0; i < hiddenBidsAddresses.length; i++) {
            address bidder = hiddenBidsAddresses[i];
            if (!bids[bidder].isOpenBidValid) continue;
            uint bid = bids[bidder].openBid;

            if (bid > highestBid) {
                winnerAddress = bidder;
                highestBid = bid;
            }
        }

        winner = Winner({ 
            accountAddress: winnerAddress,
            bid: highestBid
        });
        emit FoundHighestBid(winner, block.timestamp);

        token[winnerAddress] = Token({
            winner: winnerAddress,
            auctionContract: address(this),
            energyAmount: auctionInfo.energyAmount,
            createdAt: block.timestamp,
            validUntil: block.timestamp + 12 weeks
        });

        transferBackDeposits();
    }

    function transferBackDeposits() internal inState(State.Closed) {
        require(winner.accountAddress != address(0), "Must find a winner before sending back deposits");

        for (uint i = 0; i < hiddenBidsAddresses.length; i++) {
            address payable bidderAddress = payable(hiddenBidsAddresses[i]);
            Bid memory bid = bids[bidderAddress];

            // Do not send back deposit to invalid bidders
            if (!bid.isOpenBidValid) continue; 

            bool isWinner = bidderAddress == winner.accountAddress;
            if (isWinner && bid.openBid >= bid.deposit) continue;
            uint deposit = isWinner ?  bid.deposit - bid.openBid : bid.deposit;

            emit TransferEvent(
                "Transfer back deposit to bidder", 
                bidderAddress, 
                deposit, 
                block.timestamp
            );

            bidderAddress.transfer(deposit);
        }

        transferHighestBidToSeller();
    }

    function transferHighestBidToSeller() internal inState(State.Closed) {
        uint highestBid = winner.bid;
        address payable seller = auctionInfo.seller;
        string memory eventMsg = "Transfer highest bid to seller";

        if (highestBid > auctionInfo.depositValue) {
            highestBid = auctionInfo.depositValue;
            eventMsg = "The highest bid was higher than the deposit value. Transferring the deposit to seller instead";
        }

        emit TransferEvent(
            eventMsg,
            seller,
            highestBid,
            block.timestamp
        );

        seller.transfer(highestBid);

        // Transfer deposits of invalid bidders to seller
        uint contractBalance = address(this).balance;
        if (contractBalance > 0) {
            emit TransferEvent(
                "Transfer contract balance to seller", 
                seller, 
                contractBalance,
                block.timestamp
            );

            seller.transfer(contractBalance);
        }

        emit AuctionEnded(winner, address(this).balance, block.timestamp);
    }

    function retrieveToken() public inState(State.Closed) isAfterDeadline(auctionInfo.openBidsDeadline) returns(Token memory) {
        require(msg.sender == winner.accountAddress, "You are not the winner of the auction!");
        
        auctionInfo.currentState = State.ReadyForDeletion;
        emit RetrievedToken(msg.sender, block.timestamp);

        return token[msg.sender];
    }

    function getCurrentState() public view returns(State) {
        return auctionInfo.currentState;
    }

    function getTokenValidUntil() public view returns(uint) {
        return token[winner.accountAddress].validUntil;
    }

    function deleteAuction() external {
        require(msg.sender == controller, "You are not allowed to delete this auction!");
        selfdestruct(auctionInfo.seller);
    }
}