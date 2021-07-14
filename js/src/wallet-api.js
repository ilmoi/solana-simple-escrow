/*
For some reason, as soon as I import stuff from sol-api.js
or try to run stuff inside sol-api.js which requires the sol-wallet-adapter lib
I start getting errors along the line of "X is not a function" or "X is not a constructor"
So fucking weird
 */
import {Connection, PublicKey, sendAndConfirmRawTransaction, Transaction, TransactionInstruction} from '@solana/web3.js';
import Wallet from "@project-serum/sol-wallet-adapter";
import {TOKEN_PROGRAM_ID} from "@solana/spl-token";
import BN from 'bn.js';

async function connectWallet() {
  let providerUrl = 'https://www.sollet.io';
  let wallet = new Wallet(providerUrl, 'localhost');
  wallet.on('connect', publicKey => console.log('Connected to ' + publicKey.toBase58()));
  wallet.on('disconnect', () => console.log('Disconnected'));
  await wallet.connect();
  return wallet
}

// ----------------------------------------------------------------------------- take trade

async function takeTradeSigned(
  takerXTokenAccountPubkeyString,
  takerYTokenAccountPubkeyString,
  tempXTokenAccountPubkeyString,
  initializerMainPubkeyString,
  initializerYTokenAccountPubkeyString,
  takerExpectedXAmount,
  escrowAccountPubkeyString,
  escrowProgramIdString,
) {
  const CONNECTION = new Connection('http://localhost:8899', 'confirmed');

  const takerAccount = await connectWallet(); //now comes from the wallet, not the priv key

  const takerXTokenPubKey = new PublicKey(takerXTokenAccountPubkeyString);
  const takerYTokenPubKey = new PublicKey(takerYTokenAccountPubkeyString);

  const tempXTokenPubKey = new PublicKey(tempXTokenAccountPubkeyString);
  const initializerMainPubkey = new PublicKey(initializerMainPubkeyString);
  const initializerYTokenPubkey = new PublicKey(initializerYTokenAccountPubkeyString);

  const escrowAccount = new PublicKey(escrowAccountPubkeyString);
  const programId = new PublicKey(escrowProgramIdString);
  const pdaAccount = await PublicKey.findProgramAddress([Buffer.from("escrow")], programId);

  const takeTradeIx = new TransactionInstruction({
    programId,
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

  // prep tx
  const tx = new Transaction().add(takeTradeIx)
  let {blockhash} = await CONNECTION.getRecentBlockhash();
  tx.recentBlockhash = blockhash;
  tx.feePayer = takerAccount.publicKey;
  const signed = await takerAccount.signTransaction(tx);
  console.log(tx)

  let txHash = await sendAndConfirmRawTransaction(CONNECTION, signed.serialize());
  console.log(txHash);
}

export {connectWallet, takeTradeSigned}