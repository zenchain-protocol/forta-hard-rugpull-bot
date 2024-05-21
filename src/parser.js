import { parse, visit } from '@solidity-parser/parser';

const isTokenContract = (callableFunctions, events) => {
    return callableFunctions.includes('name') &&
        callableFunctions.includes('symbol') &&
        callableFunctions.includes('decimals') &&
        callableFunctions.includes('totalSupply') &&
        callableFunctions.includes('balanceOf') &&
        callableFunctions.includes('transfer') &&
        callableFunctions.includes('transferFrom') &&
        callableFunctions.includes('approve') &&
        callableFunctions.includes('allowance') &&
        events.includes('Transfer') &&
        events.includes('Approval');
}

const isOwnableContract = (callableFunctions, events) => {
return callableFunctions.includes('owner') &&
        callableFunctions.includes('transferOwnership') &&
        events.includes('OwnershipTransferred');
}

export const parseContract = (sourceCode) => {
    const ast = parse(sourceCode, { loc: true });

    const contracts = [];
    for (const node of ast.children) {
        if (node.type === 'ContractDefinition') {
            contracts.push(node);
        }
    }

    // construct dependency tree
    const dependencyTree = {};
    let topNode;

    while (Object.keys(dependencyTree).length !== contracts.length) {
        for (const contract of contracts) {
            let notMatch = false
            for (const baseContract of contract.baseContracts) {
                if (!(baseContract.baseName.namePath in dependencyTree)) {
                    notMatch = true;
                    break;
                }
            }
            if (!notMatch) {
                dependencyTree[contract.name] = contract.baseContracts.map(baseContract => baseContract.baseName.namePath);
                topNode = contract;
            }
        }
    }

    let callableFunctions = new Set(), internalFunctions = new Set();
    let events = new Set();
    let mainNodes = [];
    const travel = (nodeName) => {
        for (const node of ast.children) {
            if (node.type === 'ContractDefinition' && node.name === nodeName) {
                mainNodes.push(node);

                for (const fn of node.subNodes) {
                    if (fn.type === 'FunctionDefinition' && fn.name) {
                        if (fn.visibility === 'public' || fn.visibility === 'external' || fn.visibility === 'default') {
                            callableFunctions.add(fn.name);
                        } else {
                            internalFunctions.add(fn.name);
                        }
                    } else if (fn.type === 'StateVariableDeclaration') {
                        for (const varDecl of fn.variables) {
                            if (varDecl.visibility === 'public') {
                                callableFunctions.add(varDecl.name);
                            }
                        }
                    } else if (fn.type === 'EventDefinition') {
                        events.add(fn.name);
                    }
                }

                for (const baseContract of node.baseContracts) {
                    travel(baseContract.baseName.namePath);
                }
            }
        }
    }
    travel(topNode.name);
    callableFunctions = new Array(...callableFunctions);
    internalFunctions = new Array(...internalFunctions);
    events = new Array(...events);

    let hasBalanceVariable = false;
    visit(mainNodes, {
        "StateVariableDeclaration": function(node) {
            for (const varDecl of node.variables) {
                if (varDecl.name === '_balances' && varDecl.typeName.type === 'Mapping') {
                    hasBalanceVariable = true;
                }
            }
        }
    })

    return {
        "ast": ast,
        "callableFunctions": callableFunctions,
        "internalFunctions": internalFunctions,
        "events": events,
        "isTokenContract": isTokenContract(callableFunctions, events),
        "isOwnableContract": isOwnableContract(callableFunctions, events),
        "dependencyTree": dependencyTree,
        "entryContract": topNode,
        "hasBalanceVariable": hasBalanceVariable,
    };
}