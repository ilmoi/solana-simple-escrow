use solana_program::{
    program_pack::{IsInitialized, Pack, Sealed},
    program_error::ProgramError,
    pubkey::Pubkey,
};

use arrayref::{array_mut_ref, array_ref, array_refs, mut_array_refs};

// 105 bytes of data
pub struct Escrow {
    pub is_initialized: bool, //determine if escrow program is already in use
    pub initializer_pubkey: Pubkey,
    // storing here for 1)convenience (alice doesn't dhave to send to bob), 2)security
    pub temp_token_account_pubkey: Pubkey, //addr of Alice's X tokens that will eventually go to Bob
    pub initializer_token_to_receive_account_pubkey: Pubkey, //addr where Bob will send tokens
    pub expected_amount: u64, //and their amount - use u64 coz that's the max supply of a token - https://github.com/solana-labs/solana-program-library/blob/123a3dc1e43dbc6c90c503b2c27a0d9b264e9ede/token/program/src/state.rs#L22
}

// -----------------------------------------------------------------------------
// Solana's program_pack module requires 3 traits: Sealed, IsInitialized, and Pack

// Solana's version of Rust's Sized trait, there doesn't seem to be a difference
impl Sealed for Escrow {}

impl IsInitialized for Escrow {
    fn is_initialized(&self) -> bool {
        self.is_initialized
    }
}

impl Pack for Escrow {
    // len = len of our state struct above
    // 1 byte (for the bool) + 3x32 (for pubkeys) + 8 (for u64)
    const LEN: usize = 105;

    // turns an array of u8s into an instance of the Escrow trait above
    fn unpack_from_slice(src: &[u8]) -> Result<Self, ProgramError> {
        let src = array_ref![src, 0, Escrow::LEN];
        let (
            is_initialized,
            initializer_pubkey,
            temp_token_account_pubkey,
            initializer_token_to_receive_account_pubkey,
            expected_amount,
        ) = array_refs![src, 1, 32, 32, 32, 8]; // library for getting references to sections of arrays
        // first arg = array reference, the rest are sizes of slices to be extracted

        let is_initialized = match is_initialized {
            [0] => false,
            [1] => true,
            _ => return Err(ProgramError::InvalidAccountData),
        };

        Ok(Escrow {
            is_initialized,
            initializer_pubkey: Pubkey::new_from_array(*initializer_pubkey),
            temp_token_account_pubkey: Pubkey::new_from_array(*temp_token_account_pubkey),
            initializer_token_to_receive_account_pubkey: Pubkey::new_from_array(*initializer_token_to_receive_account_pubkey),
            expected_amount: u64::from_le_bytes(*expected_amount),
        })
    }

    // other way around
    fn pack_into_slice(&self, dst: &mut [u8]) {
        // we're saying we want to work with the entire array from 0 to escro length
        let dst = array_mut_ref![dst, 0, Escrow::LEN];

        // slice the array up
        let (
            is_initialized_dst,
            initializer_pubkey_dst,
            temp_token_account_pubkey_dst,
            initializer_token_to_receive_account_pubkey_dst,
            expected_amount_dst,
        ) = mut_array_refs![dst, 1, 32, 32, 32, 8];

        // destructure self into an instance of escrow
        let Escrow {
            is_initialized,
            initializer_pubkey,
            temp_token_account_pubkey,
            initializer_token_to_receive_account_pubkey,
            expected_amount,
        } = self;

        // finally populate the slices we pre-prepared with the data
        is_initialized_dst[0] = *is_initialized as u8;
        initializer_pubkey_dst.copy_from_slice(initializer_pubkey.as_ref());
        temp_token_account_pubkey_dst.copy_from_slice(temp_token_account_pubkey.as_ref());
        initializer_token_to_receive_account_pubkey_dst.copy_from_slice(initializer_token_to_receive_account_pubkey.as_ref());
        *expected_amount_dst = expected_amount.to_le_bytes();
    }
}