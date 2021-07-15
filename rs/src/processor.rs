use solana_program::{
    account_info::{next_account_info, AccountInfo},
    entrypoint::ProgramResult,
    msg,
    program::{invoke, invoke_signed},
    program_error::ProgramError,
    program_pack::{IsInitialized, Pack},
    pubkey::Pubkey,
    sysvar::{rent::Rent, Sysvar},
};

use spl_token::state::Account as TokenAccount;

use crate::state::Escrow;
use crate::{error::EscrowError, instruction::EscrowInstruction};
use solana_program::log::sol_log_compute_units;

pub struct Processor;

impl Processor {
    pub fn process(
        program_id: &Pubkey,
        accounts: &[AccountInfo],
        instruction_data: &[u8],
    ) -> ProgramResult {
        // remember it's looking for the 0 byte to kick of the program (InitEscrow)
        let instruction = EscrowInstruction::unpack(instruction_data)?;

        match instruction {
            EscrowInstruction::InitEscrow { amount } => {
                msg!("Instruction: InitEscrow"); // this is how you do logging in solana! cool!
                Self::process_init_escrow(accounts, amount, program_id)
            }
            EscrowInstruction::Exchange { amount } => {
                msg!("Instruction: Exchange");
                Self::process_exchange(accounts, amount, program_id)
            }
            EscrowInstruction::Cancel { bump_seed } => {
                msg!("Instruction: Cancel");
                Self::cancel_exchange(accounts, bump_seed, program_id)
            }
        }
    }

    fn process_init_escrow(
        accounts: &[AccountInfo],
        amount: u64,
        program_id: &Pubkey,
    ) -> ProgramResult {
        // ----------------------------------------------------------------------------- get the accs
        //turn accounts into an iterator
        let account_info_iter = &mut accounts.iter();

        // [0] first account = signer, Alice. This is by convention
        let initializer = next_account_info(account_info_iter)?;

        //if it's not a signer, error out
        if !initializer.is_signer {
            return Err(ProgramError::MissingRequiredSignature);
        }

        // [1] next = temp account where X will be deposited
        // needs to be writable, but no need to check - tx will fail if not writable
        // needs to be owned by the token program as we're going to be transfering to a PDA, but again no need to check for the same reason
        let temp_token_account = next_account_info(account_info_iter)?;

        // [2] next = receiver for the Y token for alice
        let token_to_receive_account = next_account_info(account_info_iter)?;
        if *token_to_receive_account.owner != spl_token::id() {
            return Err(ProgramError::IncorrectProgramId);
        }

        // [3] next = escrow = the acc that holds the escrow state
        let escrow_account = next_account_info(account_info_iter)?;

        // ----------------------------------------------------------------------------- rent
        // we are checking that the escrow account has enough balance to be exempt from rent

        // [4] here we're getting the rent sysvar from a separate account. After 1.6.4 this is no longer necessary
        // both of the below calls return this: Rent { lamports_per_byte_year: 3480, exemption_threshold: 2.0, burn_percent: 50 }
        let _manual_rent = &Rent::from_account_info(next_account_info(account_info_iter)?)?;
        let rent = &Rent::get()?;

        // msg!("rent old, new: {:?}, {:?}", rent, rent_new);

        // make sure enough balance in the [3] ESCROW account to be exempt from rent
        if !rent.is_exempt(escrow_account.lamports(), escrow_account.data_len()) {
            return Err(EscrowError::NotRentExempt.into());
        }

        // ----------------------------------------------------------------------------- data
        // modify data on escrow

        //unpack existing escrow state from bytes
        let mut escrow_info = Escrow::unpack_unchecked(&escrow_account.data.borrow())?;
        if escrow_info.is_initialized() {
            return Err(ProgramError::AccountAlreadyInitialized);
        }

        // modify it with the data that came in through the transaction
        escrow_info.is_initialized = true;
        escrow_info.initializer_pubkey = *initializer.key;
        escrow_info.temp_token_account_pubkey = *temp_token_account.key; //alice's X account
        escrow_info.initializer_token_to_receive_account_pubkey = *token_to_receive_account.key; //alice's Y account
        escrow_info.expected_amount = amount;

        //now pack back into bytes. Note we're taking a mutable reference so it's in place.
        Escrow::pack(escrow_info, &mut escrow_account.data.borrow_mut())?;

        // ----------------------------------------------------------------------------- pda
        // we're going to assign ownership of the temp account to a PDA
        // 1) get the pda

        // We just need 1 PDA that can own N temporary token accounts for different escrows occuring at any and possibly the same point in time.
        let (pda, _bump_seed) = Pubkey::find_program_address(&[b"escrow"], program_id);

        // ----------------------------------------------------------------------------- cross-program invocation (CPI)
        // 2) do the cross program call (done using invoke / invoke_signed)

        // [5] next - get token_program account
        // in theory we'd need to check that token_program is truly the account we're expecting it to be, but spl-token below does it for us already
        let token_program = next_account_info(account_info_iter)?;

        // build the instruction.
        // set_authority = helper function that allows us to use a builder pattern to create an ix that we'll pass on later
        // https://docs.rs/spl-token/3.1.1/spl_token/instruction/fn.set_authority.html
        let owner_change_ix = spl_token::instruction::set_authority(
            token_program.key,      // this is the id of the token_program
            temp_token_account.key, //this is the account whose authority we'd like to change
            Some(&pda),             // the account's new authority
            spl_token::instruction::AuthorityType::AccountOwner, // the type of authority change (diff types exist)
            initializer.key, // the current account owner's pubkey
            // (!) this is key - When including a signed account in a program call, in all CPIs including that account made by that program inside the current instruction, the account will also be signed, i.e. the signature is extended to the CPIs.
            // basically because alice signed InitEscrow tx, the program can now include her signature in this CPI call
            &[&initializer.key], // the public keys signing the CPI
        )?;

        msg!("Calling the token program to transfer token account ownership...");

        // finally do the invoke call
        invoke(
            // below we pass 2 things: 1) the instruction we just built and 2) the relevant accounts
            &owner_change_ix,
            &[
                temp_token_account.clone(), //temporary account
                initializer.clone(),        // the signer's account
                token_program.clone(), // It's a rule that the program being called through a CPI must be included as an account in the 2nd argument of invoke
            ],
        )?;
        Ok(())
    }

