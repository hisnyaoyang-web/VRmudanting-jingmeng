// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {ShadowRelic} from "../src/ShadowRelic.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";

contract ShadowRelicTest is Test {
    ShadowRelic relic;
    uint256 signerKey = 0xA11CE;
    address signer;
    address collector = makeAddr("collector");
    bytes32 storyId = keccak256("moongate-night");
    bytes32 seasonId = keccak256("2026-S08");
    uint32 score = 630;
    uint8 grade = 2;
    uint256 deadline;

    function setUp() public {
        signer = vm.addr(signerKey);
        relic = new ShadowRelic("ipfs://demo/", signer);
        deadline = block.timestamp + 30 minutes;
    }

    function signature(bytes32 nonce) internal view returns (bytes memory) {
        bytes32 digest = relic.claimDigest(collector, storyId, seasonId, score, grade, nonce, deadline);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(signerKey, digest);
        return abi.encodePacked(r, s, v);
    }

    function claim(bytes32 nonce) internal returns (uint256) {
        bytes memory signed = signature(nonce);
        vm.prank(collector);
        return relic.claim(
            collector, storyId, seasonId, score, grade, nonce, deadline, signed
        );
    }

    function testClaimsSignedRelicAndStoresResult() public {
        uint256 tokenId = claim(bytes32(uint256(1)));
        assertEq(tokenId, 0);
        assertEq(relic.ownerOf(0), collector);
        (bytes32 storedStory, bytes32 storedSeason, uint32 storedScore, uint8 storedGrade) = relic.relicData(0);
        assertEq(storedStory, storyId);
        assertEq(storedSeason, seasonId);
        assertEq(storedScore, score);
        assertEq(storedGrade, grade);
    }

    function testRejectsReplayNonce() public {
        bytes32 nonce = bytes32(uint256(2));
        claim(nonce);
        bytes memory signed = signature(nonce);
        vm.prank(collector);
        vm.expectRevert(ShadowRelic.NonceAlreadyUsed.selector);
        relic.claim(collector, keccak256("other"), seasonId, score, grade, nonce, deadline, signed);
    }

    function testRejectsSecondClaimForStoryAndSeason() public {
        claim(bytes32(uint256(3)));
        bytes32 otherNonce = bytes32(uint256(4));
        bytes memory signed = signature(otherNonce);
        vm.prank(collector);
        vm.expectRevert(ShadowRelic.AlreadyClaimed.selector);
        relic.claim(collector, storyId, seasonId, score, grade, otherNonce, deadline, signed);
    }

    function testRejectsExpiredVoucher() public {
        bytes32 nonce = bytes32(uint256(5));
        bytes memory signed = signature(nonce);
        vm.warp(deadline + 1);
        vm.prank(collector);
        vm.expectRevert(ShadowRelic.ClaimExpired.selector);
        relic.claim(collector, storyId, seasonId, score, grade, nonce, deadline, signed);
    }

    function testRejectsWrongCaller() public {
        bytes32 nonce = bytes32(uint256(6));
        bytes memory signed = signature(nonce);
        vm.prank(makeAddr("attacker"));
        vm.expectRevert(ShadowRelic.InvalidPlayer.selector);
        relic.claim(collector, storyId, seasonId, score, grade, nonce, deadline, signed);
    }

    function testRejectsForgedSignature() public {
        bytes32 nonce = bytes32(uint256(7));
        bytes32 digest = relic.claimDigest(collector, storyId, seasonId, score, grade, nonce, deadline);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(0xB0B, digest);
        vm.prank(collector);
        vm.expectRevert(ShadowRelic.InvalidSigner.selector);
        relic.claim(collector, storyId, seasonId, score, grade, nonce, deadline, abi.encodePacked(r, s, v));
    }

    function testOwnerCanPauseAndRotateSigner() public {
        relic.pause();
        bytes32 nonce = bytes32(uint256(8));
        bytes memory signed = signature(nonce);
        vm.prank(collector);
        vm.expectRevert(Pausable.EnforcedPause.selector);
        relic.claim(collector, storyId, seasonId, score, grade, nonce, deadline, signed);

        relic.unpause();
        address replacement = makeAddr("replacement");
        relic.setGameSigner(replacement);
        assertEq(relic.gameSigner(), replacement);
    }
}
