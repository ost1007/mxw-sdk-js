'use strict';

import { describe, it } from 'mocha';
import { expect } from 'chai';
import { mxw, token, errors } from '../src.ts/index';
import { bigNumberify, hexlify, randomBytes } from '../src.ts/utils';
import { nodeProvider } from "./env";
import { FungibleTokenActions } from '../src.ts/token';
//import { UNEXPECTED_RESULT, INVALID_FORMAT, INSUFFICIENT_FUNDS} from '../src.ts/errors';
import { UNEXPECTED_RESULT, INVALID_FORMAT} from '../src.ts/errors';
//import { stringify } from 'querystring';

let indent = "     ";
let silent = true;
let silentRpc = true;
let slowThreshold = 9000;

let providerConnection: mxw.providers.Provider;
let wallet: mxw.Wallet;
let provider: mxw.Wallet;
let issuer: mxw.Wallet;
let middleware: mxw.Wallet;

let fungibleTokenProperties: token.FungibleTokenProperties;
let fungibleToken: token.FungibleToken;
let issuerFungibleToken: token.FungibleToken;

let defaultOverrides = {
    logSignaturePayload: function (payload) {
        if (!silentRpc) console.log(indent, "signaturePayload:", JSON.stringify(payload));
    },
    logSignedTransaction: function (signedTransaction) {
        if (!silentRpc) console.log(indent, "signedTransaction:", signedTransaction);
    }
}

describe('Suite: FungibleToken - Fixed Supply', function () {
    this.slow(slowThreshold); // define the threshold for slow indicator

    if (silent) { silent = nodeProvider.trace.silent; }
    if (silentRpc) { silentRpc = nodeProvider.trace.silentRpc; }

    it("Initialize", function () {
        providerConnection = new mxw.providers.JsonRpcProvider(nodeProvider.connection, nodeProvider)
            .on("rpc", function (args) {
                if (!silentRpc) {
                    if ("response" == args.action) {
                        console.log(indent, "RPC REQ:", JSON.stringify(args.request));
                        console.log(indent, "    RES:", JSON.stringify(args.response));
                    }
                }
            }).on("responseLog", function (args) {
                if (!silentRpc) {
                    console.log(indent, "RES LOG:", JSON.stringify({ info: args.info, response: args.response }));
                }
            });

        // We need to use KYCed wallet to create fungible token
        wallet = mxw.Wallet.fromMnemonic(nodeProvider.kyc.issuer).connect(providerConnection);
        expect(wallet).to.exist;
        if (!silent) console.log(indent, "Wallet:", JSON.stringify({ address: wallet.address, mnemonic: wallet.mnemonic }));

        provider = mxw.Wallet.fromMnemonic(nodeProvider.fungibleToken.provider).connect(providerConnection);
        expect(provider).to.exist;
        if (!silent) console.log(indent, "Provider:", JSON.stringify({ address: provider.address, mnemonic: provider.mnemonic }));

        issuer = mxw.Wallet.fromMnemonic(nodeProvider.fungibleToken.issuer).connect(providerConnection);
        expect(issuer).to.exist;
        if (!silent) console.log(indent, "Issuer:", JSON.stringify({ address: issuer.address, mnemonic: issuer.mnemonic }));

        middleware = mxw.Wallet.fromMnemonic(nodeProvider.fungibleToken.middleware).connect(providerConnection);
        expect(middleware).to.exist;
        if (!silent) console.log(indent, "Middleware:", JSON.stringify({ address: middleware.address, mnemonic: middleware.mnemonic }));

        if (!silent) console.log(indent, "Fee collector:", JSON.stringify({ address: nodeProvider.fungibleToken.feeCollector }));
    });
});

