import { visit } from '@solidity-parser/parser';
import { format } from "prettier";
import { writeFileSync } from 'fs';
import shell from 'shelljs';
import { getProvider, ethers } from "@fortanetwork/forta-bot";
import { parseContract } from './parser.js';

const findConstructor = (entryContract) => {
    let constructor;
    visit(entryContract, {
        FunctionDefinition: function(fn) {
            if (fn.isConstructor && fn.name === null) {
                constructor = fn;
            }
        }
    })
    return constructor;
}

export const DefaultInjector = (sourceCode) => {
    const formattedSourceCode = format(sourceCode, {
        parser: 'solidity-parse',
    });
    const contractInfo = parseContract(formattedSourceCode)

    // find constructor
    const entryContract = contractInfo.entryContract;
    const constructor = findConstructor(entryContract);

    let injectLocation, injectCode;

    if (!constructor) {
        injectCode = '\nconstructor() public { '
        injectLocation = [entryContract.loc.end.line, entryContract.loc.end.column];
    } else {
        injectCode = '\n'
        injectLocation = [constructor.loc.end.line, constructor.loc.end.column];
    }

    if (contractInfo.isTokenContract) {
        if (contractInfo.internalFunctions.includes('_mint')) {
            // inject _mint() to constructor
            injectCode += '_mint(msg.sender, 1e20); '
        }
    }

    if (!constructor) {
        injectCode += '}'
    }

    // add injectCode to formattedSourceCode at line injectLocation
    let injectSourceCode = formattedSourceCode.split('\n').slice(0, injectLocation[0] - 1).join('\n') +
        "\n" + formattedSourceCode.split('\n')[injectLocation[0] - 1].slice(0, injectLocation[1]) +
        injectCode + formattedSourceCode.split('\n')[injectLocation[0] - 1].slice(injectLocation[1]) + "\n" +
        formattedSourceCode.split('\n').slice(injectLocation[0]).join('\n');
    // add forge library
    if (!injectSourceCode.includes("pragma experimental ABIEncoderV2")) {
        injectSourceCode += '\npragma experimental ABIEncoderV2;\n';
    }
    injectSourceCode += '\nimport "forge-std/Test.sol";\n';
    return format(injectSourceCode, {
        parser: 'solidity-parse',
    })
}

