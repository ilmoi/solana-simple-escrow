const path = require('path');
const os = require('os');
const fs = require('mz/fs');
const yaml = require('yaml');
const borsh = require('borsh');
const BN = require('bn.js');

const {
  TOKEN_PROGRAM_ID,
  AccountLayout,
  Token,
} = require("@solana/spl-token");

const {
  Account,
  Keypair,
  Connection,
  PublicKey,
  LAMPORTS_PER_SOL,
  SYSVAR_RENT_PUBKEY,
  SystemProgram,
  TransactionInstruction,
  Transaction,
  sendAndConfirmTransaction,
} = require('@solana/web3.js');

// ----------------------------------------------------------------------------- constants & globals

let CONNECTION;

// ----------------------------------------------------------------------------- basics

async function connect() {
  const rpcUrl = 'http://localhost:8899';
  //nice, we can specify the level of committment we want from the network on tx confirmation - https://solana-labs.github.io/solana-web3.js/modules.html#commitment
  CONNECTION = new Connection(rpcUrl, 'confirmed');
  console.log('1) CONNECTED:', await CONNECTION.getVersion());
  return CONNECTION
}

//tokenAccount = base58 encoded string
async function getTokenBalance(tokenAccount) {
  let pk = new PublicKey(tokenAccount)
  return CONNECTION.getTokenAccountBalance(pk, 'confirmed');
}

//tokenAccount = base58 encoded string
async function getBalance(tokenAccount) {
  let pk = new PublicKey(tokenAccount)
  return CONNECTION.getBalance(pk, 'confirmed');
}

// ----------------------------------------------------------------------------- escrow acc

//lhs names can be anything we want - but rhs have to exactly match names given in rust, or will deserialize as "undefined"
class EscrowAccount {
  // the reason you need these fields here is so that you're able to calc ESCROW_ACC_SIZE. For serialization, in other words.
  // they won't have any impact on deserialization, as deserialization overwrites them.
  is_initialized = 1;
  initializer_pubkey = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
  temp_token_account_pubkey = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
  initializer_token_to_receive_account_pubkey = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
  expected_amount = 0;

  constructor(fields) {
    if (fields) {
      this.is_initialized = fields.is_initialized;
      this.initializer_pubkey = fields.initializer_pubkey;
      this.temp_token_account_pubkey = fields.temp_token_account_pubkey;
      this.initializer_token_to_receive_account_pubkey = fields.initializer_token_to_receive_account_pubkey;
      this.expected_amount = fields.expected_amount;
    }
  }
}

const EscrowSchema = new Map([
  [EscrowAccount, {
    kind: 'struct',
    fields: [
      ['is_initialized', 'u8'], //important: borsh doesn't have the concept of a boolean, so use a u8
      ['initializer_pubkey', [32]], //important: Pubkey in rust = array of 32 u8 bytes here. NOT string.
      ['temp_token_account_pubkey', [32]],
      ['initializer_token_to_receive_account_pubkey', [32]],
      ['expected_amount', 'u64'],
    ]
  }]
]);

const ESCROW_ACC_SIZE = borsh.serialize(
  EscrowSchema,
  new EscrowAccount(),
).length;

//escrowAccount = base58 encoded string
async function getEscrowInfo(escrow_account) {
  let pk = new PublicKey(escrow_account);
  //{data: Uint8Array(137008), executable: true, lamports: 954466560, owner: PublicKey, rentEpoch: 0}
  const programInfo = await CONNECTION.getAccountInfo(pk);
  // console.log(programInfo)

  const deserEscrow = borsh.deserialize(
    EscrowSchema,
    EscrowAccount,
    programInfo.data,
  )
  // console.log(deserEscrow);
  return deserEscrow;
}

// ----------------------------------------------------------------------------- init escrow