[false, true].forEach((burnable) => {
    describe('Suite: FungibleToken - Fixed Supply ' + (burnable ? "(Burnable)" : "(Not Burnable)"), function () {
        this.slow(slowThreshold); // define the threshold for slow indicator

        it("Create", function () {
            let symbol = "FIX" + hexlify(randomBytes(4)).substring(2);
            fungibleTokenProperties = {
                name: "MY " + symbol,
                symbol: symbol,
                decimals: 18,
                fixedSupply: true,
                maxSupply: bigNumberify("100000000000000000000000000"),
                fee: {
                    to: nodeProvider.fungibleToken.feeCollector,
                    value: bigNumberify("1")
                },
                metadata: ""
            };

            return token.FungibleToken.create(fungibleTokenProperties, issuer, defaultOverrides).then((token) => {
                expect(token).to.exist;
                issuerFungibleToken = token as token.FungibleToken;
            });
        });

        it("Create - checkDuplication", function () {
            return token.FungibleToken.create(fungibleTokenProperties, issuer).then((token) => {
                expect(token).is.not.exist;
            }).catch(error => {
                expect(error.code).to.equal(errors.EXISTS);
            });
        });

        it("Query", function () {
            return refresh(fungibleTokenProperties.symbol).then(() => {
                expect(fungibleToken).to.exist;
                if (!silent) console.log(indent, "Created Token:", JSON.stringify(fungibleToken.state));
            });
        });

        it("Approve - challenge wrong fee setting", function () {
            let overrides = {
                tokenFees: [
                    { action: FungibleTokenActions.transfer, feeName: "anything" },
                    { action: FungibleTokenActions.transferOwnership, feeName: "default" },
                    { action: FungibleTokenActions.acceptOwnership, feeName: "default" }
                ],
                burnable
            };
            return performFungibleTokenStatus(fungibleTokenProperties.symbol, token.FungibleToken.approveFungibleToken, overrides).then((receipt) => {
                expect(receipt).is.not.exist;
            }).catch(error => {
                expect(error.code).to.equal(errors.MISSING_FEES);
            });
        });

        it("Approve", function () {
            let overrides = {
                tokenFees: [
                    { action: FungibleTokenActions.transfer, feeName: "transfer" },
                    { action: FungibleTokenActions.transferOwnership, feeName: "default" },
                    { action: FungibleTokenActions.acceptOwnership, feeName: "default" }
                ],
                burnable
            };
            if (burnable) {
                overrides.tokenFees.push({
                    action: FungibleTokenActions.burn, feeName: "transfer"
                });
            }
            return performFungibleTokenStatus(fungibleTokenProperties.symbol, token.FungibleToken.approveFungibleToken, overrides).then((receipt) => {
                if (!silent) console.log(indent, "RECEIPT:", JSON.stringify(receipt));
            });
        });

        it("Approve - checkDuplication", function () {
            let overrides = {
                tokenFees: [
                    { action: FungibleTokenActions.transfer, feeName: "default" },
                    { action: FungibleTokenActions.transferOwnership, feeName: "default" },
                    { action: FungibleTokenActions.acceptOwnership, feeName: "default" }
                ],
                burnable
            };
            if (burnable) {
                overrides.tokenFees.push({
                    action: FungibleTokenActions.burn, feeName: "default"
                });
            }
            return performFungibleTokenStatus(fungibleTokenProperties.symbol, token.FungibleToken.approveFungibleToken, overrides).then((receipt) => {
                expect(receipt).is.not.exist;
            }).catch(error => {
                expect(error.code).to.equal(errors.NOT_ALLOWED);
            });
        });

        it("State", function () {
            return issuerFungibleToken.getState().then((state) => {
                if (!silent) console.log(indent, "STATE:", JSON.stringify(state));
            });
        });

        it("Balance - owner", function () {
            return issuerFungibleToken.getBalance().then((balance) => {
                if (!silent) console.log(indent, "Owner balance:", mxw.utils.formatUnits(balance, issuerFungibleToken.state.decimals));
                expect(balance.toString()).to.equal(issuerFungibleToken.state.totalSupply.toString());
            });
        });


        it("Mint - challenge to mint fix supply token", function () {
            let value = bigNumberify("2000");
            return fungibleToken.mint(issuer.address, value).then((receipt) => {
                expect(receipt).is.not.exist;
                console.log(receipt);
            }).catch(error => {

                expect(error.code).to.equal(errors.NOT_ALLOWED);
            });
        });
                        
        
        
        

        it("Transfer negative value", function () {
            return issuerFungibleToken.getBalance().then((balance) => {
                return issuerFungibleToken.getBalance().then((balance) => {
                return issuerFungibleToken.transfer(wallet.address, -10).then((receipt) => {
                    //to expect some error message response
                    expect(receipt.status).not.equal(0);        
                }).catch(error => {
                    expect(error.code).to.equal(UNEXPECTED_RESULT);
                });
            })

            });
        });

        it("Transfer special character", function () {
            return issuerFungibleToken.getBalance().then((balance) => {
                return issuerFungibleToken.getBalance().then((balance) => {
                return issuerFungibleToken.transfer(wallet.address, '#!@#!@#$%^^').then((receipt) => {
                    //to expect some error message response         
                    expect(receipt.status).not.equal(0);
                }).catch(error => {
                    expect(error.message).to.contains(INVALID_FORMAT);
                });
            })

            });
        });

        it("Transfer alphanumeric", function () {
            return issuerFungibleToken.getBalance().then((balance) => {
                return issuerFungibleToken.getBalance().then((balance) => {
                return issuerFungibleToken.transfer(wallet.address, 'abc123123123' ).then((receipt) => {
                    //to expect some error message response
                    expect(receipt.status).not.equal(0);
                    }).catch(error => {
                    expect(error.message).to.contains(INVALID_FORMAT);
                });
            })

            });
        });

        it("Transfer to invalid mxw wallet address", function () {
            return issuerFungibleToken.getBalance().then((balance) => {
                return issuerFungibleToken.getBalance().then((balance) => {
                return issuerFungibleToken.transfer('wxmjaksjfkasjfksjdfkjskdfjsas111dasd', 10).then((receipt) => {
                    //to expect some error message response1
                    expect(receipt.status).not.equal(0);
                    }).catch(error => {
                    expect(error.code).to.equal(errors.INVALID_ADDRESS);
                });
            })

            });
        });

        it("Transfer to another blockchain address", function () {
            return issuerFungibleToken.getBalance().then((balance) => {
                return issuerFungibleToken.getBalance().then((balance) => {
                return issuerFungibleToken.transfer("0xf25351F2a8Ea21ba1833E5587bb7815Ba1bd0900", 10).then((receipt) => {
                    //to expect some error message response1
                    
                    expect(receipt.status).not.equal(0);
                    }).catch(error => {
                    expect(error.code).to.equal(errors.UNEXPECTED_RESULT);
                });
            })

            });
        });

        it("Transfer", function () {
            return issuerFungibleToken.getBalance().then((balance) => {
                balance = balance.div(2);
            
                return wallet.provider.getTransactionFee("token", "token-transferFungibleToken", {
                    symbol: fungibleTokenProperties.symbol,
                    from: issuer.address,
                    to: wallet.address,
                    value: balance,
                    memo: "Hello blockchain"
                }).then((fee) => {
                    return issuerFungibleToken.transfer(wallet.address, balance, { fee }).then((receipt) => {
                        expect(receipt.status).to.equal(1);
                    }).then(() => {
                        // Check sender balance
                        return issuerFungibleToken.getBalance().then((newBalance) => {
                            expect(balance.toString()).to.equal(newBalance.toString());
                        });
                    }).then(() => {
                        // Check receiver balance
                        return fungibleToken.getBalance().then((newBalance) => {
                            expect(balance.toString()).to.equal(newBalance.toString());
                        });
                    });
                });
            });
        });


        it("Transfer - self transfer", function () {
            return issuerFungibleToken.getBalance().then((balance) => {
                return issuerFungibleToken.transfer(issuer.address, balance).then((receipt) => {
                    expect(receipt.status).to.equal(1);
                }).then(() => {
                    return issuerFungibleToken.getBalance().then((newBalance) => {
                        expect(balance.toString()).to.equal(newBalance.toString());
                    });
                });
            });
        });

        it("Burn" + (burnable ? "" : " - more than token supply"), function () {
            return issuerFungibleToken.getBalance().then((balance) => {
                //console.log(balance.toString());
                balance = balance.mul(2);
                return issuerFungibleToken.burn(balance).then((receipt) => {
                    if (!burnable) {
                        expect(receipt).is.not.exist;
                    }
                    else {
                        expect(receipt.status).to.equal(1);
                    }
                });
            }).catch(error => {
                //to expect some error message response
                if(!burnable){
                    expect(error.code).to.contains(errors.NOT_ALLOWED)
                }
                else{
                    expect(error.code).to.contains(errors.INSUFFICIENT_FUNDS)
                }
               
            });
        });

        it("Burn" + (burnable ? "" : " - test negative value"), function () {
            return issuerFungibleToken.getBalance().then((balance) => {
                    return issuerFungibleToken.burn(-10).then((receipt) => {
                    if (!burnable) {
                        expect(receipt).is.not.exist;
                    }
                    else {
                        expect(receipt.status).to.equal(1);
                    }
                });
            }).catch(error => {
                expect(error.code).to.oneOf([errors.NOT_ALLOWED, errors.UNEXPECTED_RESULT]);
            });
        });

        it("Burn" + (burnable ? "" : " - test alphanumeric value"), function () {
            return issuerFungibleToken.getBalance().then((balance) => {
                    return issuerFungibleToken.burn('abc123').then((receipt) => {
                    if (!burnable) {
                        expect(receipt).is.not.exist;
                    }
                    else {
                        expect(receipt.status).to.equal(1);
                    }
                });
            }).catch(error => {
                if (!burnable) {
                    expect(error.message).to.contains('not burnable');
                }
                else {
                    expect(error.message).to.contains(INVALID_FORMAT);                    
                }

            });
        });

        it("Burn" + (burnable ? "" : " - challenge non-burnable token"), function () {
            return issuerFungibleToken.getBalance().then((balance) => {
                return issuerFungibleToken.burn(balance).then((receipt) => {
                    if (!burnable) {
                        expect(receipt).is.not.exist;
                    }
                    else {
                        expect(receipt.status).to.equal(1);
                    }
                });
            }).catch(error => {
                expect(error.code).to.equal(errors.NOT_ALLOWED);
            });
        });

        it("Freeze", function () {
            return performFungibleTokenStatus(fungibleTokenProperties.symbol, token.FungibleToken.freezeFungibleToken).then((receipt) => {
                if (!silent) console.log(indent, "RECEIPT:", JSON.stringify(receipt));
            });
        });

        it("Freeze - checkDuplication", function () {
            return performFungibleTokenStatus(fungibleTokenProperties.symbol, token.FungibleToken.freezeFungibleToken).then((receipt) => {
                expect(receipt).is.not.exist;
            }).catch(error => {
                expect(error.code).to.equal(errors.NOT_ALLOWED);
            });
        });

        it("Transfer - challenge frozen token", function () {
            return fungibleToken.getBalance().then((balance) => {
                return fungibleToken.transfer(issuer.address, balance).then((receipt) => {
                    expect(receipt).is.not.exist;
                });
            }).catch(error => {
                expect(error.code).to.equal(errors.NOT_ALLOWED);
            });
        });

        it("Unfreeze", function () {
            return performFungibleTokenStatus(fungibleTokenProperties.symbol, token.FungibleToken.unfreezeFungibleToken).then((receipt) => {
                if (!silent) console.log(indent, "RECEIPT:", JSON.stringify(receipt));
            });
        });

        it("Unfreeze - checkDuplication", function () {
            return performFungibleTokenStatus(fungibleTokenProperties.symbol, token.FungibleToken.unfreezeFungibleToken).then((receipt) => {
                expect(receipt).is.not.exist;
            }).catch(error => {
                expect(error.code).to.equal(errors.NOT_ALLOWED);
            });
        });

        it("Transfer - after unfreeze token", function () {
            return fungibleToken.getBalance().then((balance) => {
                balance = balance.div(2);
                return fungibleToken.transfer(issuer.address, balance).then((receipt) => {
                    expect(receipt).to.exist;
                    if (!silent) console.log(indent, "RECEIPT:", JSON.stringify(receipt));
                    expect(receipt.status).to.equal(1);
                });
            });
        });

        it("Freeze Account", function () {
            return performFungibleTokenAccountStatus(fungibleTokenProperties.symbol, wallet.address, token.FungibleToken.freezeFungibleTokenAccount).then((receipt) => {
                if (!silent) console.log(indent, "RECEIPT:", JSON.stringify(receipt));
            });
        });

        it("Freeze Account - checkDuplication", function () {
            return performFungibleTokenAccountStatus(fungibleTokenProperties.symbol, wallet.address, token.FungibleToken.freezeFungibleTokenAccount).then((receipt) => {
                expect(receipt).is.not.exist;
            }).catch(error => {
                expect(error.code).to.equal(errors.NOT_ALLOWED);
            });
        });

        it("Transfer - challenge frozen account", function () {
            return fungibleToken.getBalance().then((balance) => {
                return fungibleToken.transfer(issuer.address, balance).then((receipt) => {
                    expect(receipt).is.not.exist;
                }).catch(error => {
                    expect(error.code).to.equal(errors.NOT_ALLOWED);
                });
            });
        });

        it("Unfreeze Account", function () {
            return performFungibleTokenAccountStatus(fungibleTokenProperties.symbol, wallet.address, token.FungibleToken.unfreezeFungibleTokenAccount).then((receipt) => {
                if (!silent) console.log(indent, "RECEIPT:", JSON.stringify(receipt));
            });
        });

        it("Unfreeze Account - checkDuplication", function () {
            return performFungibleTokenAccountStatus(fungibleTokenProperties.symbol, wallet.address, token.FungibleToken.unfreezeFungibleTokenAccount).then((receipt) => {
                expect(receipt).is.not.exist;
            }).catch(error => {
                expect(error.code).to.equal(errors.NOT_ALLOWED);
            });
        });


        it("Transfer - after unfreeze account", function () {
            return fungibleToken.getBalance().then((balance) => {
                balance = balance.div(2);
                return fungibleToken.transfer(issuer.address, balance).then((receipt) => {
                    if (!silent) console.log(indent, "RECEIPT:", JSON.stringify(receipt));
                    expect(receipt.status).to.equal(1);
                });
            });
        });



        it("Transfer ownership - non-owner", function () {
            return fungibleToken.transferOwnership(issuer.address).then((receipt) => {
                expect(receipt).is.not.exist;
                console.log("anything");
            }).catch(error => {
                expect(error.code).to.equal(errors.NOT_ALLOWED);
            });
        });

        it("Transfer ownership - to eth wallet", function () {
            return fungibleToken.transferOwnership('0xf25351F2a8Ea21ba1833E5587bb7815Ba1bd0900').then((receipt) => {
                expect(receipt).is.not.exist;
            }).catch(error => {            
                expect(error.code).to.equal(errors.UNEXPECTED_RESULT);
            });
        });

        it("Transfer ownership - to incomplete KYC account", function () {
            return fungibleToken.transferOwnership('mxw1x0cur63meevm42k7a9elauvh0sal0wl73zg6ca').then((receipt) => {
                expect(receipt).is.not.exist;
            }).catch(error => {
                expect(error.code).to.equal(errors.NOT_ALLOWED);
            });
        });

        it("Transfer ownership - to invalid mxw account", function () {
            return fungibleToken.transferOwnership('mxw1x3qhvpzl42s8fg8cqx5wjvwtjasvdryvtw4u05').then((receipt) => {
                expect(receipt).is.not.exist;
            }).catch(error => {
                expect(error.code).to.equal(errors.UNEXPECTED_RESULT);
            });
        });

        it("Transfer ownership", function () {
            return issuerFungibleToken.transferOwnership(wallet.address).then((receipt) => {
                if (!silent) console.log(indent, "RECEIPT:", JSON.stringify(receipt));
                expect(receipt.status).to.equal(1);
            });
        });

        it("Transfer ownership - checkDuplication", function () {
            return issuerFungibleToken.transferOwnership(wallet.address).then((receipt) => {
                expect(receipt).is.not.exist;
            }).catch(error => {
                expect(error.code).to.equal(errors.NOT_ALLOWED);
            });
        });

        it("Accept ownership - challenge non-approval", function () {
            return fungibleToken.acceptOwnership().then((receipt) => {
                expect(receipt).is.not.exist;
            }).catch(error => {
                expect(error.code).to.equal(errors.NOT_ALLOWED);
            });
        });

        it("Approve transfer ownership", function () {
            return performFungibleTokenStatus(fungibleTokenProperties.symbol, token.FungibleToken.approveFungibleTokenOwnership).then((receipt) => {
                if (!silent) console.log(indent, "RECEIPT:", JSON.stringify(receipt));
            });
        });

        it("Approve transfer ownership - checkDuplication", function () {
            return performFungibleTokenStatus(fungibleTokenProperties.symbol, token.FungibleToken.approveFungibleTokenOwnership).then((receipt) => {
                expect(receipt).is.not.exist;
            }).catch(error => {
                expect(error.code).to.equal(errors.EXISTS);
            });
        });

        it("Accept ownership - challenge non owner", function () {
            return issuerFungibleToken.acceptOwnership().then((receipt) => {
                expect(receipt).is.not.exist;
            }).catch(error => {
                expect(error.code).to.equal(errors.NOT_ALLOWED);
            });
        });

        it("Accept ownership", function () {
            return fungibleToken.acceptOwnership().then((receipt) => {
                if (!silent) console.log(indent, "RECEIPT:", JSON.stringify(receipt));
                expect(receipt.status).to.equal(1);
            });
        });

        it("Accept ownership - checkDuplication", function () {
            return fungibleToken.acceptOwnership().then((receipt) => {
                expect(receipt).is.not.exist;
            }).catch(error => {
                expect(error.code).to.equal(errors.NOT_ALLOWED);
            });
        });

        it("State", function () {
            return issuerFungibleToken.getState().then((state) => {
                if (!silent) console.log(indent, "STATE:", JSON.stringify(state));
            });
        });



    });
});

