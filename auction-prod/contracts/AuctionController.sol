// SPDX-License-Identifier: MIT
pragma solidity ^0.8.1;

import "./Auction.sol";

contract AuctionController {
    address private admin;
    mapping(address => address) public sellerAddresses; // auction addr => seller addr

    event AddedNewAuction(address auction);
    event DeletedAuction(address auction);

    constructor() {
        admin = msg.sender;
    }

    function deployNewAuction(
        address payable _seller, 
        uint _energyAmount, 
        uint _minBidValue,
        uint _depositValue
    ) public {
        // Deploy new auction contract
        Auction newAuction = new Auction(
            _seller, 
            _energyAmount, 
            _minBidValue, 
            _depositValue
        );
        
        // Save seller address
        sellerAddresses[address(newAuction)] = _seller;
        emit AddedNewAuction(address(newAuction));
    }

    /// Auction cannot be deleted until either:
    ///     (1) Token has been retrieved
    ///     (2) Token has expired
    ///     (3) Auction has closed with no bids
    /// Auction can only be deleted by admin or by the auction seller
    function deleteAuction(address auctionAddress) public {
        Auction auction = Auction(auctionAddress);

        require(msg.sender == sellerAddresses[auctionAddress] || msg.sender == admin, "Can only be deleted by admin or the auction seller");
        
        bool tokenExpired = block.timestamp > auction.getTokenValidUntil() && auction.getTokenValidUntil() != 0;
        if (!tokenExpired) {
            require(auction.getCurrentState() == Auction.State.ReadyForDeletion, "Cannot delete auction before the token has expired or been retrieved");
        }
        
        auction.deleteAuction();
        delete sellerAddresses[auctionAddress];

        emit DeletedAuction(auctionAddress);
    }
}