export class DynamicTest {
    constructor(sourceCode, constructorArguments) {
        this.sourceCode = sourceCode;

        let contractInfo;
        contractInfo = parseContract(sourceCode)
        this.contractInfo = contractInfo;

        const entryContract = contractInfo.entryContract;
        const constructor = findConstructor(entryContract);
        let args = []
        if (constructor.parameters.length > 0) {
            const types = constructor.parameters.map(p => {
                const depth = [];
                let curr = p.typeName, name;

                while (true) {
                    if (curr.type === "ElementaryTypeName") {
                        name = curr.name;
                        break;
                    } else if (curr.type === "ArrayTypeName") {
                        depth.push(!!curr.length ? curr.length.toString() : "");
                        curr = curr.baseTypeName;
                    }
                }

                return `${name}${depth.map(d => `[${d}]`).join('')}`;
            });
            try {
                for (const arg of ethers.utils.defaultAbiCoder.decode(types, `0x${constructorArguments}`)) {
                    if (ethers.BigNumber.isBigNumber(arg)) {
                        args.push(arg.toString());
                    } else if (typeof arg === 'string') {
                        if (arg.startsWith("0x")) {
                            args.push(arg);
                        } else {
                            args.push(`"${arg}"`);
                        }
                    } else {
                        args.push(arg);
                    }
                }
            } catch (e) {

            }
        }

        this.testHoneypot = `
contract DynamicHoneypotTest is Test {
    ${entryContract.name} target;
    bool willSkip;

    function setUp() public {
        target = new ${entryContract.name}(${args.join(", ")});
        ${this.contractInfo.hasBalanceVariable ? 'deal(address(target), address(this), 1e20);' : ''}
        ${this.contractInfo.isOwnableContract ? 'address testAddress = address(this);vm.startPrank(address(target.owner()));target.transfer(testAddress, target.balanceOf(target.owner()));target.transferOwnership(testAddress);vm.stopPrank();' : ''}
        uint balanceInitial = target.balanceOf(address(this));
        if (balanceInitial > 0) {
            willSkip = false;
            target.transfer(address(0x1), 100000000);
        } else {
            willSkip = true;
        }
        skip(60 * 60 * 24 * 365);
    }
    
    function invariant_transfer() external {
        if (willSkip) return;
    
        uint balanceInitial = target.balanceOf(address(0x1));
        if (balanceInitial > 0) {
            vm.startPrank(address(0x1));
            uint256 balanceBefore = target.balanceOf(address(0x2));
            target.transfer(address(0x2), 100);
            uint256 balanceAfter = target.balanceOf(address(0x2));
            assertGt(balanceAfter, balanceBefore);
            vm.stopPrank();
        }
    }
}
`
        this.testHiddenMints = `
contract DynamicHiddenMintsTest is Test {
    ${entryContract.name} target;
    uint256 totalSupply;

    function setUp() public {
        target = new ${entryContract.name}(${args.join(", ")});
        ${this.contractInfo.isOwnableContract ? 'address testAddress = address(this);vm.startPrank(address(target.owner()));target.transfer(testAddress, target.balanceOf(target.owner()));target.transferOwnership(testAddress);vm.stopPrank();' : ''}
        totalSupply = target.totalSupply();
        targetSender(address(this));
        skip(60 * 60 * 24 * 365);
    }
    
    function invariant_totalsupply() external {
        assertTrue(totalSupply >= target.totalSupply());
    }
}
`
        this.testFakeOwnershipRenounciation = `
contract DynamicFakeOwnershipRenounciationTest is Test {
    ${entryContract.name} target;

    function setUp() public {
        target = new ${entryContract.name}(${args.join(", ")});
        ${this.contractInfo.isOwnableContract ? 'address testAddress = address(this);vm.startPrank(address(target.owner()));target.transferOwnership(testAddress);vm.stopPrank();' : ''}
        targetSender(address(this));
        // transfer ownership to 0x1
        target.transferOwnership(address(0x1));
        excludeSender(address(0x1));
        skip(60 * 60 * 24 * 365);
    }
    
    function invariant_ownership() external {
        assertTrue(target.owner() == address(0x1) && target.owner() != address(0x0));
    }
}
`
        this.testHiddenTransfers = `
contract DynamicHiddenTransfersTest is Test {
    ${entryContract.name} target;
    uint256 balance;
    bool willSkip;

    function setUp() public {
        target = new ${entryContract.name}(${args.join(", ")});
        ${this.contractInfo.hasBalanceVariable ? 'deal(address(target), address(this), 1e20);' : ''}
        ${this.contractInfo.isOwnableContract ? 'address testAddress = address(this);vm.startPrank(address(target.owner()));target.transfer(testAddress, target.balanceOf(target.owner()));target.transferOwnership(testAddress);vm.stopPrank();' : ''}
        uint balanceInitial = target.balanceOf(address(this));
        if (balanceInitial > 0) {
            willSkip = false;
            target.transfer(address(0x1), 100000000);
            balance = target.balanceOf(address(0x1));
        } else {
            willSkip = true;
        }
        targetSender(address(this));
        excludeSender(address(0x1));
        skip(60 * 60 * 24 * 365);
    }
    
    function invariant_balances() external {
        if (willSkip) return;
        assertTrue(target.balanceOf(address(0x1)) >= balance);
    }
}
`
        this.testHiddenFeeModifiers = `
contract DynamicHiddenFeeModifiersTest is Test {
    ${entryContract.name} target;
    uint256 fee;
    bool willSkip;

    function setUp() public {
        target = new ${entryContract.name}(${args.join(", ")});
        ${this.contractInfo.hasBalanceVariable ? 'deal(address(target), address(this), 1e20);' : ''}
        ${this.contractInfo.isOwnableContract ? 'address testAddress = address(this);vm.startPrank(address(target.owner()));try target.transfer(testAddress, target.balanceOf(target.owner())) returns (bool success) {if (!success) {willSkip = false;}} catch  {willSkip = false;}target.transferOwnership(testAddress);vm.stopPrank();' : ''}
        uint balanceInitial = target.balanceOf(address(this));
        if (balanceInitial > 0) {
            willSkip = willSkip || false;
            target.transfer(address(0x1), 1e6);
            // get current Fee
            vm.startPrank(address(0x1));
            uint256 balanceBefore = target.balanceOf(address(0x2));
            target.transfer(address(0x2), 1e5);
            uint256 balanceAfter = target.balanceOf(address(0x2));
            fee = 1e5 - (balanceAfter - balanceBefore);
            vm.stopPrank();
        } else {
            willSkip = true;
        }
        targetSender(address(this));
        skip(60 * 60 * 24 * 365);
    }
    
    function invariant_fee() external {
        if (willSkip) return;
        
        vm.startPrank(address(0x1));
        uint256 balanceBefore = target.balanceOf(address(0x2));
        try target.transfer(address(0x2), 1e5) returns (bool success) {
            uint256 balanceAfter = target.balanceOf(address(0x2));
            if (success || balanceAfter > balanceBefore) {
                uint256 currentFee = 1e5 - (balanceAfter - balanceBefore);
                vm.stopPrank();
                assertEq(fee, currentFee);
            }
        } catch  {
            vm.stopPrank();
        }
    }
}
`
        this.testHiddenTransferReverts = `
contract DynamicHiddenTransferRevertsTest is Test {
    ${entryContract.name} target;
    bool willSkip;

    function setUp() public {
        target = new ${entryContract.name}(${args.join(", ")});
        ${this.contractInfo.hasBalanceVariable ? 'deal(address(target), address(this), 1e20);' : ''}
        ${this.contractInfo.isOwnableContract ? 'address testAddress = address(this);vm.startPrank(address(target.owner()));try target.transfer(testAddress, target.balanceOf(target.owner())) returns (bool success) {if (!success) {willSkip = false;}} catch  {willSkip = false;}target.transferOwnership(testAddress);vm.stopPrank();' : ''}
        
        uint balanceInitial = target.balanceOf(address(this));
        if (balanceInitial > 0) {
            willSkip = willSkip || false;
            target.transfer(address(0x1), 100000000);
        } else {
            willSkip = true;
        }
        targetSender(address(this));
        skip(60 * 60 * 24 * 365);
    }
    
    function invariant_transfer_without_revert() external {
        if (willSkip) return;
        
        vm.startPrank(address(0x1));
        uint256 selfBalance = target.balanceOf(address(0x1));
        target.transfer(address(0x2), selfBalance);
        vm.stopPrank();
    }
}
`
    }

