// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

contract ShadowRelic is ERC721, Ownable {
    uint256 public nextTokenId;
    string private baseTokenURI;

    constructor(string memory initialBaseURI)
        ERC721("Shadow Relic", "SHADOW")
        Ownable(msg.sender)
    {
        baseTokenURI = initialBaseURI;
    }

    function mint() external returns (uint256 tokenId) {
        tokenId = nextTokenId++;
        _safeMint(msg.sender, tokenId);
    }

    function setBaseURI(string calldata newBaseURI) external onlyOwner {
        baseTokenURI = newBaseURI;
    }

    function _baseURI() internal view override returns (string memory) {
        return baseTokenURI;
    }
}