function performFungibleTokenStatus(symbol: string, perform: any, overrides?: any) {
    return perform(symbol, provider, overrides).then((transaction) => {
        return token.FungibleToken.signFungibleTokenStatusTransaction(transaction, issuer);
    }).then((transaction) => {
        return token.FungibleToken.sendFungibleTokenStatusTransaction(transaction, middleware).then((receipt) => {
            expect(receipt.status).to.equal(1);

            if (overrides && overrides.notRefresh) {
                return receipt;
            }
            return refresh(symbol).then(() => {
                return receipt;
            });
        });
    });
}

function performFungibleTokenAccountStatus(symbol: string, target: string, perform: any, overrides?: any) {
    return perform(symbol, target, provider, overrides).then((transaction) => {
        return token.FungibleToken.signFungibleTokenAccountStatusTransaction(transaction, issuer);
    }).then((transaction) => {
        return token.FungibleToken.sendFungibleTokenAccountStatusTransaction(transaction, middleware).then((receipt) => {
            expect(receipt.status).to.equal(1);
            return refresh(symbol).then(() => {
                return receipt;
            });
        });
    });
}

function refresh(symbol: string) {
    return token.FungibleToken.fromSymbol(symbol, wallet).then((token) => {
        expect(token).to.exist;
        fungibleToken = token;
        if (!silent) console.log(indent, "STATE:", JSON.stringify(fungibleToken.state));
    }).then(() => {
        return token.FungibleToken.fromSymbol(symbol, issuer).then((token) => {
            expect(token).to.exist;
            issuerFungibleToken = token;
        });
    });
}