async function initEscrow(
  privateKeyByteArray,
  initializerXTokenAccountPubkeyString,
  initializerYTokenAccountPubkeyString,
  XTokenAmount,
  expectedAmount,
  escrowProgramIdString,
) {
  // 1. create empty account owned by token program
  const privateKeyDecoded = privateKeyByteArray.split(',').map(s => parseInt(s));
  const initializerAccount = new Account(privateKeyDecoded);

  // in js Account has a double meaning - it's also the object to hold a keypair
  const tempTokenAccount = new Account();
  const createTempTokenAccountIx = SystemProgram.createAccount({
    programId: TOKEN_PROGRAM_ID,
    fromPubkey: initializerAccount.publicKey,
    newAccountPubkey: tempTokenAccount.publicKey,
    space: AccountLayout.span,
    lamports: await CONNECTION.getMinimumBalanceForRentExemption(AccountLayout.span),
  })

  // 2. initialize empty account as Alice's X token account
  const initializerXTokenAccountPubkey = new PublicKey(initializerXTokenAccountPubkeyString);
  const initializerXtokenACcountInfo = await CONNECTION.getParsedAccountInfo(initializerXTokenAccountPubkey);
  // console.log(initializerXtokenACcountInfo.value.data.parsed);
  // interesting, so mint address is burried inside of any token address we use on Solana?
  const XTokenMintAccountPubkey = new PublicKey(initializerXtokenACcountInfo.value.data.parsed.info.mint)

  const initTempTokenAccountIx = Token.createInitAccountInstruction(
    TOKEN_PROGRAM_ID,
    XTokenMintAccountPubkey,
    tempTokenAccount.publicKey,
    initializerAccount.publicKey,
  )

  // 3. transfer X tokens from Alice's main X token account to her temporary X token account
  const transferXTokensToTempAccountIx = Token.createTransferInstruction(
    TOKEN_PROGRAM_ID,
    initializerXTokenAccountPubkey,
    tempTokenAccount.publicKey,
    initializerAccount.publicKey,
    [], //apparently has to be empty - chase's example also shows as empty https://stackoverflow.com/questions/68236211/how-to-transfer-custom-token-by-solana-web3-js
    XTokenAmount,
  )

  // 4. create empty account owned by escrow program
  const escrowProgramId = new PublicKey(escrowProgramIdString);
  const escrowAccount = new Account();
  const createEscrowAccountIx = SystemProgram.createAccount({
    programId: escrowProgramId,
    fromPubkey: initializerAccount.publicKey,
    newAccountPubkey: escrowAccount.publicKey,
    space: ESCROW_ACC_SIZE,
    lamports: await CONNECTION.getMinimumBalanceForRentExemption(ESCROW_ACC_SIZE),
  });

  // 5. initialize empty account as escrow state and transfer temporary X token account ownership to PDA
  const initializerYTokenAccountPubkey = new PublicKey(initializerYTokenAccountPubkeyString);
  const InitEscrowIx = new TransactionInstruction({
    programId: escrowProgramId,
    keys: [
      {pubkey: initializerAccount.publicKey, isSigner: true, isWritable: false},
      {pubkey: tempTokenAccount.publicKey, isSigner: false, isWritable: true},
      {pubkey: initializerYTokenAccountPubkey, isSigner: false, isWritable: false},
      {pubkey: escrowAccount.publicKey, isSigner: false, isWritable: true},
      {pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false},
      {pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false},
    ],

    // we specify what will arrive as instruction data
    // 0 first so that InitEscrow is matched in rust
    // we use bn.js library to write our expected amount as a 8-byte array of little endian numbers
    // - 8-byte because we use u64, which is the designation of token's max supply
    // - little endian because in rust we do u64::from_le_bytes
    data: Buffer.from(Uint8Array.of(0, ...new BN(expectedAmount).toArray("le", 8)))
  })

  // 6. package and send the actual tx
  const tx = new Transaction().add(
    createTempTokenAccountIx,
    initTempTokenAccountIx,
    transferXTokensToTempAccountIx,
    createEscrowAccountIx,
    InitEscrowIx,
  );
  // signers:
  // - include alice because she needs to authorize the tranfer
  // - include the other 2 because in solana when a new account is created using SystemProgram.createAccount(), that new account needs to sign that tx
  let txHash = await sendAndConfirmTransaction(CONNECTION, tx, [initializerAccount, tempTokenAccount, escrowAccount]);
  console.log(txHash);

  console.log(escrowAccount.publicKey.toBase58())
  return escrowAccount.publicKey.toBase58();
}

