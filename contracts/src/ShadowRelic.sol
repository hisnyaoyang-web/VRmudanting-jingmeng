// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

contract ShadowRelic is ERC721, Ownable, Pausable, EIP712 {
    bytes32 public constant CLAIM_TYPEHASH = keccak256(
        "Claim(address player,bytes32 storyId,bytes32 seasonId,uint32 score,uint8 grade,bytes32 nonce,uint256 deadline)"
    );

    struct RelicData {
        bytes32 storyId;
        bytes32 seasonId;
        uint32 score;
        uint8 grade;
    }

    error ClaimExpired();
    error InvalidSigner();
    error InvalidPlayer();
    error InvalidGrade();
    error NonceAlreadyUsed();
    error AlreadyClaimed();
    error ZeroAddress();

    uint256 public nextTokenId;
    address public gameSigner;
    string private baseTokenURI;

    mapping(bytes32 nonce => bool used) public usedNonces;
    mapping(bytes32 claimKey => bool claimed) public claimedStorySeason;
    mapping(uint256 tokenId => RelicData data) public relicData;

    event GameSignerUpdated(address indexed previousSigner, address indexed newSigner);
    event RelicClaimed(
        address indexed player,
        uint256 indexed tokenId,
        bytes32 indexed storyId,
        bytes32 seasonId,
        uint32 score,
        uint8 grade
    );

    constructor(string memory initialBaseURI, address initialGameSigner)
        ERC721("Shadow Relic", "SHADOW")
        Ownable(msg.sender)
        EIP712("Shadow Relic", "1")
    {
        if (initialGameSigner == address(0)) revert ZeroAddress();
        baseTokenURI = initialBaseURI;
        gameSigner = initialGameSigner;
    }

    function claim(
        address player,
        bytes32 storyId,
        bytes32 seasonId,
        uint32 score,
        uint8 grade,
        bytes32 nonce,
        uint256 deadline,
        bytes calldata signature
    ) external whenNotPaused returns (uint256 tokenId) {
        if (player != msg.sender) revert InvalidPlayer();
        if (grade > 2) revert InvalidGrade();
        if (block.timestamp > deadline) revert ClaimExpired();
        if (usedNonces[nonce]) revert NonceAlreadyUsed();

        bytes32 claimKey = keccak256(abi.encode(player, storyId, seasonId));
        if (claimedStorySeason[claimKey]) revert AlreadyClaimed();

        bytes32 structHash = keccak256(
            abi.encode(CLAIM_TYPEHASH, player, storyId, seasonId, score, grade, nonce, deadline)
        );
        address recovered = ECDSA.recover(_hashTypedDataV4(structHash), signature);
        if (recovered != gameSigner) revert InvalidSigner();

        usedNonces[nonce] = true;
        claimedStorySeason[claimKey] = true;
        tokenId = nextTokenId++;
        relicData[tokenId] = RelicData(storyId, seasonId, score, grade);
        _safeMint(player, tokenId);
        emit RelicClaimed(player, tokenId, storyId, seasonId, score, grade);
    }

    function claimDigest(
        address player,
        bytes32 storyId,
        bytes32 seasonId,
        uint32 score,
        uint8 grade,
        bytes32 nonce,
        uint256 deadline
    ) external view returns (bytes32) {
        bytes32 structHash = keccak256(
            abi.encode(CLAIM_TYPEHASH, player, storyId, seasonId, score, grade, nonce, deadline)
        );
        return _hashTypedDataV4(structHash);
    }

    function setGameSigner(address newSigner) external onlyOwner {
        if (newSigner == address(0)) revert ZeroAddress();
        emit GameSignerUpdated(gameSigner, newSigner);
        gameSigner = newSigner;
    }

    function setBaseURI(string calldata newBaseURI) external onlyOwner {
        baseTokenURI = newBaseURI;
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    function _baseURI() internal view override returns (string memory) {
        return baseTokenURI;
    }
}