    fn process_exchange(
        accounts: &[AccountInfo],
        amount_expected_by_taker: u64,
        program_id: &Pubkey,
    ) -> ProgramResult {
        // ----------------------------------------------------------------------------- get all the accounts

        let account_info_iter = &mut accounts.iter();

        // 0. `[signer]` The account of the person taking the trade
        let taker_main_acc = next_account_info(account_info_iter)?;
        if !taker_main_acc.is_signer {
            return Err(ProgramError::MissingRequiredSignature);
        }

        // 1. `[writable]` The taker's token account for the token they send (Y)
        let taker_y_acc = next_account_info(account_info_iter)?;

        // 2. `[writable]` The taker's token account for the token they will receive should the trade go through (X)
        let taker_x_acc = next_account_info(account_info_iter)?;

        // 3. `[writable]` The PDA's temp token account to get tokens from and eventually close
        let pda_temp_x_acc = next_account_info(account_info_iter)?;
        let pda_temp_x_info = TokenAccount::unpack(&pda_temp_x_acc.data.borrow())?;

        // 4. `[writable]` The initializer's main account to send their rent fees to
        let initializer_main_acc = next_account_info(account_info_iter)?;

        // 5. `[writable]` The initializer's token account that will receive tokens (Y)
        let initializer_y_acc = next_account_info(account_info_iter)?;

        // 6. `[writable]` The escrow account holding the escrow info
        let escrow_acc = next_account_info(account_info_iter)?;
        let escrow_info = Escrow::unpack(&escrow_acc.data.borrow())?;
        // check that the passed temp account matches what's saved in escrow state
        if escrow_info.temp_token_account_pubkey != *pda_temp_x_acc.key {
            return Err(ProgramError::InvalidAccountData);
        }
        // check that the passed initializer account matches what's saved in escrow state
        if escrow_info.initializer_pubkey != *initializer_main_acc.key {
            return Err(ProgramError::InvalidAccountData);
        }
        // check that the passed Y token account matches what's saved in escrow state
        if escrow_info.initializer_token_to_receive_account_pubkey != *initializer_y_acc.key {
            return Err(ProgramError::InvalidAccountData);
        }

        // 7. `[]` The token program
        let token_program_acc = next_account_info(account_info_iter)?;

        // 8. `[]` The PDA account
        let pda_acc = next_account_info(account_info_iter)?;

        // ------------------------------------------------------------------------------ do quant checks

        let (pda, bump_seed) = Pubkey::find_program_address(&[b"escrow"], program_id);

        if amount_expected_by_taker != pda_temp_x_info.amount {
            return Err(EscrowError::ExpectedAmountMismatch.into());
        }

        // ----------------------------------------------------------------------------- move Y from bob to alice

        let transfer_to_initializer_ix = spl_token::instruction::transfer(
            token_program_acc.key,
            taker_y_acc.key,
            initializer_y_acc.key,
            taker_main_acc.key,
            &[&taker_main_acc.key],
            escrow_info.expected_amount,
        )?;

        msg!("Calling the token program to transfer tokens to the escrow's initializer...");

        // use signature extension to make the token transfer to Alice's Y token account on Bob's behalf.
        invoke(
            &transfer_to_initializer_ix,
            &[
                taker_y_acc.clone(),
                initializer_y_acc.clone(),
                taker_main_acc.clone(),
                token_program_acc.clone(),
            ],
        )?;

        // ----------------------------------------------------------------------------- move X from alice to bob

        let transfer_to_taker_ix = spl_token::instruction::transfer(
            token_program_acc.key, //always first
            pda_temp_x_acc.key,
            taker_x_acc.key,
            &pda,
            &[&pda],
            pda_temp_x_info.amount,
        )?;

        msg!("Calling the token program to transfer tokens to the taker...");

        // note we're using invoke_signed here because we're signing with a pda
        // because the pda doesn't actually have a private key associatd with it (its off the curve)
        // we instead pass its seed, which is used as proof
        // no other program can fake this PDA because it requires 2 things: 1) the seed and 2) the program id of the parent
        // - the seed we pass now
        // - the program id is naturally coming from the escrow program
        invoke_signed(
            &transfer_to_taker_ix,
            &[
                //the order DOES NOT MATTER
                pda_temp_x_acc.clone(),
                taker_x_acc.clone(),
                pda_acc.clone(), //has to be passed into the instruction to prevent preimage attacks
                token_program_acc.clone(),
            ],
            &[&[&b"escrow"[..], &[bump_seed]]],
        )?;

        // ----------------------------------------------------------------------------- clean up

        // rm [3 ]temp X acc
        // rm [6] escrow acc

        // we close the account by transferring its "rent-exempt" balance out of it
        let close_pdas_temp_acc_ix = spl_token::instruction::close_account(
            token_program_acc.key,
            pda_temp_x_acc.key,       //from temp account
            initializer_main_acc.key, //to initializer main account
            &pda,
            &[&pda],
        )?;

        msg!("Calling the token program to close pda's temp account...");

        // same story as above - since we're moving out of a PDA account, we use invoke_signed
        invoke_signed(
            &close_pdas_temp_acc_ix,
            &[
                pda_temp_x_acc.clone(),
                initializer_main_acc.clone(),
                pda_acc.clone(),
                token_program_acc.clone(),
            ],
            &[&[&b"escrow"[..], &[bump_seed]]],
        )?;

        msg!("Closing the escrow account...");

        **initializer_main_acc.lamports.borrow_mut() = initializer_main_acc
            .lamports()
            .checked_add(escrow_acc.lamports())
            .ok_or(EscrowError::AmountOverflow)?; //add the balance to initializer's acc

        **escrow_acc.lamports.borrow_mut() = 0; //empty the balance
        *escrow_acc.data.borrow_mut() = &mut []; //AND zero out its data

        Ok(())
    }