// ----------------------------------------------------------------------------- take trade

//If he sends the expected amount of Y tokens to the escrow, the escrow will send him Alice's X tokens and Alice his Y tokens.
async function takeTrade(
  privateKeyByteArray,
  takerXTokenAccountPubkeyString,
  takerYTokenAccountPubkeyString,
  tempXTokenAccountPubkeyString,
  initializerMainPubkeyString,
  initializerYTokenAccountPubkeyString,
  takerExpectedXAmount,
  escrowAccountPubkeyString,
  escrowProgamIdString,
) {
  const privateKeyDecoded = privateKeyByteArray.split(',').map(s => parseInt(s));
  const takerAccount = new Account(privateKeyDecoded);

  const takerXTokenPubKey = new PublicKey(takerXTokenAccountPubkeyString);
  const takerYTokenPubKey = new PublicKey(takerYTokenAccountPubkeyString);

  const tempXTokenPubKey = new PublicKey(tempXTokenAccountPubkeyString);
  const initializerMainPubkey = new PublicKey(initializerMainPubkeyString);
  const initializerYTokenPubkey = new PublicKey(initializerYTokenAccountPubkeyString);

  const escrowAccount = new PublicKey(escrowAccountPubkeyString);
  const programId = new PublicKey(escrowProgamIdString);
  const pdaAccount = await PublicKey.findProgramAddress([Buffer.from("escrow")], programId);

  const takeTradeIx = new TransactionInstruction({
    programId, //escrow program id - what's interesting is that when we "build" a tx we don't actually send it to one place - instead this acts as a guide as to which program should execute which instruction
    keys: [
      // 0. `[signer]` The account of the person taking the trade
      {pubkey: takerAccount.publicKey, isSigner: true, isWritable: false},
      // 1. `[writable]` The taker's token account for the token they send (Y)
      {pubkey: takerYTokenPubKey, isSigner: false, isWritable: true},
      // 2. `[writable]` The taker's token account for the token they will receive should the trade go through (X)
      {pubkey: takerXTokenPubKey, isSigner: false, isWritable: true},
      // 3. `[writable]` The PDA's temp token account to get tokens from and eventually close
      {pubkey: tempXTokenPubKey, isSigner: false, isWritable: true},
      // 4. `[writable]` The initializer's main account to send their rent fees to
      {pubkey: initializerMainPubkey, isSigner: false, isWritable: true},
      // 5. `[writable]` The initializer's token account that will receive tokens (Y)
      {pubkey: initializerYTokenPubkey, isSigner: false, isWritable: true},
      // 6. `[writable]` The escrow account holding the escrow info
      {pubkey: escrowAccount, isSigner: false, isWritable: true},
      // 7. `[]` The token program
      {pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false},
      // 8. `[]` The PDA account
      {pubkey: pdaAccount[0], isSigner: false, isWritable: false},
    ],
    data: Buffer.from(Uint8Array.of(1, ...new BN(takerExpectedXAmount).toArray("le", 8)))
  })

  const tx = new Transaction().add(takeTradeIx)
  let txHash = await sendAndConfirmTransaction(CONNECTION, tx, [takerAccount]);
  console.log(txHash);
}

// ----------------------------------------------------------------------------- cancel escrow

