// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {ShadowRelic} from "../src/ShadowRelic.sol";

contract ShadowRelicTest is Test {
    ShadowRelic relic;
    address collector = makeAddr("collector");

    function setUp() public {
        relic = new ShadowRelic("ipfs://demo/");
    }

    function testMintToCaller() public {
        vm.prank(collector);
        uint256 tokenId = relic.mint();
        assertEq(tokenId, 0);
        assertEq(relic.ownerOf(0), collector);
    }
}