    fn cancel_exchange(
        accounts: &[AccountInfo],
        bump_seed: u8,
        _program_id: &Pubkey,
    ) -> ProgramResult {
        // ----------------------------------------------------------------------------- get accs
        let accounts_info_iter = &mut accounts.iter();

        let initializer_main_acc = next_account_info(accounts_info_iter)?;
        let token_program_acc = next_account_info(accounts_info_iter)?;
        let temp_x_acc = next_account_info(accounts_info_iter)?;
        let initializer_x_acc = next_account_info(accounts_info_iter)?;
        let escrow_acc = next_account_info(accounts_info_iter)?;
        let pda_acc = next_account_info(accounts_info_iter)?;

        // ----------------------------------------------------------------------------- checks
        // deserialize the escrow account
        let escrow_info = Escrow::unpack(&escrow_acc.data.borrow())?;

        // check that the sender is indeed the initializer who created the escrow
        if escrow_info.initializer_pubkey != *initializer_main_acc.key {
            return Err(ProgramError::InvalidAccountData);
        }

        // check that initializer is listed as signer
        if !initializer_main_acc.is_signer {
            return Err(ProgramError::MissingRequiredSignature);
        }

        // check that temp_x_acc is what we're expecting
        if escrow_info.temp_token_account_pubkey != *temp_x_acc.key {
            return Err(ProgramError::InvalidAccountData);
        }

        // ----------------------------------------------------------------------------- pda

        // APPROACH 1: FROM TUTORIAL - works
        // let (pda, bump_seed) = Pubkey::find_program_address(&[b"escrow"], program_id);
        // Program log: pda and seed are: 2CVTH6qZCuYWyCPigStv7rTPfaCW9FTmFtzTfq3u8LBU, 254
        // msg!("pda and seed are: {}, {}", pda, bump_seed);

        // APPROACH 2a: PASS IN SEED DIRECTLY TO SAVE COMPUTATION - works
        // Program log: passed pda pk is 2CVTH6qZCuYWyCPigStv7rTPfaCW9FTmFtzTfq3u8LBU
        // msg!("passed pda pk is {}", pda_acc.key);
        let pda = *pda_acc.key;

        // APPROACH 2b: PASS IN SEED + DERIVE ADDR - didn't work
        // Program log: pda2 + seed 3XgMWSze8cTg71hCBcErGgfndnf9KFUfmV13EzbiXhDB, 2
        // let pda2 = Pubkey::create_program_address(&[&b"escrow"[..], &[bump_seed]], program_id)?;
        // msg!("pda2 + seed {}, {}", pda2, bump_seed);

        // APPROACH 3: MANUAL - didn't work
        // let sys_prog_id = solana_program::system_program::id();
        // let mut empty_data = [0_u8];
        // let mut empty_lamports = 0_u64;
        // AccountInfo { key: 2CVTH6qZCuYWyCPigStv7rTPfaCW9FTmFtzTfq3u8LBU owner: 11111111111111111111111111111111 is_signer: false is_writable: false executable: false rent_epoch: 0 lamports: 0 data.len: 0  }
        // let pda_acc = AccountInfo::new(
        //     &pda,
        //     false,
        //     false,
        //     &mut empty_lamports,
        //     &mut empty_data,
        //     &sys_prog_id,
        //     false,
        //     0,
        // );

        // ----------------------------------------------------------------------------- send x token back

        // similarly to our Escrow, pack/unpack turns a slice into an actual account info
        let temp_x_info = TokenAccount::unpack(&temp_x_acc.data.borrow())?;

        let transfer_x_tokens_back_ix = spl_token::instruction::transfer(
            token_program_acc.key,
            temp_x_acc.key,
            initializer_x_acc.key,
            &pda,
            &[&pda],
            temp_x_info.amount, //get the amount in x tokens programmatically
        )?;

        //invoke here because we're asking the token program to do something for us
        invoke_signed(
            &transfer_x_tokens_back_ix,
            &[
                temp_x_acc.clone(),
                initializer_x_acc.clone(),
                pda_acc.clone(),
                token_program_acc.clone(),
            ],
            &[&[&b"escrow"[..], &[bump_seed]]],
        )?;

        // ----------------------------------------------------------------------------- clean up

        sol_log_compute_units();

        //1) close the temp acc by transferring rent out of it
        let close_temp_x_acc_ix = spl_token::instruction::close_account(
            token_program_acc.key,
            temp_x_acc.key,
            initializer_x_acc.key,
            &pda,
            &[&pda],
        )?;

        invoke_signed(
            &close_temp_x_acc_ix,
            &[
                temp_x_acc.clone(),
                initializer_x_acc.clone(),
                pda_acc.clone(),
                token_program_acc.clone(),
            ],
            &[&[&b"escrow"[..], &[bump_seed]]],
        )?;

        //2) close the escrow acc by transferring rent out of it AND zeroing out the data
        **initializer_main_acc.lamports.borrow_mut() = initializer_main_acc
            .lamports()
            .checked_add(escrow_acc.lamports())
            .ok_or(EscrowError::AmountOverflow)?;
        **escrow_acc.lamports.borrow_mut() = 0;
        *escrow_acc.data.borrow_mut() = &mut [];

        sol_log_compute_units();

        Ok(())
    }
}