async function cancelEscrow(
  privateKeyByteArray,
  tempXAccString,
  initializerXAccString,
  escrowAccString,
  programIdString,
) {
  // initializer
  const privateKeyDecoded = privateKeyByteArray.split(',').map(s => parseInt(s));
  const initializerAccount = new Account(privateKeyDecoded);

  // existing accounts
  const tempXAcc = new PublicKey(tempXAccString);
  const initializerXAcc = new PublicKey(initializerXAccString);
  const escrowAcc = new PublicKey(escrowAccString);

  //program id
  const programId = new PublicKey(programIdString);

  // pda
  const seeds = [Buffer.from("escrow")];
  const pdaAccount = await PublicKey.findProgramAddress(seeds, programId);
  const bumpSeed = pdaAccount[1];

  // const seedsWithNonce = seeds.concat(Buffer.from([nonce]));
  // console.log(pdaAccount);
  // console.log(seedsWithNonce);
  // let finalBuffer = Uint8Array.of(2, ...seedsWithNonce[0], ...seedsWithNonce[1]);

  let finalBuffer = Uint8Array.of(2, bumpSeed);
  console.log(finalBuffer);

  const cancelEscrowIx = new TransactionInstruction({
    programId,
    keys: [
      /// 0 [signer] initializer's main account
      {pubkey: initializerAccount.publicKey, isSigner: true, isWritable: false},
      /// 1 [] token program account
      {pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false},
      /// 2 [writable] temp x account
      {pubkey: tempXAcc, isSigner: false, isWritable: true},
      /// 3 [writable] initializer's x account (writable coz we'll update their balance with new coins)
      {pubkey: initializerXAcc, isSigner: false, isWritable: true},
      /// 4 [writable] escrow account
      {pubkey: escrowAcc, isSigner: false, isWritable: true},
      /// 5 [] pda acc
      {pubkey: pdaAccount[0], isSigner: false, isWritable: false},
    ],
    data: Buffer.from(finalBuffer)
    // data: Buffer.from(Uint8Array.of(1, ...new BN(123).toArray("le", 8)))
  })

  const tx = new Transaction().add(cancelEscrowIx);
  const txHash = await sendAndConfirmTransaction(CONNECTION, tx, [initializerAccount])
  console.log(txHash);
}


// ----------------------------------------------------------------------------- derived addresses

async function getTokenAccount(
  ownerPublicKeyString,
  mintPublicKeyString,
) {
  const ownerPublicKey = new PublicKey(ownerPublicKeyString);
  const mintPublicKey = new PublicKey(mintPublicKeyString);
  const filter = { mint: mintPublicKey};

  let x = await CONNECTION.getTokenAccountsByOwner(
    ownerPublicKey,
    filter,
    )

  //todo in theory I should roll up but I'm just going to take the first one
  console.log(x);
  return x.value[0].pubkey.toBase58()
}

// ----------------------------------------------------------------------------- helpers

// async function getConfig() {
//   // Path to Solana CLI config file
//   const CONFIG_FILE_PATH = path.resolve(
//     os.homedir(),
//     '.config',
//     'solana',
//     'cli',
//     'config.yml',
//   );
//   const configYml = await fs.readFile(CONFIG_FILE_PATH, {encoding: 'utf8'});
//   return yaml.parse(configYml);
// }
//
// async function createKeypairFromFile(filePath) {
//   const secretKeyString = await fs.readFile(filePath, {encoding: 'utf8'});
//   const secretKey = Uint8Array.from(JSON.parse(secretKeyString));
//   return Keypair.fromSecretKey(secretKey);
// }


// ----------------------------------------------------------------------------- exports

module.exports = {
  CONNECTION, connect, getTokenBalance, getBalance, getEscrowInfo,
  initEscrow, takeTrade, cancelEscrow, getTokenAccount
}

// ----------------------------------------------------------------------------- play
// connect();
// getEscrowInfo("Fqt59CYejnQGaCgHTP79LvKdXYf91JNXXX99vK7SkrE5");
// initEscrow(
//   "201,101,147,128,138,189,70,190,202,49,28,26,32,21,104,185,191,41,20,171,3,144,4,26,169,73,180,171,71,22,48,135,231,91,179,215,3,117,187,183,96,74,154,155,197,243,114,104,20,123,105,47,181,123,171,133,73,181,102,41,236,78,210,176",
//   "BTUDi8DcxQzXp1KQ5p95dkuBgTtqirDxySZrXbM6nHPk",
//   "pLBauX3VV2QWJsnakYdAjHh193EuhZc6UMpdYT5DsCK",
//   10,
//   10,
//   "5B7bxDnoCG9PvCnSHLN65KvTy1BsUX4oxDmaQpjBPSG",
//   );
//
// takeTrade();


