// SPDX-License-Identifier: MIT
pragma solidity ^0.8.1;
import "./Auction.sol";

contract TestAuction is Auction {
    constructor(
        address payable _seller,
        uint _energyAmount, 
        uint _minBidValue, 
        uint _depositValue
    ) Auction (
        _seller,
        _energyAmount, 
        _minBidValue, 
        _depositValue
    ) {}

    function setCurrentState(State newState) public {
        auctionInfo.currentState = newState;
    }

    function getHiddenBidsLength() public view returns(uint256) {
        return hiddenBidsAddresses.length;
    }

    function testFindWinner() public {
        findWinner();
    }

    function testTransferBackDeposits() public {
        transferBackDeposits();
    }

    function testTransferHighestBidToSeller() public {
        transferHighestBidToSeller();
    }
}
