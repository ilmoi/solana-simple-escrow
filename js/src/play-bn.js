// const BN = require('bn.js');
//
// let a = new BN("11");
// let b = new BN("10");
//
// console.log(a.add(b).toString());

const BigNumber = require('bignumber.js')

// let x = new BigNumber(123.123);
// let y = new BigNumber(1);
// console.log(x.plus(y).toString());

// let x = Number.MAX_SAFE_INTEGER;
// let y = x+1;
// let z = x+2;
// console.log(y===z); //true

let x = new BigNumber(Number.MAX_SAFE_INTEGER);
let y = x.plus(1);
let z = x.plus(2);
console.log(y.isEqualTo(z)); //false