    async test(txEvent) {
        if (!this.contractInfo.isTokenContract) {
            console.log(`Tests skipped for ${txEvent.transaction.hash}: not a standard ERC20 token contract`);
            return {};
        } else {
            console.log(`Testing ${txEvent.transaction.hash}...`)
        }

        let testedCode = this.sourceCode

        if (this.contractInfo.isTokenContract) {
            testedCode += `\n${this.testHoneypot}`;
            testedCode += `\n${this.testHiddenMints}`;
            testedCode += `\n${this.testHiddenTransfers}`;
            testedCode += `\n${this.testHiddenFeeModifiers}`;
            testedCode += `\n${this.testHiddenTransferReverts}`;
        }

        if (this.contractInfo.isOwnableContract) {
            testedCode += `\n${this.testFakeOwnershipRenounciation}`;
        }

        writeFileSync('./test/test.sol', testedCode, 'utf8');

        let testResultJson;
        const provider = await getProvider();
        try {
            const testCommand = `RUST_LOG=off forge test -f ${provider.connection.url} --fork-block-number ${txEvent.block.number} --json --silent`
            const timeBefore = Date.now();
            const testResult = await shell.exec(testCommand, {silent: true}).toString();
            const timeAfter = Date.now();
            console.log(`Tested ${txEvent.transaction.hash}: ${timeAfter - timeBefore}ms`);
            testResultJson = JSON.parse(testResult);
        } catch (e) {
            // console.error(e)
            return {};
        }

        return testResultJson;
    }
}
